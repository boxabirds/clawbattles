/**
 * ShepardVocoder: Resonant filter bank driven by Shepard tone frequencies.
 *
 * Architecture (completely different from a traditional channel vocoder):
 *   Speech → parallel resonant BPFs → Gaussian-weighted gains → sum → wet/dry → output
 *
 * Each BPF's center frequency tracks one "layer" of a virtual Shepard tone,
 * sweeping continuously upward through the log-frequency spectrum. Gaussian
 * amplitude weighting centered on a creature-controlled frequency creates the
 * auditory illusion of infinite rise. High-Q filters make each resonant peak
 * dramatically color the speech as it sweeps through.
 *
 * This is the approach used by Endless Series' "filter bank" mode —
 * NOT envelope-extraction vocoding, which produces near-transparent results
 * when the modulator is a slowly-varying tonal signal like a Shepard tone.
 *
 * Creature params:
 *   - bodySize  → center frequency of Gaussian window (big = low, small = high)
 *   - material  → Gaussian sigma (organic = wide wash, metallic = narrow spotlight)
 *                + filter Q (organic = moderate resonance, metallic = sharp/ringy)
 *   - aggression → rise rate (calm = slow drift, aggressive = rapid sweep)
 *
 * Vocoder params:
 *   - bandCount → number of Shepard filter layers (more = smoother cascade)
 *   - formantShift → shifts the Gaussian center (< 1 = lower, > 1 = higher)
 *   - wetDry → balance between filtered and dry speech
 *   - speed → speech playback rate
 *   - filter* → output HP + LP chain
 */

import type { CreatureParams, VocoderParams } from './vocoder';

// ── Shepard sweep parameters ──────────────────────────────────────
const SHEPARD_NUM_LAYERS_DEFAULT = 16;
const SHEPARD_RISE_RATE_MIN_OCT_S = 0.1;   // aggression=0: slow drift
const SHEPARD_RISE_RATE_MAX_OCT_S = 2.0;   // aggression=1: rapid sweep
const SHEPARD_CENTER_HIGH_HZ = 4000;        // bodySize=0 (small creature)
const SHEPARD_CENTER_LOW_HZ = 200;          // bodySize=1 (large creature)
const SHEPARD_SIGMA_WIDE_OCT = 2.0;         // material=0 (organic): moderate focus
const SHEPARD_SIGMA_NARROW_OCT = 0.5;       // material=1 (metallic): tight spotlight
const SHEPARD_LOG_FREQ_MIN = Math.log2(30);
const SHEPARD_LOG_FREQ_MAX = Math.log2(16000);
const SHEPARD_LOG_RANGE = SHEPARD_LOG_FREQ_MAX - SHEPARD_LOG_FREQ_MIN;

// ── Filter resonance (Q) ─────────────────────────────────────────
const FILTER_Q_ORGANIC = 6;      // material=0: moderate resonance, broader peaks
const FILTER_Q_METALLIC = 25;    // material=1: sharp, ringy peaks
/** Gain applied per layer to keep output at reasonable level */
const LAYER_GAIN_SCALE = 4.0;

// ── Sweep update timing ──────────────────────────────────────────
/** How far ahead to schedule the next ramp target (seconds) */
const SWEEP_RAMP_TIME_S = 0.025;

// ── Output filter defaults ───────────────────────────────────────
const DEFAULT_FILTER_CUTOFF_HZ = 20000;
const DEFAULT_FILTER_RESONANCE = 0;
const DEFAULT_FILTER_ENV_FOLLOW = 0;
const FILTER_ENVELOPE_SMOOTH_HZ = 20;
const FILTER_CUTOFF_MIN_HZ = 20;
const FILTER_CUTOFF_MAX_HZ = 20000;

const DEFAULT_BAND_COUNT = 16;
const DEFAULT_WET_DRY = 1.0;
const DEFAULT_FORMANT_SHIFT = 1.0;
const DEFAULT_SPEED = 1.0;

const WAVESHAPER_SAMPLES = 256;

interface ShepardLayer {
  bpf: BiquadFilterNode;
  gain: GainNode;
}

function makeRectifierCurve(): Float32Array {
  const curve = new Float32Array(WAVESHAPER_SAMPLES);
  for (let i = 0; i < WAVESHAPER_SAMPLES; i++) {
    curve[i] = Math.abs((i / (WAVESHAPER_SAMPLES - 1)) * 2 - 1);
  }
  return curve;
}

export class ShepardVocoder {
  private ctx: AudioContext;
  private layers: ShepardLayer[] = [];
  private outputGain: GainNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private speechSource: AudioBufferSourceNode | null = null;
  private playGeneration = 0;
  private sweepStartTime = 0;
  private animFrameId = 0;

  // 4-pole highpass (two cascaded 2-pole biquads = 24 dB/oct)
  private filterHP1: BiquadFilterNode;
  private filterHP2: BiquadFilterNode;
  // 4-pole lowpass (two cascaded 2-pole biquads = 24 dB/oct)
  private filterLP1: BiquadFilterNode;
  private filterLP2: BiquadFilterNode;
  // Envelope follower for LP filter cutoff modulation
  private filterEnvRect: WaveShaperNode;
  private filterEnvLPF: BiquadFilterNode;
  private filterEnvGain: GainNode;

  // Derived sweep state (recomputed when creature params change)
  private riseRate = 0.67;
  private centerLogFreq = 11.04;
  private sigma = SHEPARD_SIGMA_WIDE_OCT;
  private filterQ = FILTER_Q_ORGANIC;

  private creatureParams: CreatureParams = { bodySize: 0.5, material: 0.0, aggression: 0.3 };
  private vocoderParams: VocoderParams = {
    bandCount: DEFAULT_BAND_COUNT,
    carrierType: 'fm', // ignored by ShepardVocoder
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

    // 4-pole highpass
    this.filterHP1 = ctx.createBiquadFilter();
    this.filterHP1.type = 'highpass';
    this.filterHP1.frequency.value = FILTER_CUTOFF_MIN_HZ;
    this.filterHP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterHP2 = ctx.createBiquadFilter();
    this.filterHP2.type = 'highpass';
    this.filterHP2.frequency.value = FILTER_CUTOFF_MIN_HZ;
    this.filterHP2.Q.value = DEFAULT_FILTER_RESONANCE;

    // 4-pole lowpass
    this.filterLP1 = ctx.createBiquadFilter();
    this.filterLP1.type = 'lowpass';
    this.filterLP1.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP1.Q.value = DEFAULT_FILTER_RESONANCE;

    this.filterLP2 = ctx.createBiquadFilter();
    this.filterLP2.type = 'lowpass';
    this.filterLP2.frequency.value = DEFAULT_FILTER_CUTOFF_HZ;
    this.filterLP2.Q.value = DEFAULT_FILTER_RESONANCE;

    // Envelope follower for LP filter cutoff modulation
    this.filterEnvRect = ctx.createWaveShaper();
    this.filterEnvRect.curve = makeRectifierCurve();

    this.filterEnvLPF = ctx.createBiquadFilter();
    this.filterEnvLPF.type = 'lowpass';
    this.filterEnvLPF.frequency.value = FILTER_ENVELOPE_SMOOTH_HZ;
    this.filterEnvLPF.Q.value = 0.5;

    this.filterEnvGain = ctx.createGain();
    this.filterEnvGain.gain.value = 0;

    // Signal chain: wet/dry → output → HP1 → HP2 → LP1 → LP2 → destination
    this.dryGain.connect(this.outputGain);
    this.wetGain.connect(this.outputGain);
    this.outputGain.connect(this.filterHP1);
    this.filterHP1.connect(this.filterHP2);
    this.filterHP2.connect(this.filterLP1);
    this.filterLP1.connect(this.filterLP2);
    this.filterLP2.connect(ctx.destination);

    // Envelope follower → LP filter cutoff
    this.outputGain.connect(this.filterEnvRect);
    this.filterEnvRect.connect(this.filterEnvLPF);
    this.filterEnvLPF.connect(this.filterEnvGain);
    this.filterEnvGain.connect(this.filterLP1.frequency);
    this.filterEnvGain.connect(this.filterLP2.frequency);

    this.updateDerivedParams();
  }

  setCreatureParams(params: CreatureParams): void {
    this.creatureParams = { ...params };
    this.updateDerivedParams();
    // Live layers will pick up new params on next animation frame
  }

  setVocoderParams(params: VocoderParams): void {
    const bandCountChanged = params.bandCount !== this.vocoderParams.bandCount;
    this.vocoderParams = { ...params };

    const now = this.ctx.currentTime;

    // Wet/dry
    this.wetGain.gain.cancelScheduledValues(now);
    this.dryGain.gain.cancelScheduledValues(now);
    this.wetGain.gain.setValueAtTime(this.vocoderParams.wetDry, now);
    this.dryGain.gain.setValueAtTime(1.0 - this.vocoderParams.wetDry, now);

    // Speech playback speed
    if (this.speechSource) {
      this.speechSource.playbackRate.setValueAtTime(this.vocoderParams.speed, now);
    }

    // Highpass filter
    this.filterHP1.frequency.setValueAtTime(this.vocoderParams.filterHPCutoff, now);
    this.filterHP2.frequency.setValueAtTime(this.vocoderParams.filterHPCutoff, now);
    this.filterHP1.Q.setValueAtTime(this.vocoderParams.filterHPResonance, now);
    this.filterHP2.Q.setValueAtTime(this.vocoderParams.filterHPResonance, now);

    // Lowpass filter
    this.filterLP1.frequency.setValueAtTime(this.vocoderParams.filterCutoff, now);
    this.filterLP2.frequency.setValueAtTime(this.vocoderParams.filterCutoff, now);
    this.filterLP1.Q.setValueAtTime(this.vocoderParams.filterResonance, now);
    this.filterLP2.Q.setValueAtTime(this.vocoderParams.filterResonance, now);

    // Env follow: modulates LP cutoff upward from base
    const envRange =
      (FILTER_CUTOFF_MAX_HZ - this.vocoderParams.filterCutoff) * this.vocoderParams.filterEnvFollow;
    this.filterEnvGain.gain.setValueAtTime(envRange, now);

    if (bandCountChanged && this.speechSource) {
      this.rebuildLayersLive();
    }
  }

  /**
   * Play speech through the Shepard resonant filter bank.
   *
   * For real-time playback, filter frequencies update every animation frame.
   * For offline rendering (WAV export), pass offlineDuration to pre-schedule
   * the entire sweep upfront since requestAnimationFrame doesn't fire during
   * OfflineAudioContext.startRendering().
   */
  play(buffer: AudioBuffer, loop: boolean, onEnded?: () => void, offlineDuration?: number): void {
    this.stop();

    this.buildLayers();

    // Speech source
    this.speechSource = this.ctx.createBufferSource();
    this.speechSource.buffer = buffer;
    this.speechSource.loop = loop;
    this.speechSource.playbackRate.value = this.vocoderParams.speed;

    // Connect speech to all resonant filter layers
    for (const layer of this.layers) {
      this.speechSource.connect(layer.bpf);
    }
    // Connect speech to dry path
    this.speechSource.connect(this.dryGain);

    this.sweepStartTime = this.ctx.currentTime;
    const generation = ++this.playGeneration;

    this.speechSource.onended = () => {
      if (generation !== this.playGeneration) return;
      this.stopSweep();
      this.destroyLayers();
      onEnded?.();
    };

    this.speechSource.start();

    if (offlineDuration !== undefined) {
      // Offline mode: pre-schedule the entire frequency sweep
      this.preScheduleSweep(offlineDuration);
    } else {
      // Real-time mode: update filter frequencies every animation frame
      this.scheduleNextUpdate();
    }

    console.log(
      `[shepard] resonant filter bank: ${this.layers.length} layers, ` +
      `Q=${this.filterQ.toFixed(1)}, sigma=${this.sigma.toFixed(2)} oct, ` +
      `rise=${this.riseRate.toFixed(2)} oct/s, ` +
      `center=${Math.pow(2, this.centerLogFreq).toFixed(0)} Hz` +
      (offlineDuration !== undefined ? ` (offline: ${offlineDuration.toFixed(1)}s)` : ''),
    );
  }

  stop(): void {
    if (this.speechSource) {
      this.speechSource.onended = null;
      try { this.speechSource.stop(); } catch { /* already stopped */ }
      this.speechSource.disconnect();
      this.speechSource = null;
    }
    this.stopSweep();
    this.destroyLayers();
  }

  // ── Internal: derived params from creature settings ────────────

  private updateDerivedParams(): void {
    const { bodySize, material, aggression } = this.creatureParams;

    this.riseRate = SHEPARD_RISE_RATE_MIN_OCT_S +
      aggression * (SHEPARD_RISE_RATE_MAX_OCT_S - SHEPARD_RISE_RATE_MIN_OCT_S);

    this.centerLogFreq = Math.log2(
      SHEPARD_CENTER_HIGH_HZ - bodySize * (SHEPARD_CENTER_HIGH_HZ - SHEPARD_CENTER_LOW_HZ),
    );

    this.sigma = SHEPARD_SIGMA_WIDE_OCT -
      material * (SHEPARD_SIGMA_WIDE_OCT - SHEPARD_SIGMA_NARROW_OCT);

    this.filterQ = FILTER_Q_ORGANIC +
      material * (FILTER_Q_METALLIC - FILTER_Q_ORGANIC);
  }

  // ── Internal: resonant filter layer management ─────────────────

  private buildLayers(): void {
    this.destroyLayers();

    const count = this.vocoderParams.bandCount;
    for (let k = 0; k < count; k++) {
      const bpf = this.ctx.createBiquadFilter();
      bpf.type = 'bandpass';
      bpf.Q.value = this.filterQ;

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      bpf.connect(gain);
      gain.connect(this.wetGain);

      this.layers.push({ bpf, gain });
    }

    // Set initial frequencies before first frame
    this.updateLayerFrequencies();
  }

  private rebuildLayersLive(): void {
    const hadSource = !!this.speechSource;
    this.destroyLayers();
    this.buildLayers();

    if (hadSource && this.speechSource) {
      for (const layer of this.layers) {
        this.speechSource.connect(layer.bpf);
      }
    }
  }

  private destroyLayers(): void {
    for (const layer of this.layers) {
      layer.bpf.disconnect();
      layer.gain.disconnect();
    }
    this.layers = [];
  }

  // ── Internal: Shepard frequency sweep ──────────────────────────

  /**
   * Compute current Shepard layer frequencies and Gaussian gains,
   * then schedule smooth ramps on each BPF.
   *
   * Called every animation frame during playback.
   */
  private updateLayerFrequencies(): void {
    const count = this.layers.length;
    if (count === 0) return;

    const elapsed = this.ctx.currentTime - this.sweepStartTime;
    const twoSigmaSq = 2 * this.sigma * this.sigma;
    const rampTarget = this.ctx.currentTime + SWEEP_RAMP_TIME_S;
    const formantShiftOct = Math.log2(this.vocoderParams.formantShift);

    for (let k = 0; k < count; k++) {
      // Position in the log-frequency range [0..1], sweeping upward
      const basePosition = k / count;
      const sweep = (elapsed * this.riseRate) / SHEPARD_LOG_RANGE;
      const position = ((basePosition + sweep) % 1 + 1) % 1;

      const logFreq = SHEPARD_LOG_FREQ_MIN + position * SHEPARD_LOG_RANGE;
      const freq = Math.pow(2, logFreq);

      // Gaussian amplitude: centered on creature's center frequency
      // (shifted by formantShift in octaves)
      const shiftedCenter = this.centerLogFreq + formantShiftOct;
      const dist = logFreq - shiftedCenter;
      const amp = Math.exp(-(dist * dist) / twoSigmaSq);

      // Schedule smooth ramp to avoid zipper noise
      const { bpf, gain } = this.layers[k];
      bpf.frequency.linearRampToValueAtTime(freq, rampTarget);
      bpf.Q.linearRampToValueAtTime(this.filterQ, rampTarget);
      gain.gain.linearRampToValueAtTime(amp * LAYER_GAIN_SCALE / count, rampTarget);
    }
  }

  /**
   * Pre-schedule the entire Shepard sweep for offline rendering.
   * Computes frequency/gain ramps at fixed intervals across the full duration.
   */
  private preScheduleSweep(duration: number): void {
    const count = this.layers.length;
    if (count === 0) return;

    const twoSigmaSq = 2 * this.sigma * this.sigma;
    const formantShiftOct = Math.log2(this.vocoderParams.formantShift);
    const stepInterval = SWEEP_RAMP_TIME_S;
    const numSteps = Math.ceil(duration / stepInterval);
    const baseTime = this.ctx.currentTime;

    for (let step = 0; step <= numSteps; step++) {
      const t = step * stepInterval;
      const targetTime = baseTime + t;

      for (let k = 0; k < count; k++) {
        const basePosition = k / count;
        const sweep = (t * this.riseRate) / SHEPARD_LOG_RANGE;
        const position = ((basePosition + sweep) % 1 + 1) % 1;

        const logFreq = SHEPARD_LOG_FREQ_MIN + position * SHEPARD_LOG_RANGE;
        const freq = Math.pow(2, logFreq);

        const shiftedCenter = this.centerLogFreq + formantShiftOct;
        const dist = logFreq - shiftedCenter;
        const amp = Math.exp(-(dist * dist) / twoSigmaSq);

        const { bpf, gain } = this.layers[k];
        bpf.frequency.linearRampToValueAtTime(freq, targetTime);
        bpf.Q.linearRampToValueAtTime(this.filterQ, targetTime);
        gain.gain.linearRampToValueAtTime(amp * LAYER_GAIN_SCALE / count, targetTime);
      }
    }
  }

  private scheduleNextUpdate = (): void => {
    this.updateLayerFrequencies();
    this.animFrameId = requestAnimationFrame(this.scheduleNextUpdate);
  };

  private stopSweep(): void {
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = 0;
    }
  }
}
