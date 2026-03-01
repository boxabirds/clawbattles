/**
 * CylonVocoder: Classic robot voice based on the 1978 Battlestar Galactica
 * Cylon voice architecture.
 *
 * Authentic signal chain:
 *
 *   1. Carrier: SAWTOOTH oscillator (all harmonics) + noise blend
 *
 *   2. Modulator: Speech → Nagra tape EQ (100Hz bump, softened highs)
 *      → broadcast limiter → 16-band analysis (cascaded BPFs, ~24dB/oct)
 *      → envelope followers with boost
 *
 *   3. Vocoder: Carrier → 16-band synthesis (cascaded BPFs, ~24dB/oct)
 *      → envelope-modulated gains → sum
 *
 *   4. Post-vocoder: Compressor → Distortion (line→mic overload)
 *      → 6-stage allpass phaser (envelope follower driven)
 *      → Final limiter → Output
 *
 *   5. Optional sibilance passthrough (NOT in original — off by default)
 *
 * Creature params:
 *   - bodySize   → carrier fundamental pitch (60–600 Hz)
 *   - material   → phaser envelope depth
 *   - aggression → noise blend (0 = pure sawtooth, 1 = pure noise)
 */

import type { CreatureParams, VocoderParams } from './vocoder';

// ── Vocoder band constants ───────────────────────────────────────
const MIN_FREQ_HZ = 80;
const MAX_FREQ_HZ = 8000;
const BAND_Q = 5;
const ENVELOPE_SMOOTH_HZ = 30;

// Envelope follower output is tiny (bandpass-filtered signal rectified).
// This boost brings it into a useful range for driving carrier gain.
const ENVELOPE_BOOST = 15;

// Per-band output gain. With 16 bands and boosted envelopes, this
// sets the overall vocoder loudness.
const BAND_LEVEL_GAIN = 1.5;

// Number of cascaded BPFs per band. EMS used 30dB/oct; each BiquadFilter
// bandpass is 12dB/oct, so 2 cascaded ≈ 24dB/oct (close enough).
const BPFS_PER_BAND = 2;

// ── Carrier constants ────────────────────────────────────────────
const CARRIER_FREQ_MIN_HZ = 60;
const CARRIER_FREQ_MAX_HZ = 600;

// ── Nagra tape EQ (pre-processing) ──────────────────────────────
const NAGRA_LOW_SHELF_FREQ_HZ = 100;
const NAGRA_LOW_SHELF_GAIN_DB = 4;
const NAGRA_HIGH_SHELF_FREQ_HZ = 6000;
const NAGRA_HIGH_SHELF_GAIN_DB = -3;

// ── Sibilance passthrough — OFF by default (not in original chain) ──
const SIBILANCE_HP_FREQ_HZ = 4000;
const SIBILANCE_MIX_DEFAULT = 0;

// ── Distortion (line→mic overload simulation) ───────────────────
const OVERLOAD_DRIVE_DB = 18;
const WAVESHAPER_SAMPLES = 1024;

// ── Phase shifter (Countryman 968A — envelope follower driven) ──
const PHASER_STAGE_COUNT = 6;
const PHASER_CENTER_HZ = 1000;
const PHASER_ENV_DEPTH_MAX_HZ = 1200;
const PHASER_ENV_SMOOTH_HZ = 15;

// ── Compression ─────────────────────────────────────────────────
const COMP_THRESHOLD_DB = -18;
const COMP_KNEE_DB = 6;
const COMP_RATIO = 8;
const COMP_ATTACK_S = 0.003;
const COMP_RELEASE_S = 0.15;

const LIMITER_THRESHOLD_DB = -3;
const LIMITER_KNEE_DB = 0;
const LIMITER_RATIO = 20;
const LIMITER_ATTACK_S = 0.001;
const LIMITER_RELEASE_S = 0.05;

// ── Noise buffer ─────────────────────────────────────────────────
const NOISE_BUFFER_DURATION_S = 2;

// ── Output filter defaults ───────────────────────────────────────
const FILTER_CUTOFF_MIN_HZ = 20;
const FILTER_CUTOFF_MAX_HZ = 20000;
const DEFAULT_FILTER_CUTOFF_HZ = 20000;
const DEFAULT_FILTER_RESONANCE = 0;
const FILTER_ENVELOPE_SMOOTH_HZ = 20;

// ── Misc ─────────────────────────────────────────────────────────
const PARAM_RAMP_S = 0.05;
const RECTIFIER_SAMPLES = 256;
const DEFAULT_BAND_COUNT = 16;
const DEFAULT_WET_DRY = 1.0;
const DEFAULT_FORMANT_SHIFT = 1.0;
const DEFAULT_SPEED = 1.0;

// ── Band structure ───────────────────────────────────────────────
interface CylonBand {
  analysisBPFs: BiquadFilterNode[];   // cascaded for steeper slope
  rectifier: WaveShaperNode;
  envLPF: BiquadFilterNode;
  envBoost: GainNode;                 // amplifies envelope before driving carrier
  synthesisBPFs: BiquadFilterNode[];  // cascaded for steeper slope
  carrierGain: GainNode;
  bandGain: GainNode;
}

/** Full-wave rectifier curve for envelope extraction */
function makeRectifierCurve(samples: number): Float32Array {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    curve[i] = Math.abs((i / (samples - 1)) * 2 - 1);
  }
  return curve;
}

/**
 * Asymmetric soft-clip distortion simulating line-level signal
 * overloading a microphone preamp input.
 */
function makeOverloadCurve(): Float32Array {
  const curve = new Float32Array(WAVESHAPER_SAMPLES);
  const driveLinear = Math.pow(10, OVERLOAD_DRIVE_DB / 20);
  for (let i = 0; i < WAVESHAPER_SAMPLES; i++) {
    const x = ((i / (WAVESHAPER_SAMPLES - 1)) * 2 - 1) * driveLinear;
    if (x >= 0) {
      curve[i] = Math.tanh(x * 1.5);
    } else {
      curve[i] = Math.tanh(x * 1.0);
    }
  }
  return curve;
}

export class CylonVocoder {
  private ctx: AudioContext;
  private bands: CylonBand[] = [];
  private outputGain: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private speechSource: AudioBufferSourceNode | null = null;
  private playGeneration = 0;
  private needsRebuild = false;

  // ── Nagra tape EQ ─────────────────────────────────────────────
  private nagraLowShelf: BiquadFilterNode;
  private nagraHighShelf: BiquadFilterNode;

  // ── Pre-vocoder broadcast limiter ─────────────────────────────
  private inputLimiter: DynamicsCompressorNode;

  // ── Carrier sources ────────────────────────────────────────────
  private carrierOsc: OscillatorNode | null = null;
  private carrierOscGain: GainNode;
  private noiseSource: AudioBufferSourceNode | null = null;
  private noiseGain: GainNode;
  private carrierMix: GainNode;
  private noiseBuffer: AudioBuffer | null = null;

  // ── Sibilance passthrough (off by default) ─────────────────────
  private sibilanceHP: BiquadFilterNode;
  private sibilanceGain: GainNode;

  // ── Post-vocoder compressor ────────────────────────────────────
  private postCompressor: DynamicsCompressorNode;

  // ── Distortion ─────────────────────────────────────────────────
  private overloadShaper: WaveShaperNode;

  // ── Phase shifter (envelope follower) ──────────────────────────
  private phaserStages: BiquadFilterNode[] = [];
  private phaserEnvRect: WaveShaperNode;
  private phaserEnvLPF: BiquadFilterNode;
  private phaserEnvDepth: GainNode;

  // ── Final limiter ─────────────────────────────────────────────
  private finalLimiter: DynamicsCompressorNode;

  // ── Output filters ─────────────────────────────────────────────
  private filterHP1: BiquadFilterNode;
  private filterHP2: BiquadFilterNode;
  private filterLP1: BiquadFilterNode;
  private filterLP2: BiquadFilterNode;
  private filterEnvRect: WaveShaperNode;
  private filterEnvLPF: BiquadFilterNode;
  private filterEnvGain: GainNode;

  // ── State ──────────────────────────────────────────────────────
  private creatureParams: CreatureParams = { bodySize: 0.5, material: 0.0, aggression: 0.0 };
  private vocoderParams: VocoderParams = {
    bandCount: DEFAULT_BAND_COUNT,
    carrierType: 'saw',
    wetDry: DEFAULT_WET_DRY,
    formantShift: DEFAULT_FORMANT_SHIFT,
    speed: DEFAULT_SPEED,
    filterHPCutoff: FILTER_CUTOFF_MIN_HZ,
    filterHPResonance: DEFAULT_FILTER_RESONANCE,
    filterCutoff: DEFAULT_FILTER_CUTOFF_HZ,
    filterResonance: DEFAULT_FILTER_RESONANCE,
    filterEnvFollow: 0,
  };

  constructor(ctx: AudioContext) {
    this.ctx = ctx;

    // ── Wet / dry / output ───────────────────────────────────────
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 1.0;

    this.dryGain = ctx.createGain();
    this.dryGain.gain.value = 0.0;

    this.wetGain = ctx.createGain();
    this.wetGain.gain.value = 1.0;

    // ── Nagra tape EQ ────────────────────────────────────────────
    this.nagraLowShelf = ctx.createBiquadFilter();
    this.nagraLowShelf.type = 'lowshelf';
    this.nagraLowShelf.frequency.value = NAGRA_LOW_SHELF_FREQ_HZ;
    this.nagraLowShelf.gain.value = NAGRA_LOW_SHELF_GAIN_DB;

    this.nagraHighShelf = ctx.createBiquadFilter();
    this.nagraHighShelf.type = 'highshelf';
    this.nagraHighShelf.frequency.value = NAGRA_HIGH_SHELF_FREQ_HZ;
    this.nagraHighShelf.gain.value = NAGRA_HIGH_SHELF_GAIN_DB;

    this.nagraLowShelf.connect(this.nagraHighShelf);

    // ── Input broadcast limiter ──────────────────────────────────
    this.inputLimiter = ctx.createDynamicsCompressor();
    this.inputLimiter.threshold.value = COMP_THRESHOLD_DB;
    this.inputLimiter.knee.value = COMP_KNEE_DB;
    this.inputLimiter.ratio.value = COMP_RATIO;
    this.inputLimiter.attack.value = COMP_ATTACK_S;
    this.inputLimiter.release.value = COMP_RELEASE_S;

    this.nagraHighShelf.connect(this.inputLimiter);

    // ── Carrier mix ──────────────────────────────────────────────
    this.carrierOscGain = ctx.createGain();
    this.carrierOscGain.gain.value = 1.0;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0.0;

    this.carrierMix = ctx.createGain();
    this.carrierMix.gain.value = 1.0;
    this.carrierOscGain.connect(this.carrierMix);
    this.noiseGain.connect(this.carrierMix);

    // ── Sibilance passthrough (off by default) ───────────────────
    this.sibilanceHP = ctx.createBiquadFilter();
    this.sibilanceHP.type = 'highpass';
    this.sibilanceHP.frequency.value = SIBILANCE_HP_FREQ_HZ;
    this.sibilanceHP.Q.value = 0.7;

    this.sibilanceGain = ctx.createGain();
    this.sibilanceGain.gain.value = SIBILANCE_MIX_DEFAULT;
    this.sibilanceHP.connect(this.sibilanceGain);
    this.sibilanceGain.connect(this.wetGain);

    // ── Post-vocoder compressor ──────────────────────────────────
    this.postCompressor = ctx.createDynamicsCompressor();
    this.postCompressor.threshold.value = COMP_THRESHOLD_DB;
    this.postCompressor.knee.value = COMP_KNEE_DB;
    this.postCompressor.ratio.value = COMP_RATIO;
    this.postCompressor.attack.value = COMP_ATTACK_S;
    this.postCompressor.release.value = COMP_RELEASE_S;

    // ── Distortion (line→mic overload) ───────────────────────────
    this.overloadShaper = ctx.createWaveShaper();
    this.overloadShaper.curve = makeOverloadCurve();
    this.overloadShaper.oversample = '2x';

    // ── Phase shifter (envelope follower driven) ─────────────────
    this.phaserEnvRect = ctx.createWaveShaper();
    this.phaserEnvRect.curve = makeRectifierCurve(RECTIFIER_SAMPLES);

    this.phaserEnvLPF = ctx.createBiquadFilter();
    this.phaserEnvLPF.type = 'lowpass';
    this.phaserEnvLPF.frequency.value = PHASER_ENV_SMOOTH_HZ;
    this.phaserEnvLPF.Q.value = 0.5;

    this.phaserEnvDepth = ctx.createGain();
    this.phaserEnvDepth.gain.value = 0;

    this.phaserEnvRect.connect(this.phaserEnvLPF);
    this.phaserEnvLPF.connect(this.phaserEnvDepth);

    for (let i = 0; i < PHASER_STAGE_COUNT; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = 'allpass';
      ap.frequency.value = PHASER_CENTER_HZ;
      ap.Q.value = 0.5;
      this.phaserEnvDepth.connect(ap.frequency);
      this.phaserStages.push(ap);
    }

    // ── Final limiter ────────────────────────────────────────────
    this.finalLimiter = ctx.createDynamicsCompressor();
    this.finalLimiter.threshold.value = LIMITER_THRESHOLD_DB;
    this.finalLimiter.knee.value = LIMITER_KNEE_DB;
    this.finalLimiter.ratio.value = LIMITER_RATIO;
    this.finalLimiter.attack.value = LIMITER_ATTACK_S;
    this.finalLimiter.release.value = LIMITER_RELEASE_S;

    // ── Output filter chain ──────────────────────────────────────
    this.filterHP1 = ctx.createBiquadFilter();
    this.filterHP1.type = 'highpass';
    this.filterHP1.frequency.value = FILTER_CUTOFF_MIN_HZ;
    this.filterHP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterHP2 = ctx.createBiquadFilter();
    this.filterHP2.type = 'highpass';
    this.filterHP2.frequency.value = FILTER_CUTOFF_MIN_HZ;
    this.filterHP2.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterLP1 = ctx.createBiquadFilter();
    this.filterLP1.type = 'lowpass';
    this.filterLP1.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterLP2 = ctx.createBiquadFilter();
    this.filterLP2.type = 'lowpass';
    this.filterLP2.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP2.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterEnvRect = ctx.createWaveShaper();
    this.filterEnvRect.curve = makeRectifierCurve(RECTIFIER_SAMPLES);

    this.filterEnvLPF = ctx.createBiquadFilter();
    this.filterEnvLPF.type = 'lowpass';
    this.filterEnvLPF.frequency.value = FILTER_ENVELOPE_SMOOTH_HZ;
    this.filterEnvLPF.Q.value = 0.5;

    this.filterEnvGain = ctx.createGain();
    this.filterEnvGain.gain.value = 0;

    // ── Wire output chain ────────────────────────────────────────
    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);

    this.outputGain.connect(this.postCompressor);
    this.postCompressor.connect(this.overloadShaper);

    // Feed phaser envelope follower from distorted signal
    this.overloadShaper.connect(this.phaserEnvRect);

    // Distortion → phaser cascade → final limiter
    let phaserInput: AudioNode = this.overloadShaper;
    for (const stage of this.phaserStages) {
      phaserInput.connect(stage);
      phaserInput = stage;
    }
    phaserInput.connect(this.finalLimiter);

    this.finalLimiter.connect(this.filterHP1);
    this.filterHP1.connect(this.filterHP2);
    this.filterHP2.connect(this.filterLP1);
    this.filterLP1.connect(this.filterLP2);
    this.filterLP2.connect(ctx.destination);

    // Output envelope → LP cutoff modulation
    this.outputGain.connect(this.filterEnvRect);
    this.filterEnvRect.connect(this.filterEnvLPF);
    this.filterEnvLPF.connect(this.filterEnvGain);
    this.filterEnvGain.connect(this.filterLP1.frequency);
    this.filterEnvGain.connect(this.filterLP2.frequency);
  }

  setSibilanceParams(crossoverHz: number, mix: number): void {
    const now = this.ctx.currentTime;
    this.sibilanceHP.frequency.linearRampToValueAtTime(crossoverHz, now + PARAM_RAMP_S);
    this.sibilanceGain.gain.linearRampToValueAtTime(mix, now + PARAM_RAMP_S);
  }

  setCreatureParams(params: CreatureParams): void {
    this.creatureParams = { ...params };
    const now = this.ctx.currentTime;

    // bodySize → carrier pitch
    if (this.carrierOsc) {
      const freq = CARRIER_FREQ_MAX_HZ -
        params.bodySize * (CARRIER_FREQ_MAX_HZ - CARRIER_FREQ_MIN_HZ);
      this.carrierOsc.frequency.linearRampToValueAtTime(freq, now + PARAM_RAMP_S);
    }

    // material → phaser envelope follower depth
    const phaserDepth = params.material * PHASER_ENV_DEPTH_MAX_HZ;
    this.phaserEnvDepth.gain.linearRampToValueAtTime(phaserDepth, now + PARAM_RAMP_S);

    // aggression → noise blend
    this.carrierOscGain.gain.linearRampToValueAtTime(
      1.0 - params.aggression, now + PARAM_RAMP_S,
    );
    this.noiseGain.gain.linearRampToValueAtTime(
      params.aggression, now + PARAM_RAMP_S,
    );
  }

  setVocoderParams(params: VocoderParams): void {
    const bandCountChanged = params.bandCount !== this.vocoderParams.bandCount;
    const formantShiftChanged = params.formantShift !== this.vocoderParams.formantShift;
    this.vocoderParams = { ...params };
    const now = this.ctx.currentTime;

    // Wet/dry
    this.wetGain.gain.cancelScheduledValues(now);
    this.dryGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.setValueAtTime(params.wetDry, now);
    this.dryGain.gain.setValueAtTime(1.0 - params.wetDry, now);

    // Speech speed
    if (this.speechSource) {
      this.speechSource.playbackRate.setValueAtTime(params.speed, now);
    }

    // HP filter
    this.filterHP1.frequency.setValueAtTime(params.filterHPCutoff, now);
    this.filterHP2.frequency.setValueAtTime(params.filterHPCutoff, now);
    this.filterHP1.Q.setValueAtTime(params.filterHPResonance, now);
    this.filterHP2.Q.setValueAtTime(params.filterHPResonance, now);

    // LP filter
    this.filterLP1.frequency.setValueAtTime(params.filterCutoff, now);
    this.filterLP2.frequency.setValueAtTime(params.filterCutoff, now);
    this.filterLP1.Q.setValueAtTime(params.filterResonance, now);
    this.filterLP2.Q.setValueAtTime(params.filterResonance, now);

    // Env follow
    const envRange = (FILTER_CUTOFF_MAX_HZ - params.filterCutoff) * params.filterEnvFollow;
    this.filterEnvGain.gain.setValueAtTime(envRange, now);

    if (bandCountChanged) {
      this.rebuildBandsLive();
    } else if (formantShiftChanged) {
      this.updateSynthesisFrequencies();
    }
  }

  play(buffer: AudioBuffer, loop: boolean, onEnded?: () => void, _offlineDuration?: number): void {
    this.stop();

    if (this.bands.length === 0 || this.needsRebuild ||
        this.bands.length !== this.vocoderParams.bandCount) {
      this.buildBands();
      this.needsRebuild = false;
    }

    this.speechSource = this.ctx.createBufferSource();
    this.speechSource.buffer = buffer;
    this.speechSource.loop = loop;
    this.speechSource.playbackRate.value = this.vocoderParams.speed;

    // Speech → Nagra EQ → limiter → analysis BPFs
    this.speechSource.connect(this.nagraLowShelf);
    for (const band of this.bands) {
      this.inputLimiter.connect(band.analysisBPFs[0]);
    }

    // Speech → dry path + sibilance
    this.speechSource.connect(this.dryGain);
    this.speechSource.connect(this.sibilanceHP);

    // Start carrier
    const now = this.ctx.currentTime;
    this.startCarrier(now);

    const generation = ++this.playGeneration;
    this.speechSource.onended = () => {
      if (generation !== this.playGeneration) return;
      this.cleanupAfterPlay();
      onEnded?.();
    };

    this.speechSource.start(now);
  }

  stop(): void {
    if (this.speechSource) {
      this.speechSource.onended = null;
      try { this.speechSource.stop(); } catch { /* already stopped */ }
      this.cleanupAfterPlay();
    }
  }

  // ── Internal: carrier ──────────────────────────────────────────

  private startCarrier(time: number): void {
    const freq = CARRIER_FREQ_MAX_HZ -
      this.creatureParams.bodySize * (CARRIER_FREQ_MAX_HZ - CARRIER_FREQ_MIN_HZ);

    this.carrierOsc = this.ctx.createOscillator();
    this.carrierOsc.type = 'sawtooth';
    this.carrierOsc.frequency.value = freq;
    this.carrierOsc.connect(this.carrierOscGain);
    this.carrierOsc.start(time);

    if (!this.noiseBuffer) {
      this.noiseBuffer = this.generateNoiseBuffer();
    }
    this.noiseSource = this.ctx.createBufferSource();
    this.noiseSource.buffer = this.noiseBuffer;
    this.noiseSource.loop = true;
    this.noiseSource.connect(this.noiseGain);
    this.noiseSource.start(time);

    // Carrier mix → first synthesis BPF of each band
    for (const band of this.bands) {
      this.carrierMix.connect(band.synthesisBPFs[0]);
    }
  }

  private stopCarrier(): void {
    if (this.carrierOsc) {
      try { this.carrierOsc.stop(); } catch { /* */ }
      this.carrierOsc.disconnect();
      this.carrierOsc = null;
    }
    if (this.noiseSource) {
      try { this.noiseSource.stop(); } catch { /* */ }
      this.noiseSource.disconnect();
      this.noiseSource = null;
    }
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

  // ── Internal: filterbank ───────────────────────────────────────

  private buildBands(): void {
    this.destroyBands();

    const count = this.vocoderParams.bandCount;
    const shift = this.vocoderParams.formantShift;
    const logMin = Math.log2(MIN_FREQ_HZ);
    const logMax = Math.log2(MAX_FREQ_HZ);

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;

      // Analysis: cascaded BPFs → rectifier → LPF → boost
      const analysisBPFs: BiquadFilterNode[] = [];
      for (let s = 0; s < BPFS_PER_BAND; s++) {
        const bpf = this.ctx.createBiquadFilter();
        bpf.type = 'bandpass';
        bpf.frequency.value = centerFreq;
        bpf.Q.value = BAND_Q;
        if (s > 0) analysisBPFs[s - 1].connect(bpf);
        analysisBPFs.push(bpf);
      }

      const rectifier = this.ctx.createWaveShaper();
      rectifier.curve = makeRectifierCurve(RECTIFIER_SAMPLES);
      rectifier.oversample = 'none';

      const envLPF = this.ctx.createBiquadFilter();
      envLPF.type = 'lowpass';
      envLPF.frequency.value = ENVELOPE_SMOOTH_HZ;
      envLPF.Q.value = 0.5;

      // Envelope boost: amplifies the tiny envelope signal so it
      // actually drives meaningful gain modulation on the carrier
      const envBoost = this.ctx.createGain();
      envBoost.gain.value = ENVELOPE_BOOST;

      analysisBPFs[analysisBPFs.length - 1].connect(rectifier);
      rectifier.connect(envLPF);
      envLPF.connect(envBoost);

      // Synthesis: cascaded BPFs → carrier gain (envelope-modulated)
      const synthesisBPFs: BiquadFilterNode[] = [];
      for (let s = 0; s < BPFS_PER_BAND; s++) {
        const bpf = this.ctx.createBiquadFilter();
        bpf.type = 'bandpass';
        bpf.frequency.value = synthFreq;
        bpf.Q.value = BAND_Q;
        if (s > 0) synthesisBPFs[s - 1].connect(bpf);
        synthesisBPFs.push(bpf);
      }

      const carrierGain = this.ctx.createGain();
      carrierGain.gain.value = 0;
      envBoost.connect(carrierGain.gain); // boosted envelope drives carrier amplitude

      synthesisBPFs[synthesisBPFs.length - 1].connect(carrierGain);

      const bandGain = this.ctx.createGain();
      bandGain.gain.value = BAND_LEVEL_GAIN;
      carrierGain.connect(bandGain);
      bandGain.connect(this.wetGain);

      this.bands.push({
        analysisBPFs, rectifier, envLPF, envBoost,
        synthesisBPFs, carrierGain, bandGain,
      });
    }
  }

  private rebuildBandsLive(): void {
    if (!this.speechSource) {
      this.needsRebuild = true;
      return;
    }

    this.stopCarrier();
    this.destroyBands();
    this.buildBands();

    // Reconnect limiter → analysis BPFs
    for (const band of this.bands) {
      this.inputLimiter.connect(band.analysisBPFs[0]);
    }

    this.startCarrier(this.ctx.currentTime);
    this.needsRebuild = false;
  }

  private updateSynthesisFrequencies(): void {
    if (this.bands.length === 0) return;

    const count = this.bands.length;
    const shift = this.vocoderParams.formantShift;
    const logMin = Math.log2(MIN_FREQ_HZ);
    const logMax = Math.log2(MAX_FREQ_HZ);
    const now = this.ctx.currentTime;

    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5;
      const centerFreq = Math.pow(2, logMin + t * (logMax - logMin));
      const synthFreq = centerFreq * shift;
      for (const bpf of this.bands[i].synthesisBPFs) {
        bpf.frequency.linearRampToValueAtTime(synthFreq, now + PARAM_RAMP_S);
      }
    }
  }

  private destroyBands(): void {
    for (const band of this.bands) {
      for (const bpf of band.analysisBPFs) bpf.disconnect();
      band.rectifier.disconnect();
      band.envLPF.disconnect();
      band.envBoost.disconnect();
      for (const bpf of band.synthesisBPFs) bpf.disconnect();
      band.carrierGain.disconnect();
      band.bandGain.disconnect();
    }
    this.bands = [];
  }

  private cleanupAfterPlay(): void {
    this.stopCarrier();
    this.speechSource?.disconnect();
    this.speechSource = null;
    this.destroyBands();
  }
}
