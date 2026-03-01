/**
 * CreatureVocoder: Channel vocoder that transforms TTS into creature sounds.
 *
 * Architecture:
 *   TTS source -> Analysis filterbank (bandpass bands)
 *              -> Envelope follower per band (amplitude extraction)
 *              -> Multiplied with FM carrier bank (creature-tuned oscillators)
 *              -> Sum -> Output
 *
 * The FM carriers are what make it sound "creature-like":
 *   - body_size controls base frequency (big creature = low pitch)
 *   - material controls carrier:modulator ratio (organic vs metallic timbre)
 *   - aggression controls modulation index (calm hum vs harsh screech)
 *
 * Additionally, formant shifting slides the analysis/synthesis bands
 * up or down to make voices sound bigger/smaller without changing speed.
 */

// -- Vocoder constants --
const MIN_FREQUENCY_HZ = 80;
const MAX_FREQUENCY_HZ = 8000;
const DEFAULT_BAND_COUNT = 16;
const DEFAULT_WET_DRY = 1.0;
const DEFAULT_FORMANT_SHIFT = 1.0;
const DEFAULT_SPEED = 1.0;

// -- Output filter defaults --
const DEFAULT_FILTER_CUTOFF_HZ = 20000;
const DEFAULT_FILTER_RESONANCE = 0;
const DEFAULT_FILTER_ENV_FOLLOW = 0;
const FILTER_ENVELOPE_SMOOTH_HZ = 20;
const FILTER_CUTOFF_MIN_HZ = 20;
const FILTER_CUTOFF_MAX_HZ = 20000;

// -- Creature param ranges --
const CARRIER_FREQ_MIN_HZ = 60;
const CARRIER_FREQ_MAX_HZ = 600;
const MOD_RATIO_ORGANIC = 1.0;     // integer ratio = harmonic = organic
const MOD_RATIO_METALLIC = 1.414;  // irrational ratio = inharmonic = metallic
const MOD_INDEX_CALM = 0.5;
const MOD_INDEX_AGGRESSIVE = 12.0;

export interface CreatureParams {
  bodySize: number;   // 0..1 (0 = small/high pitch, 1 = large/low pitch)
  material: number;   // 0..1 (0 = organic, 1 = metallic)
  aggression: number; // 0..1 (0 = calm, 1 = aggressive)
}

export interface VocoderParams {
  bandCount: number;
  wetDry: number;         // 0 = dry TTS only, 1 = fully vocoded
  formantShift: number;   // 0.5..2.0 (1.0 = no shift)
  speed: number;          // 0.25..2.0 (1.0 = normal speed)
  filterCutoff: number;   // 20..20000 Hz
  filterResonance: number; // 0..30 (Q)
  filterEnvFollow: number; // 0..1 (how much amplitude opens the filter)
}

/**
 * A single vocoder band: analysis filter -> envelope follower -> synthesis oscillator.
 */
interface VocoderBand {
  analysisBPF: BiquadFilterNode;
  envelopeFollower: {
    rectifier: WaveShaperNode;  // full-wave rectification for envelope extraction
    lpf: BiquadFilterNode;      // smooths rectified signal into amplitude envelope
  };
  carrierOsc: OscillatorNode;
  modulatorOsc: OscillatorNode;
  modulatorGain: GainNode;
  carrierGain: GainNode;       // modulated by envelope
  bandGain: GainNode;          // output level for this band
}

export class CreatureVocoder {
  private ctx: AudioContext;
  private bands: VocoderBand[] = [];
  private outputGain: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private sourceNode: AudioBufferSourceNode | null = null;
  private playGeneration = 0; // guards against stale onended callbacks
  private needsRebuild = false; // deferred band rebuild flag

  // 4-pole output filter (two cascaded 2-pole biquads)
  private filterLP1: BiquadFilterNode;
  private filterLP2: BiquadFilterNode;
  // Envelope follower for filter cutoff modulation
  private filterEnvRect: WaveShaperNode;
  private filterEnvLPF: BiquadFilterNode;
  private filterEnvGain: GainNode; // scales envelope → cutoff offset

  private creatureParams: CreatureParams = {
    bodySize: 0.5,
    material: 0.0,
    aggression: 0.3,
  };

  private vocoderParams: VocoderParams = {
    bandCount: DEFAULT_BAND_COUNT,
    wetDry: DEFAULT_WET_DRY,
    formantShift: DEFAULT_FORMANT_SHIFT,
    speed: DEFAULT_SPEED,
    filterCutoff: DEFAULT_FILTER_CUTOFF_HZ,
    filterResonance: DEFAULT_FILTER_RESONANCE,
    filterEnvFollow: DEFAULT_FILTER_ENV_FOLLOW,
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 1.0;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.0;

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 1.0;

    // 4-pole lowpass: two cascaded 2-pole biquads (24 dB/oct)
    this.filterLP1 = ctx.createBiquadFilter();
    this.filterLP1.type = 'lowpass';
    this.filterLP1.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterLP2 = ctx.createBiquadFilter();
    this.filterLP2.type = 'lowpass';
    this.filterLP2.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP2.Q.value = DEFAULT_FILTER_RESONANCE;

    // Envelope follower for filter: rectifier → smoothing LPF → gain scaler
    this.filterEnvRect = ctx.createWaveShaper();
    const WAVESHAPER_SAMPLES = 256;
    const curve = new Float32Array(WAVESHAPER_SAMPLES);
    for (let i = 0; i < WAVESHAPER_SAMPLES; i++) {
      curve[i] = Math.abs((i / (WAVESHAPER_SAMPLES - 1)) * 2 - 1);
    }
    this.filterEnvRect.curve = curve;

    this.filterEnvLPF = ctx.createBiquadFilter();
    this.filterEnvLPF.type = 'lowpass';
    this.filterEnvLPF.frequency.value = FILTER_ENVELOPE_SMOOTH_HZ;
    this.filterEnvLPF.Q.value = 0.5;

    // Env gain: scales the envelope signal before it modulates filter cutoff.
    // Value = envFollow * cutoff range in Hz
    this.filterEnvGain = ctx.createGain();
    this.filterEnvGain.gain.value = 0;

    // Signal chain: wet/dry → outputGain → filter1 → filter2 → destination
    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);
    this.outputGain.connect(this.filterLP1);
    this.filterLP1.connect(this.filterLP2);
    this.filterLP2.connect(ctx.destination);

    // Envelope follower taps off outputGain, drives both filter cutoff params
    this.outputGain.connect(this.filterEnvRect);
    this.filterEnvRect.connect(this.filterEnvLPF);
    this.filterEnvLPF.connect(this.filterEnvGain);
    this.filterEnvGain.connect(this.filterLP1.frequency);
    this.filterEnvGain.connect(this.filterLP2.frequency);
  }

  setCreatureParams(params: CreatureParams): void {
    this.creatureParams = { ...params };
    this.updateCarriers();
  }

  setVocoderParams(params: VocoderParams): void {
    const bandCountChanged = params.bandCount !== this.vocoderParams.bandCount;
    const formantShiftChanged = params.formantShift !== this.vocoderParams.formantShift;
    this.vocoderParams = { ...params };

    // Update wet/dry mix — cancel stale automation first
    const now = this.ctx.currentTime;
    this.wetGain.gain.cancelScheduledValues(now);
    this.dryGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.setValueAtTime(this.vocoderParams.wetDry, now);
    this.dryGain.gain.setValueAtTime(1.0 - this.vocoderParams.wetDry, now);

    // Update playback speed live
    if (this.sourceNode) {
      this.sourceNode.playbackRate.setValueAtTime(this.vocoderParams.speed, now);
    }

    // Update output filter
    this.filterLP1.frequency.setValueAtTime(this.vocoderParams.filterCutoff, now);
    this.filterLP2.frequency.setValueAtTime(this.vocoderParams.filterCutoff, now);
    this.filterLP1.Q.setValueAtTime(this.vocoderParams.filterResonance, now);
    this.filterLP2.Q.setValueAtTime(this.vocoderParams.filterResonance, now);

    // Env follow: scale envelope signal to modulate cutoff upward from base
    // At full follow (1.0), envelope can push cutoff up by the full range
    const envRange = (FILTER_CUTOFF_MAX_HZ - this.vocoderParams.filterCutoff) * this.vocoderParams.filterEnvFollow;
    this.filterEnvGain.gain.setValueAtTime(envRange, now);

    if (bandCountChanged) {
      // Live rebuild: swap band chain under the playing source
      this.rebuildBandsLive();
    } else if (formantShiftChanged) {
      this.updateFormantShift();
    }
  }

  /**
   * Play an AudioBuffer through the vocoder chain.
   */
  play(buffer: AudioBuffer, loop: boolean, onEnded?: () => void): void {
    this.stop();

    // Build vocoder bands if needed (or rebuild if band count changed)
    if (this.bands.length === 0 || this.needsRebuild ||
        this.bands.length !== this.vocoderParams.bandCount) {
      this.buildBands();
      this.needsRebuild = false;
    }

    // Create source node
    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.loop = loop;
    this.sourceNode.playbackRate.value = this.vocoderParams.speed;

    // Connect source to analysis filterbank and dry path
    this.connectSourceToBands();
    this.sourceNode.connect(this.dryGain);

    // Start carrier oscillators
    const now = this.ctx.currentTime;
    for (const band of this.bands) {
      band.carrierOsc.start(now);
      band.modulatorOsc.start(now);
    }

    // Capture generation so stale onended callbacks are ignored
    const generation = ++this.playGeneration;

    // Start source
    this.sourceNode.onended = () => {
      if (generation !== this.playGeneration) return; // stale callback
      this.cleanupAfterPlay();
      onEnded?.();
    };
    this.sourceNode.start(now);
  }

  stop(): void {
    if (this.sourceNode) {
      // Detach onended before stopping to prevent stale callback
      this.sourceNode.onended = null;
      try {
        this.sourceNode.stop();
      } catch {
        // May already be stopped
      }
      this.cleanupAfterPlay();
    }
  }

  /**
   * Connect the current source node to all analysis band filters.
   */
  private connectSourceToBands(): void {
    if (!this.sourceNode) return;
    for (const band of this.bands) {
      this.sourceNode.connect(band.analysisBPF);
    }
  }

  /**
   * Rebuild bands live during playback — swap the wet chain under the playing source.
   * Keeps source and dry path intact, only replaces the vocoder band processing.
   */
  private rebuildBandsLive(): void {
    if (!this.sourceNode) {
      // Not playing — just flag for rebuild on next play
      this.needsRebuild = true;
      return;
    }

    // Stop old oscillators and disconnect old bands
    for (const band of this.bands) {
      try {
        band.carrierOsc.stop();
        band.modulatorOsc.stop();
      } catch { /* already stopped */ }
    }
    this.destroyBands();

    // Build new bands and wire them up
    this.buildBands();
    this.connectSourceToBands();
    this.needsRebuild = false;

    // Start new oscillators
    const now = this.ctx.currentTime;
    for (const band of this.bands) {
      band.carrierOsc.start(now);
      band.modulatorOsc.start(now);
    }
  }

  /**
   * Build the vocoder filterbank.
   *
   * Analysis: bandpass filters spaced logarithmically across frequency range.
   * Each band extracts amplitude envelope via full-wave rectification + LPF.
   * Synthesis: FM oscillator pairs per band, amplitude-modulated by the envelope.
   */
  private buildBands(): void {
    this.destroyBands();

    const count = this.vocoderParams.bandCount;
    const shift = this.vocoderParams.formantShift;

    // Logarithmically spaced center frequencies
    const logMin = Math.log2(MIN_FREQUENCY_HZ);
    const logMax = Math.log2(MAX_FREQUENCY_HZ);

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;

      // Bandwidth: Q determines how wide each band is
      // Lower Q = wider bands. With 16 bands across 80-8000Hz,
      // Q around 4-8 gives good overlap
      const BAND_Q = 5;

      // -- Analysis path --
      const analysisBPF = this.ctx.createBiquadFilter();
      analysisBPF.type = 'bandpass';
      analysisBPF.frequency.value = centerFreq;
      analysisBPF.Q.value = BAND_Q;

      // Full-wave rectifier via waveshaper (|x|)
      const rectifier = this.ctx.createWaveShaper();
      const WAVESHAPER_SAMPLES = 256;
      const curve = new Float32Array(WAVESHAPER_SAMPLES);
      for (let j = 0; j < WAVESHAPER_SAMPLES; j++) {
        curve[j] = Math.abs((j / (WAVESHAPER_SAMPLES - 1)) * 2 - 1);
      }
      rectifier.curve = curve;
      rectifier.oversample = 'none';

      // Envelope LPF (smooths rectified signal)
      const envLPF = this.ctx.createBiquadFilter();
      envLPF.type = 'lowpass';
      const ENVELOPE_FREQ_HZ = 30;
      envLPF.frequency.value = ENVELOPE_FREQ_HZ;
      envLPF.Q.value = 0.5;

      analysisBPF.connect(rectifier);
      rectifier.connect(envLPF);

      // -- Synthesis path (FM oscillator pair) --
      const { carrierFreq, modRatio, modIndex } = this.computeCarrierParams(synthFreq);

      // Modulator oscillator
      const modulatorOsc = this.ctx.createOscillator();
      modulatorOsc.type = 'sine';
      modulatorOsc.frequency.value = carrierFreq * modRatio;

      // Modulator output scaled by modulation index * carrier freq
      const modulatorGain = this.ctx.createGain();
      modulatorGain.gain.value = modIndex * carrierFreq;

      modulatorOsc.connect(modulatorGain);

      // Carrier oscillator (frequency modulated by modulator)
      const carrierOsc = this.ctx.createOscillator();
      carrierOsc.type = 'sine';
      carrierOsc.frequency.value = carrierFreq;
      modulatorGain.connect(carrierOsc.frequency); // FM connection

      // Carrier gain node -- this is what the envelope controls
      const carrierGain = this.ctx.createGain();
      carrierGain.gain.value = 0; // Will be driven by envelope
      carrierOsc.connect(carrierGain);

      // Use the envelope to modulate carrier amplitude.
      // We connect the envelope LPF output to the carrierGain's gain param.
      // This is the core vocoder operation: analysis envelope drives synthesis amplitude.
      envLPF.connect(carrierGain.gain);

      // Band output gain (for level balancing)
      const bandGain = this.ctx.createGain();
      const BAND_LEVEL_BOOST = 4.0;
      bandGain.gain.value = BAND_LEVEL_BOOST / count;
      carrierGain.connect(bandGain);

      // Connect to wet output
      bandGain.connect(this.wetGain);

      this.bands.push({
        analysisBPF,
        envelopeFollower: { rectifier, lpf: envLPF },
        carrierOsc,
        modulatorOsc,
        modulatorGain,
        carrierGain,
        bandGain,
      });
    }
  }

  /**
   * Compute FM carrier parameters from creature properties and band center frequency.
   */
  private computeCarrierParams(bandCenterFreq: number): {
    carrierFreq: number;
    modRatio: number;
    modIndex: number;
  } {
    const { bodySize, material, aggression } = this.creatureParams;

    // Base carrier frequency: inversely proportional to body size
    // Small creature (0) -> high pitch, Large creature (1) -> low pitch
    const baseFreq = CARRIER_FREQ_MAX_HZ - bodySize * (CARRIER_FREQ_MAX_HZ - CARRIER_FREQ_MIN_HZ);

    // Scale carrier relative to the band position
    // This maps the vocoder band structure onto the creature's frequency range
    const freqRatio = bandCenterFreq / ((MIN_FREQUENCY_HZ + MAX_FREQUENCY_HZ) / 2);
    const carrierFreq = baseFreq * freqRatio;

    // Modulator ratio: organic (integer) to metallic (irrational)
    const modRatio = MOD_RATIO_ORGANIC + material * (MOD_RATIO_METALLIC - MOD_RATIO_ORGANIC);

    // Modulation index: calm to aggressive
    const modIndex = MOD_INDEX_CALM + aggression * (MOD_INDEX_AGGRESSIVE - MOD_INDEX_CALM);

    return { carrierFreq, modRatio, modIndex };
  }

  /**
   * Update carrier oscillator frequencies when creature params change.
   */
  private updateCarriers(): void {
    if (this.bands.length === 0) return;

    const count = this.bands.length;
    const shift = this.vocoderParams.formantShift;
    const logMin = Math.log2(MIN_FREQUENCY_HZ);
    const logMax = Math.log2(MAX_FREQUENCY_HZ);
    const now = this.ctx.currentTime;
    const PARAM_RAMP_TIME_S = 0.05;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;

      const { carrierFreq, modRatio, modIndex } = this.computeCarrierParams(synthFreq);
      const band = this.bands[i];

      band.carrierOsc.frequency.linearRampToValueAtTime(carrierFreq, now + PARAM_RAMP_TIME_S);
      band.modulatorOsc.frequency.linearRampToValueAtTime(carrierFreq * modRatio, now + PARAM_RAMP_TIME_S);
      band.modulatorGain.gain.linearRampToValueAtTime(modIndex * carrierFreq, now + PARAM_RAMP_TIME_S);
    }
  }

  /**
   * Update analysis filter frequencies when formant shift changes.
   */
  private updateFormantShift(): void {
    if (this.bands.length === 0) return;

    const count = this.bands.length;
    const shift = this.vocoderParams.formantShift;
    const logMin = Math.log2(MIN_FREQUENCY_HZ);
    const logMax = Math.log2(MAX_FREQUENCY_HZ);
    const now = this.ctx.currentTime;
    const PARAM_RAMP_TIME_S = 0.05;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;

      const { carrierFreq, modRatio, modIndex } = this.computeCarrierParams(synthFreq);
      const band = this.bands[i];

      // Update synthesis carriers to shifted frequencies
      band.carrierOsc.frequency.linearRampToValueAtTime(carrierFreq, now + PARAM_RAMP_TIME_S);
      band.modulatorOsc.frequency.linearRampToValueAtTime(carrierFreq * modRatio, now + PARAM_RAMP_TIME_S);
      band.modulatorGain.gain.linearRampToValueAtTime(modIndex * carrierFreq, now + PARAM_RAMP_TIME_S);
    }
  }

  private cleanupAfterPlay(): void {
    for (const band of this.bands) {
      try {
        band.carrierOsc.stop();
        band.modulatorOsc.stop();
      } catch {
        // Already stopped
      }
    }
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.destroyBands();
  }

  private destroyBands(): void {
    for (const band of this.bands) {
      band.analysisBPF.disconnect();
      band.envelopeFollower.rectifier.disconnect();
      band.envelopeFollower.lpf.disconnect();
      band.carrierOsc.disconnect();
      band.modulatorOsc.disconnect();
      band.modulatorGain.disconnect();
      band.carrierGain.disconnect();
      band.bandGain.disconnect();
    }
    this.bands = [];
  }
}
