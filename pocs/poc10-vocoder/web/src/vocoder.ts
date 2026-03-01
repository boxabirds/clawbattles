/**
 * CreatureVocoder: Channel vocoder that transforms TTS into creature sounds.
 *
 * Architecture:
 *   TTS source -> Analysis filterbank (bandpass bands)
 *              -> Envelope follower per band (amplitude extraction)
 *              -> Carrier bank (FM / sawtooth / square / noise)
 *              -> Sum -> Output
 *
 * Carrier types:
 *   - fm:     FM synthesis pairs per band (creature-tuned)
 *   - saw:    Sawtooth oscillator per band (classic robot)
 *   - square: Square wave per band (hollow Cylon)
 *   - noise:  Shared white noise source (whispery)
 *
 * Creature params control the carriers:
 *   - body_size: base frequency (big creature = low pitch)
 *   - material:  FM mod ratio (organic vs metallic) — only affects FM mode
 *   - aggression: FM mod index (calm vs harsh) — only affects FM mode
 */

// -- Vocoder constants --
const MIN_FREQUENCY_HZ = 80;
const MAX_FREQUENCY_HZ = 8000;
const MID_FREQUENCY_HZ = (MIN_FREQUENCY_HZ + MAX_FREQUENCY_HZ) / 2;
const DEFAULT_BAND_COUNT = 16;
const DEFAULT_WET_DRY = 1.0;
const DEFAULT_FORMANT_SHIFT = 1.0;
const DEFAULT_SPEED = 1.0;
const BAND_Q = 5;
const ENVELOPE_SMOOTH_HZ = 30;
const BAND_LEVEL_BOOST = 4.0;
const PARAM_RAMP_S = 0.05;

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

// -- Noise buffer --
const NOISE_BUFFER_DURATION_S = 2;

// -- Waveshaper --
const WAVESHAPER_SAMPLES = 256;

export type CarrierType = 'fm' | 'saw' | 'square' | 'noise';

export interface CreatureParams {
  bodySize: number;   // 0..1 (0 = small/high pitch, 1 = large/low pitch)
  material: number;   // 0..1 (0 = organic, 1 = metallic)
  aggression: number; // 0..1 (0 = calm, 1 = aggressive)
}

export interface VocoderParams {
  bandCount: number;
  carrierType: CarrierType;
  wetDry: number;           // 0 = dry TTS only, 1 = fully vocoded
  formantShift: number;     // 0.5..2.0 (1.0 = no shift)
  speed: number;            // 0.25..2.0 (1.0 = normal speed)
  filterHPCutoff: number;   // 20..20000 Hz (highpass)
  filterHPResonance: number; // 0..30 (Q)
  filterCutoff: number;     // 20..20000 Hz (lowpass)
  filterResonance: number;  // 0..30 (Q)
  filterEnvFollow: number;  // 0..1 (how much amplitude opens the LP filter)
}

/**
 * A single vocoder band: analysis filter -> envelope follower -> synthesis carrier.
 */
interface VocoderBand {
  analysisBPF: BiquadFilterNode;
  envelopeFollower: {
    rectifier: WaveShaperNode;
    lpf: BiquadFilterNode;
  };
  carrierOsc: OscillatorNode | null;   // null for noise carrier
  modulatorOsc: OscillatorNode | null; // FM only
  modulatorGain: GainNode | null;      // FM only
  carrierGain: GainNode;               // modulated by envelope
  bandGain: GainNode;                  // output level for this band
}

function makeRectifierCurve(): Float32Array {
  const curve = new Float32Array(WAVESHAPER_SAMPLES);
  for (let i = 0; i < WAVESHAPER_SAMPLES; i++) {
    curve[i] = Math.abs((i / (WAVESHAPER_SAMPLES - 1)) * 2 - 1);
  }
  return curve;
}

export class CreatureVocoder {
  private ctx: AudioContext;
  private bands: VocoderBand[] = [];
  private outputGain: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private sourceNode: AudioBufferSourceNode | null = null;
  private playGeneration = 0;
  private needsRebuild = false;

  /** Shared noise buffer source for 'noise' carrier mode */
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  // 4-pole highpass (two cascaded 2-pole biquads)
  private filterHP1: BiquadFilterNode;
  private filterHP2: BiquadFilterNode;
  // 4-pole lowpass (two cascaded 2-pole biquads)
  private filterLP1: BiquadFilterNode;
  private filterLP2: BiquadFilterNode;
  // Envelope follower for LP filter cutoff modulation
  private filterEnvRect: WaveShaperNode;
  private filterEnvLPF: BiquadFilterNode;
  private filterEnvGain: GainNode;

  private creatureParams: CreatureParams = {
    bodySize: 0.5,
    material: 0.0,
    aggression: 0.3,
  };

  private vocoderParams: VocoderParams = {
    bandCount: DEFAULT_BAND_COUNT,
    carrierType: 'fm',
    wetDry: DEFAULT_WET_DRY,
    formantShift: DEFAULT_FORMANT_SHIFT,
    speed: DEFAULT_SPEED,
    filterHPCutoff: FILTER_CUTOFF_MIN_HZ,
    filterHPResonance: DEFAULT_FILTER_RESONANCE,
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

    // 4-pole highpass: two cascaded 2-pole biquads (24 dB/oct)
    this.filterHP1 = ctx.createBiquadFilter();
    this.filterHP1.type = 'highpass';
    this.filterHP1.frequency.value = FILTER_CUTOFF_MIN_HZ;
    this.filterHP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterHP2 = ctx.createBiquadFilter();
    this.filterHP2.type = 'highpass';
    this.filterHP2.frequency.value = FILTER_CUTOFF_MIN_HZ;
    this.filterHP2.Q.value = DEFAULT_FILTER_RESONANCE;

    // 4-pole lowpass: two cascaded 2-pole biquads (24 dB/oct)
    this.filterLP1 = ctx.createBiquadFilter();
    this.filterLP1.type = 'lowpass';
    this.filterLP1.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterLP2 = ctx.createBiquadFilter();
    this.filterLP2.type = 'lowpass';
    this.filterLP2.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP2.Q.value = DEFAULT_FILTER_RESONANCE;

    // Envelope follower for LP filter: rectifier → smoothing LPF → gain scaler
    this.filterEnvRect = ctx.createWaveShaper();
    this.filterEnvRect.curve = makeRectifierCurve();

    this.filterEnvLPF = ctx.createBiquadFilter();
    this.filterEnvLPF.type = 'lowpass';
    this.filterEnvLPF.frequency.value = FILTER_ENVELOPE_SMOOTH_HZ;
    this.filterEnvLPF.Q.value = 0.5;

    this.filterEnvGain = ctx.createGain();
    this.filterEnvGain.gain.value = 0;

    // Signal chain: wet/dry → outputGain → HP1 → HP2 → LP1 → LP2 → destination
    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);
    this.outputGain.connect(this.filterHP1);
    this.filterHP1.connect(this.filterHP2);
    this.filterHP2.connect(this.filterLP1);
    this.filterLP1.connect(this.filterLP2);
    this.filterLP2.connect(ctx.destination);

    // Envelope follower taps off outputGain, drives LP filter cutoff
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
    const carrierTypeChanged = params.carrierType !== this.vocoderParams.carrierType;
    const formantShiftChanged = params.formantShift !== this.vocoderParams.formantShift;
    this.vocoderParams = { ...params };

    // Update wet/dry mix
    const now = this.ctx.currentTime;
    this.wetGain.gain.cancelScheduledValues(now);
    this.dryGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.setValueAtTime(this.vocoderParams.wetDry, now);
    this.dryGain.gain.setValueAtTime(1.0 - this.vocoderParams.wetDry, now);

    // Update playback speed live
    if (this.sourceNode) {
      this.sourceNode.playbackRate.setValueAtTime(this.vocoderParams.speed, now);
    }

    // Update highpass filter
    this.filterHP1.frequency.setValueAtTime(this.vocoderParams.filterHPCutoff, now);
    this.filterHP2.frequency.setValueAtTime(this.vocoderParams.filterHPCutoff, now);
    this.filterHP1.Q.setValueAtTime(this.vocoderParams.filterHPResonance, now);
    this.filterHP2.Q.setValueAtTime(this.vocoderParams.filterHPResonance, now);

    // Update lowpass filter
    this.filterLP1.frequency.setValueAtTime(this.vocoderParams.filterCutoff, now);
    this.filterLP2.frequency.setValueAtTime(this.vocoderParams.filterCutoff, now);
    this.filterLP1.Q.setValueAtTime(this.vocoderParams.filterResonance, now);
    this.filterLP2.Q.setValueAtTime(this.vocoderParams.filterResonance, now);

    // Env follow: scale envelope signal to modulate LP cutoff upward from base
    const envRange = (FILTER_CUTOFF_MAX_HZ - this.vocoderParams.filterCutoff) * this.vocoderParams.filterEnvFollow;
    this.filterEnvGain.gain.setValueAtTime(envRange, now);

    if (bandCountChanged || carrierTypeChanged) {
      this.rebuildBandsLive();
    } else if (formantShiftChanged) {
      this.updateFormantShift();
    }
  }

  play(buffer: AudioBuffer, loop: boolean, onEnded?: () => void, _offlineDuration?: number): void {
    this.stop();

    if (this.bands.length === 0 || this.needsRebuild ||
        this.bands.length !== this.vocoderParams.bandCount) {
      this.buildBands();
      this.needsRebuild = false;
    }

    this.sourceNode = this.ctx.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.loop = loop;
    this.sourceNode.playbackRate.value = this.vocoderParams.speed;

    this.connectSourceToBands();
    this.sourceNode.connect(this.dryGain);

    // Start carriers
    const now = this.ctx.currentTime;
    this.startCarriers(now);

    const generation = ++this.playGeneration;
    this.sourceNode.onended = () => {
      if (generation !== this.playGeneration) return;
      this.cleanupAfterPlay();
      onEnded?.();
    };
    this.sourceNode.start(now);
  }

  stop(): void {
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try { this.sourceNode.stop(); } catch { /* already stopped */ }
      this.cleanupAfterPlay();
    }
  }

  private connectSourceToBands(): void {
    if (!this.sourceNode) return;
    for (const band of this.bands) {
      this.sourceNode.connect(band.analysisBPF);
    }
  }

  /** Start all carrier oscillators / noise source */
  private startCarriers(time: number): void {
    if (this.vocoderParams.carrierType === 'noise') {
      this.startNoiseSource(time);
    } else {
      for (const band of this.bands) {
        band.carrierOsc?.start(time);
        band.modulatorOsc?.start(time);
      }
    }
  }

  /** Stop all carrier oscillators / noise source */
  private stopCarriers(): void {
    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch { /* already stopped */ }
      this.noiseSource.disconnect();
      this.noiseSource = null;
    }
    for (const band of this.bands) {
      try { band.carrierOsc?.stop(); } catch { /* already stopped */ }
      try { band.modulatorOsc?.stop(); } catch { /* already stopped */ }
    }
  }

  private startNoiseSource(time: number): void {
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.generateNoiseBuffer();
    }
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;

    // Connect noise to all band carrierGain nodes
    for (const band of this.bands) {
      this.noiseSource.connect(band.carrierGain);
    }
    this.noiseSource.start(time);
  }

  private generateNoiseBuffer(): AudioBuffer {
    const numFrames = Math.ceil(NOISE_BUFFER_DURATION_S * this.ctx.sampleRate);
    const buffer = new AudioBuffer({
      numberOfChannels: 1,
      length: numFrames,
      sampleRate: this.ctx.sampleRate,
    });
    const data = buffer.getChannelData(0);
    for (let i = 0; i < numFrames; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private rebuildBandsLive(): void {
    if (!this.sourceNode) {
      this.needsRebuild = true;
      return;
    }

    this.stopCarriers();
    this.destroyBands();
    this.buildBands();
    this.connectSourceToBands();
    this.needsRebuild = false;

    const now = this.ctx.currentTime;
    this.startCarriers(now);
  }

  /**
   * Build the vocoder filterbank.
   *
   * Analysis: bandpass filters spaced logarithmically across frequency range.
   * Each band extracts amplitude envelope via full-wave rectification + LPF.
   * Synthesis: carrier type determines the per-band sound source.
   */
  private buildBands(): void {
    this.destroyBands();

    const count = this.vocoderParams.bandCount;
    const shift = this.vocoderParams.formantShift;
    const carrierType = this.vocoderParams.carrierType;

    const logMin = Math.log2(MIN_FREQUENCY_HZ);
    const logMax = Math.log2(MAX_FREQUENCY_HZ);

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;

      // -- Analysis path --
      const analysisBPF = this.ctx.createBiquadFilter();
      analysisBPF.type = 'bandpass';
      analysisBPF.frequency.value = centerFreq;
      analysisBPF.Q.value = BAND_Q;

      const rectifier = this.ctx.createWaveShaper();
      rectifier.curve = makeRectifierCurve();
      rectifier.oversample = 'none';

      const envLPF = this.ctx.createBiquadFilter();
      envLPF.type = 'lowpass';
      envLPF.frequency.value = ENVELOPE_SMOOTH_HZ;
      envLPF.Q.value = 0.5;

      analysisBPF.connect(rectifier);
      rectifier.connect(envLPF);

      // -- Carrier gain (envelope-modulated) + band output --
      const carrierGain = this.ctx.createGain();
      carrierGain.gain.value = 0; // driven by envelope
      envLPF.connect(carrierGain.gain);

      const bandGain = this.ctx.createGain();
      bandGain.gain.value = BAND_LEVEL_BOOST / count;
      carrierGain.connect(bandGain);
      bandGain.connect(this.wetGain);

      // -- Synthesis path (varies by carrier type) --
      let carrierOsc: OscillatorNode | null = null;
      let modulatorOsc: OscillatorNode | null = null;
      let modulatorGain: GainNode | null = null;

      if (carrierType === 'fm') {
        const { carrierFreq, modRatio, modIndex } = this.computeFMParams(synthFreq);

        modulatorOsc = this.ctx.createOscillator();
        modulatorOsc.type = 'sine';
        modulatorOsc.frequency.value = carrierFreq * modRatio;

        modulatorGain = this.ctx.createGain();
        modulatorGain.gain.value = modIndex * carrierFreq;
        modulatorOsc.connect(modulatorGain);

        carrierOsc = this.ctx.createOscillator();
        carrierOsc.type = 'sine';
        carrierOsc.frequency.value = carrierFreq;
        modulatorGain.connect(carrierOsc.frequency);
        carrierOsc.connect(carrierGain);

      } else if (carrierType === 'saw' || carrierType === 'square') {
        const carrierFreq = this.computeSimpleCarrierFreq(synthFreq);
        carrierOsc = this.ctx.createOscillator();
        carrierOsc.type = carrierType === 'saw' ? 'sawtooth' : 'square';
        carrierOsc.frequency.value = carrierFreq;
        carrierOsc.connect(carrierGain);

      } else if (carrierType === 'noise') {
        // Noise source is shared — connected in startNoiseSource()
        // No per-band oscillator needed
      }

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
  private computeFMParams(bandCenterFreq: number): {
    carrierFreq: number;
    modRatio: number;
    modIndex: number;
  } {
    const { bodySize, material, aggression } = this.creatureParams;

    const baseFreq = CARRIER_FREQ_MAX_HZ - bodySize * (CARRIER_FREQ_MAX_HZ - CARRIER_FREQ_MIN_HZ);
    const freqRatio = bandCenterFreq / MID_FREQUENCY_HZ;
    const carrierFreq = baseFreq * freqRatio;

    const modRatio = MOD_RATIO_ORGANIC + material * (MOD_RATIO_METALLIC - MOD_RATIO_ORGANIC);
    const modIndex = MOD_INDEX_CALM + aggression * (MOD_INDEX_AGGRESSIVE - MOD_INDEX_CALM);

    return { carrierFreq, modRatio, modIndex };
  }

  /**
   * Compute carrier frequency for simple (non-FM) oscillator types.
   * Only bodySize affects pitch. material/aggression are unused.
   */
  private computeSimpleCarrierFreq(bandCenterFreq: number): number {
    const baseFreq = CARRIER_FREQ_MAX_HZ - this.creatureParams.bodySize * (CARRIER_FREQ_MAX_HZ - CARRIER_FREQ_MIN_HZ);
    const freqRatio = bandCenterFreq / MID_FREQUENCY_HZ;
    return baseFreq * freqRatio;
  }

  /**
   * Update carrier oscillator frequencies when creature params change.
   */
  private updateCarriers(): void {
    if (this.bands.length === 0) return;

    const carrierType = this.vocoderParams.carrierType;
    if (carrierType === 'noise') return; // noise has no pitch to update

    const count = this.bands.length;
    const shift = this.vocoderParams.formantShift;
    const logMin = Math.log2(MIN_FREQUENCY_HZ);
    const logMax = Math.log2(MAX_FREQUENCY_HZ);
    const now = this.ctx.currentTime;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;
      const band = this.bands[i];

      if (carrierType === 'fm') {
        const { carrierFreq, modRatio, modIndex } = this.computeFMParams(synthFreq);
        band.carrierOsc?.frequency.linearRampToValueAtTime(carrierFreq, now + PARAM_RAMP_S);
        band.modulatorOsc?.frequency.linearRampToValueAtTime(carrierFreq * modRatio, now + PARAM_RAMP_S);
        band.modulatorGain?.gain.linearRampToValueAtTime(modIndex * carrierFreq, now + PARAM_RAMP_S);
      } else {
        const carrierFreq = this.computeSimpleCarrierFreq(synthFreq);
        band.carrierOsc?.frequency.linearRampToValueAtTime(carrierFreq, now + PARAM_RAMP_S);
      }
    }
  }

  /**
   * Update synthesis frequencies when formant shift changes.
   */
  private updateFormantShift(): void {
    // Same operation as updateCarriers — recalculate frequencies with new shift
    this.updateCarriers();
  }

  private cleanupAfterPlay(): void {
    this.stopCarriers();
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.destroyBands();
  }

  private destroyBands(): void {
    for (const band of this.bands) {
      band.analysisBPF.disconnect();
      band.envelopeFollower.rectifier.disconnect();
      band.envelopeFollower.lpf.disconnect();
      band.carrierOsc?.disconnect();
      band.modulatorOsc?.disconnect();
      band.modulatorGain?.disconnect();
      band.carrierGain.disconnect();
      band.bandGain.disconnect();
    }
    this.bands = [];
  }
}
