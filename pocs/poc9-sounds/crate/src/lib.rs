use std::cell::UnsafeCell;
use std::f32::consts::TAU;
use wasm_bindgen::prelude::*;

// === Constants ===

const MAX_VOICES: usize = 32;
const CHANNELS: usize = 2;

// Frequency mapping: body_size 0.0 (small) → high pitch, 1.0 (large) → low pitch
const FREQ_SMALL: f32 = 600.0;
const FREQ_LARGE: f32 = 60.0;

// Mod index range: calm → aggressive
const MOD_INDEX_CALM: f32 = 1.0;
const MOD_INDEX_AGGRESSIVE: f32 = 12.0;

// Glottal source defaults
const GLOTTAL_ASPIRATION_DEFAULT: f32 = 0.1;

// Envelope time bounds (seconds)
const ATTACK_MIN_S: f32 = 0.001;
const DECAY_MIN_S: f32 = 0.02;
const RELEASE_MIN_S: f32 = 0.01;

// Denormal guard: tiny bias added to avoid subnormal float stalls
const DENORMAL_BIAS: f32 = 1.0e-25;

// === Sound types ===

#[wasm_bindgen]
#[repr(u32)]
#[derive(Clone, Copy)]
pub enum SoundType {
    Footstep = 0,
    ClawStrike = 1,
    PartDetach = 2,
    IdleBreath = 3,
    Vocalize = 4,
}

// === Envelope ===

#[derive(Clone, Copy, PartialEq)]
enum EnvStage {
    Idle,
    Attack,
    Decay,
    Sustain,
    Release,
}

#[derive(Clone)]
struct Envelope {
    attack_rate: f32,   // level increment per sample
    decay_rate: f32,    // level decrement per sample
    sustain: f32,       // sustain level (0..1)
    release_rate: f32,  // level decrement per sample
    stage: EnvStage,
    level: f32,
}

impl Envelope {
    fn new(sample_rate: f32, attack_s: f32, decay_s: f32, sustain: f32, release_s: f32) -> Self {
        let safe_attack = attack_s.max(ATTACK_MIN_S);
        let safe_decay = decay_s.max(DECAY_MIN_S);
        let safe_release = release_s.max(RELEASE_MIN_S);
        Self {
            attack_rate: 1.0 / (safe_attack * sample_rate),
            decay_rate: (1.0 - sustain) / (safe_decay * sample_rate),
            sustain,
            release_rate: sustain / (safe_release * sample_rate),
            stage: EnvStage::Attack,
            level: 0.0,
        }
    }

    fn tick(&mut self) -> f32 {
        match self.stage {
            EnvStage::Idle => 0.0,
            EnvStage::Attack => {
                self.level += self.attack_rate;
                if self.level >= 1.0 {
                    self.level = 1.0;
                    self.stage = EnvStage::Decay;
                }
                self.level
            }
            EnvStage::Decay => {
                self.level -= self.decay_rate;
                if self.level <= self.sustain {
                    self.level = self.sustain;
                    self.stage = if self.sustain > 0.001 {
                        EnvStage::Sustain
                    } else {
                        EnvStage::Idle
                    };
                }
                self.level
            }
            EnvStage::Sustain => self.level,
            EnvStage::Release => {
                self.level -= self.release_rate;
                if self.level <= 0.0 {
                    self.level = 0.0;
                    self.stage = EnvStage::Idle;
                }
                self.level
            }
        }
    }

    fn release(&mut self) {
        if self.stage != EnvStage::Idle {
            self.stage = EnvStage::Release;
            // Recalculate release rate from current level
            if self.level > 0.001 {
                let release_samples = self.level / self.release_rate.max(1.0e-10);
                self.release_rate = self.level / release_samples;
            }
        }
    }

    fn is_done(&self) -> bool {
        self.stage == EnvStage::Idle
    }
}

// === Simple PRNG (xorshift32, no std dep) ===

struct Rng {
    state: u32,
}

impl Rng {
    fn new(seed: u32) -> Self {
        Self { state: if seed == 0 { 1 } else { seed } }
    }

    /// Returns a float in [-1.0, 1.0]
    fn next_bipolar(&mut self) -> f32 {
        self.state ^= self.state << 13;
        self.state ^= self.state >> 17;
        self.state ^= self.state << 5;
        // Map u32 to [-1, 1]
        (self.state as f32 / (u32::MAX as f32)) * 2.0 - 1.0
    }
}

// === Formant filter (resonant bandpass via biquad) ===

#[derive(Clone)]
struct BiquadBP {
    b0: f32, b1: f32, b2: f32,
    a1: f32, a2: f32,
    x1: f32, x2: f32,
    y1: f32, y2: f32,
}

impl BiquadBP {
    fn new(center_hz: f32, q: f32, sample_rate: f32) -> Self {
        let w0 = TAU * center_hz / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        Self {
            b0: alpha / a0,
            b1: 0.0,
            b2: -alpha / a0,
            a1: -2.0 * w0.cos() / a0,
            a2: (1.0 - alpha) / a0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
              - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y + DENORMAL_BIAS;
        y
    }
}

// === Glottal source (pulse train + aspiration noise) ===
//
// Classic source-filter vocal model:
//   Rosenberg glottal pulse at f0 + aspiration noise → output
//   Output feeds into formant filter bank (BiquadBP) in Voice
//
// The pulse shape mimics vocal fold open/close cycle:
//   Open phase (0..GLOTTAL_OPEN_RATIO): sin²(π·t/open_ratio) — smooth opening
//   Closed phase (GLOTTAL_OPEN_RATIO..1): 0 — vocal folds shut
//
// This is deterministic + guaranteed to produce output.
// Noise adds breathiness; jitter adds biological pitch instability.

/// Fraction of the glottal cycle where vocal folds are open
const GLOTTAL_OPEN_RATIO: f32 = 0.6;

#[derive(Clone)]
struct GlottalSource {
    phase: f32,             // 0..1 within current glottal cycle
    freq: f32,              // fundamental frequency (Hz)
    phase_inc: f32,         // freq / sample_rate (precomputed)
    aspiration: f32,        // noise mix level (0..1)
    jitter_depth: f32,      // random perturbation of phase_inc per sample
    pulse_shape: f32,       // 1.0 = clean Rosenberg, higher = sharper/buzzier
}

impl GlottalSource {
    fn new(freq_hz: f32, sample_rate: f32, aspiration: f32, jitter: f32, pulse_shape: f32) -> Self {
        Self {
            phase: 0.0,
            freq: freq_hz,
            phase_inc: freq_hz / sample_rate,
            aspiration,
            jitter_depth: jitter,
            pulse_shape,
        }
    }

    /// Generate one sample of glottal excitation
    fn process(&mut self, rng: &mut Rng) -> f32 {
        // Rosenberg glottal pulse
        let pulse = if self.phase < GLOTTAL_OPEN_RATIO {
            // Open phase: sin²(π · t / open_ratio)
            let t = self.phase / GLOTTAL_OPEN_RATIO;
            let s = (t * std::f32::consts::PI).sin();
            s.powf(self.pulse_shape) // pulse_shape=1 → sin, 2 → sin², etc.
        } else {
            0.0
        };

        // Aspiration noise (present throughout cycle for breathiness)
        let noise = rng.next_bipolar() * self.aspiration;

        // Advance phase with jitter
        let jitter = if self.jitter_depth > 0.0 {
            1.0 + rng.next_bipolar() * self.jitter_depth
        } else {
            1.0
        };
        self.phase += self.phase_inc * jitter;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        pulse + noise
    }
}

// === Voice synthesis mode ===

#[derive(Clone, Copy, PartialEq)]
enum SynthMode {
    FM,       // Traditional FM (footstep, claw, detach)
    Glottal,  // Feedback delay + formant filters (vocalize, breath)
}

// === Voice ===

#[derive(Clone)]
struct Voice {
    active: bool,
    synth_mode: SynthMode,
    // FM oscillator 1 (fundamental) — used in FM mode
    carrier_phase: f32,
    carrier_freq: f32,
    mod_phase: f32,
    mod_ratio: f32,     // modulator_freq = carrier_freq * mod_ratio
    mod_index: f32,     // current modulation depth (radians)
    mod_index_target: f32, // mod index decays toward this
    mod_index_decay: f32,  // per-sample decay factor (0.999..)
    // FM oscillator 2 (formant / second partial) — FM mode only
    carrier2_phase: f32,
    carrier2_freq: f32,
    mod2_phase: f32,
    mod2_ratio: f32,
    mod2_index: f32,
    carrier2_gain: f32,  // 0.0 = disabled
    // Glottal source — used in Glottal mode
    glottal: GlottalSource,
    // Formant filters (bandpass resonators)
    // In FM mode: driven by noise (noise_gain > 0)
    // In Glottal mode: driven by glottal source output
    formant1: BiquadBP,
    formant2: BiquadBP,
    formant3: BiquadBP,
    noise_gain: f32,     // FM mode: noise through formants; Glottal mode: aspiration mix
    // Vibrato
    vibrato_phase: f32,
    vibrato_rate: f32,   // Hz
    vibrato_depth: f32,  // semitones
    // Pitch sweep (Hz/sample, for descending sounds)
    pitch_sweep: f32,
    // Amplitude
    envelope: Envelope,
    gain: f32,
    pan: f32,           // -1.0 (left) to 1.0 (right)
    // Voice stealing
    age: u64,
}

const DEFAULT_BIQUAD: BiquadBP = BiquadBP {
    b0: 0.0, b1: 0.0, b2: 0.0,
    a1: 0.0, a2: 0.0,
    x1: 0.0, x2: 0.0,
    y1: 0.0, y2: 0.0,
};

const DEFAULT_GLOTTAL: GlottalSource = GlottalSource {
    phase: 0.0,
    freq: 100.0,
    phase_inc: 100.0 / 48000.0,
    aspiration: GLOTTAL_ASPIRATION_DEFAULT,
    jitter_depth: 0.0,
    pulse_shape: 2.0,
};

impl Voice {
    fn new() -> Self {
        Self {
            active: false,
            synth_mode: SynthMode::FM,
            carrier_phase: 0.0,
            carrier_freq: 440.0,
            mod_phase: 0.0,
            mod_ratio: 2.0,
            mod_index: 1.0,
            mod_index_target: 1.0,
            mod_index_decay: 1.0,
            carrier2_phase: 0.0,
            carrier2_freq: 0.0,
            mod2_phase: 0.0,
            mod2_ratio: 1.0,
            mod2_index: 0.0,
            carrier2_gain: 0.0,
            glottal: DEFAULT_GLOTTAL,
            formant1: DEFAULT_BIQUAD,
            formant2: DEFAULT_BIQUAD,
            formant3: DEFAULT_BIQUAD,
            noise_gain: 0.0,
            vibrato_phase: 0.0,
            vibrato_rate: 0.0,
            vibrato_depth: 0.0,
            pitch_sweep: 0.0,
            envelope: Envelope {
                attack_rate: 0.0,
                decay_rate: 0.0,
                sustain: 0.0,
                release_rate: 0.0,
                stage: EnvStage::Idle,
                level: 0.0,
            },
            gain: 0.5,
            pan: 0.0,
            age: 0,
        }
    }

    fn render_sample(&mut self, phase_inc_factor: f32, sample_rate: f32, rng: &mut Rng) -> (f32, f32) {
        if !self.active {
            return (0.0, 0.0);
        }

        let env = self.envelope.tick();
        if self.envelope.is_done() {
            self.active = false;
            return (0.0, 0.0);
        }

        // Vibrato: compute frequency multiplier
        let vibrato = if self.vibrato_depth > 0.0 {
            let vib = (self.vibrato_phase).sin() * self.vibrato_depth;
            self.vibrato_phase += self.vibrato_rate * phase_inc_factor;
            if self.vibrato_phase > TAU { self.vibrato_phase -= TAU; }
            // Convert semitones to frequency multiplier
            (2.0_f32).powf(vib / 12.0)
        } else {
            1.0
        };

        let sample = match self.synth_mode {
            SynthMode::FM => self.render_fm(phase_inc_factor, vibrato, rng),
            SynthMode::Glottal => self.render_glottal(sample_rate, vibrato, rng),
        };

        let sample = sample * env * self.gain;

        // Stereo pan (constant-power: -1=left, 0=center, 1=right)
        let pan_angle = (self.pan + 1.0) * 0.125 * TAU; // maps -1..1 → 0..π/2
        let left = sample * pan_angle.cos();
        let right = sample * pan_angle.sin();

        (left + DENORMAL_BIAS, right + DENORMAL_BIAS)
    }

    /// FM synthesis path: dual oscillators + optional noise formants
    fn render_fm(&mut self, phase_inc_factor: f32, vibrato: f32, rng: &mut Rng) -> f32 {
        let freq1 = self.carrier_freq * vibrato;

        // FM oscillator 1 (fundamental)
        let mod_output = (self.mod_phase).sin() * self.mod_index;
        let osc1 = (self.carrier_phase + mod_output).sin();

        let mod_freq = freq1 * self.mod_ratio;
        self.carrier_phase += freq1 * phase_inc_factor;
        self.mod_phase += mod_freq * phase_inc_factor;

        // FM oscillator 2 (formant partial)
        let osc2 = if self.carrier2_gain > 0.001 {
            let freq2 = self.carrier2_freq * vibrato;
            let mod2_out = (self.mod2_phase).sin() * self.mod2_index;
            let s = (self.carrier2_phase + mod2_out).sin() * self.carrier2_gain;
            self.carrier2_phase += freq2 * phase_inc_factor;
            self.mod2_phase += freq2 * self.mod2_ratio * phase_inc_factor;
            if self.carrier2_phase > TAU { self.carrier2_phase -= TAU; }
            if self.mod2_phase > TAU { self.mod2_phase -= TAU; }
            s
        } else {
            0.0
        };

        // Noise through formant filters (breathiness)
        let formant_out = if self.noise_gain > 0.001 {
            let noise = rng.next_bipolar() * self.noise_gain;
            let f1 = self.formant1.process(noise);
            let f2 = self.formant2.process(noise);
            let f3 = self.formant3.process(noise);
            f1 + f2 * 0.7 + f3 * 0.4
        } else {
            0.0
        };

        // Phase wrapping
        if self.carrier_phase > TAU { self.carrier_phase -= TAU; }
        if self.mod_phase > TAU { self.mod_phase -= TAU; }

        // Pitch sweep
        self.carrier_freq += self.pitch_sweep;
        self.carrier_freq = self.carrier_freq.max(20.0);

        // Mod index decay
        self.mod_index += (self.mod_index_target - self.mod_index) * (1.0 - self.mod_index_decay);

        osc1 + osc2 + formant_out
    }

    /// Glottal synthesis path: pulse train → formant filter bank
    /// Rosenberg glottal pulses + aspiration noise → resonant formants
    fn render_glottal(&mut self, sample_rate: f32, vibrato: f32, rng: &mut Rng) -> f32 {
        // Apply vibrato to phase increment
        let base_inc = self.glottal.freq / sample_rate;
        self.glottal.phase_inc = base_inc * vibrato;

        // Get glottal excitation (pulse + noise)
        let excitation = self.glottal.process(rng);

        // Route through formant filter bank
        let f1 = self.formant1.process(excitation);
        let f2 = self.formant2.process(excitation);
        let f3 = self.formant3.process(excitation);

        // Formant weighting: F1 strongest, F2 mid, F3 presence
        // Also mix in some raw excitation for "grit"
        const F1_WEIGHT: f32 = 1.0;
        const F2_WEIGHT: f32 = 0.7;
        const F3_WEIGHT: f32 = 0.4;
        const RAW_MIX: f32 = 0.15; // some direct signal for attack transient
        (f1 * F1_WEIGHT + f2 * F2_WEIGHT + f3 * F3_WEIGHT) + excitation * RAW_MIX
    }
}

// === Sound preset factory ===

struct SoundParams {
    synth_mode: SynthMode,
    carrier_freq: f32,
    // FM-specific
    mod_ratio: f32,
    mod_index: f32,
    mod_index_target: f32,
    mod_index_decay: f32,
    // Second FM operator (0.0 gain = disabled)
    carrier2_freq: f32,
    carrier2_gain: f32,
    mod2_ratio: f32,
    mod2_index: f32,
    // Glottal-specific
    glottal_aspiration: f32,
    glottal_jitter: f32,
    glottal_pulse_shape: f32, // 1.0 = sine, 2.0 = sin², higher = buzzier
    // Common
    pitch_sweep: f32,
    attack_s: f32,
    decay_s: f32,
    sustain: f32,
    release_s: f32,
    gain: f32,
    // Formant filters (used by both modes)
    noise_gain: f32,  // FM mode: noise→formants; Glottal mode: unused (glottal_noise_mix instead)
    formant1_hz: f32,
    formant1_q: f32,
    formant2_hz: f32,
    formant2_q: f32,
    formant3_hz: f32,
    formant3_q: f32,
    // Vibrato
    vibrato_rate: f32,
    vibrato_depth: f32,
}

fn make_sound_params(
    sound_type: SoundType,
    body_size: f32,
    material: f32,
    weight: f32,
    aggression: f32,
) -> SoundParams {
    let base_freq = FREQ_SMALL + (FREQ_LARGE - FREQ_SMALL) * body_size;
    let base_mod_index = MOD_INDEX_CALM + (MOD_INDEX_AGGRESSIVE - MOD_INDEX_CALM) * aggression;

    // Defaults for FM impact sounds (no second operator, no formants, no vibrato, no glottal)
    let fm_impact = |mut p: SoundParams| -> SoundParams {
        p.synth_mode = SynthMode::FM;
        p.carrier2_freq = 0.0;
        p.carrier2_gain = 0.0;
        p.mod2_ratio = 1.0;
        p.mod2_index = 0.0;
        p.noise_gain = 0.0;
        p.formant1_hz = 800.0; p.formant1_q = 1.0;
        p.formant2_hz = 1200.0; p.formant2_q = 1.0;
        p.formant3_hz = 2500.0; p.formant3_q = 1.0;
        p.vibrato_rate = 0.0;
        p.vibrato_depth = 0.0;
        p.glottal_aspiration = 0.0;
        p.glottal_jitter = 0.0;
        p.glottal_pulse_shape = 2.0;
        p
    };

    match sound_type {
        SoundType::Footstep => fm_impact(SoundParams {
            synth_mode: SynthMode::FM,
            carrier_freq: base_freq * 0.8,
            mod_ratio: if material > 0.5 { 1.414 } else { 1.0 },
            mod_index: base_mod_index * 0.6 + weight * 4.0,
            mod_index_target: 0.0,
            mod_index_decay: 0.997,  // fast decay of harmonics
            pitch_sweep: 0.0,
            attack_s: ATTACK_MIN_S + weight * 0.004,
            decay_s: DECAY_MIN_S + weight * 0.08,
            sustain: 0.0,
            release_s: 0.02 + weight * 0.03,
            gain: 0.3 + weight * 0.3,
            // filled by fm_impact
            carrier2_freq: 0.0, carrier2_gain: 0.0, mod2_ratio: 0.0, mod2_index: 0.0,
            noise_gain: 0.0, formant1_hz: 0.0, formant1_q: 0.0,
            formant2_hz: 0.0, formant2_q: 0.0, formant3_hz: 0.0, formant3_q: 0.0,
            vibrato_rate: 0.0, vibrato_depth: 0.0,
            glottal_aspiration: 0.0, glottal_jitter: 0.0, glottal_pulse_shape: 2.0,
        }),

        SoundType::ClawStrike => fm_impact(SoundParams {
            synth_mode: SynthMode::FM,
            carrier_freq: base_freq * 1.5,
            mod_ratio: if material > 0.5 { 3.14 } else { 3.0 },
            mod_index: base_mod_index * 1.2,
            mod_index_target: base_mod_index * 0.1,
            mod_index_decay: 0.9993,
            pitch_sweep: 0.0,
            attack_s: ATTACK_MIN_S,
            decay_s: 0.05 + material * 0.1,  // metallic rings longer
            sustain: 0.0,
            release_s: 0.03 + material * 0.08,
            gain: 0.4 + aggression * 0.3,
            carrier2_freq: 0.0, carrier2_gain: 0.0, mod2_ratio: 0.0, mod2_index: 0.0,
            noise_gain: 0.0, formant1_hz: 0.0, formant1_q: 0.0,
            formant2_hz: 0.0, formant2_q: 0.0, formant3_hz: 0.0, formant3_q: 0.0,
            vibrato_rate: 0.0, vibrato_depth: 0.0,
            glottal_aspiration: 0.0, glottal_jitter: 0.0, glottal_pulse_shape: 2.0,
        }),

        SoundType::PartDetach => fm_impact(SoundParams {
            synth_mode: SynthMode::FM,
            carrier_freq: base_freq * 2.0,
            mod_ratio: 1.414,  // always inharmonic (breaking sound)
            mod_index: 8.0 + weight * 4.0,
            mod_index_target: 0.5,
            mod_index_decay: 0.9995,
            pitch_sweep: -base_freq * 0.002,  // descending pitch
            attack_s: ATTACK_MIN_S,
            decay_s: 0.15 + weight * 0.2,
            sustain: 0.0,
            release_s: 0.1 + weight * 0.15,
            gain: 0.5 + weight * 0.2,
            carrier2_freq: 0.0, carrier2_gain: 0.0, mod2_ratio: 0.0, mod2_index: 0.0,
            noise_gain: 0.0, formant1_hz: 0.0, formant1_q: 0.0,
            formant2_hz: 0.0, formant2_q: 0.0, formant3_hz: 0.0, formant3_q: 0.0,
            vibrato_rate: 0.0, vibrato_depth: 0.0,
            glottal_aspiration: 0.0, glottal_jitter: 0.0, glottal_pulse_shape: 2.0,
        }),

        // ---- GLOTTAL MODE: organic vocal sounds ----

        SoundType::IdleBreath => {
            // Breathing: low glottal pulse rate + heavy aspiration noise
            // Mostly noise-driven, pulses add subtle rhythmic character
            let breath_freq = 30.0 + body_size * 40.0; // 30-70 Hz (slow pulse rate)
            SoundParams {
                synth_mode: SynthMode::Glottal,
                carrier_freq: breath_freq,
                // FM params unused in glottal mode
                mod_ratio: 0.0, mod_index: 0.0, mod_index_target: 0.0, mod_index_decay: 1.0,
                carrier2_freq: 0.0, carrier2_gain: 0.0, mod2_ratio: 0.0, mod2_index: 0.0,
                // Glottal: mostly aspiration (breathy), gentle pulse
                glottal_aspiration: 0.3 + aggression * 0.15,  // heavy noise
                glottal_jitter: 0.05 + body_size * 0.05,      // slight pitch wobble
                glottal_pulse_shape: 1.0,                      // soft sine pulse
                pitch_sweep: 0.0,
                attack_s: 0.15 + body_size * 0.15,
                decay_s: 0.2 + body_size * 0.2,
                sustain: 0.3,
                release_s: 0.2 + body_size * 0.3,
                gain: 0.35 + aggression * 0.15,
                noise_gain: 0.0,
                // Broad formants for breath character (low Q = wide passband)
                formant1_hz: 250.0 + body_size * 150.0,
                formant1_q: 2.0,
                formant2_hz: 600.0 + body_size * 200.0,
                formant2_q: 1.5,
                formant3_hz: 2200.0 + aggression * 400.0,
                formant3_q: 1.0,
                vibrato_rate: 0.0,
                vibrato_depth: 0.0,
            }
        },

        SoundType::Vocalize => {
            // Creature vocalization: glottal pulse train → formant resonances
            // Source-filter model: Rosenberg pulses at f0 + aspiration → vowel-like formants
            let fund = base_freq * 0.5;
            // Formant frequencies shift with body size (larger = lower formants)
            let f1_base = 700.0 - body_size * 300.0;   // F1: 400-700 Hz
            let f2_base = 1400.0 - body_size * 400.0;  // F2: 1000-1400 Hz
            let f3_base = 2800.0 - body_size * 600.0;  // F3: 2200-2800 Hz

            SoundParams {
                synth_mode: SynthMode::Glottal,
                carrier_freq: fund,
                // FM params unused
                mod_ratio: 0.0, mod_index: 0.0, mod_index_target: 0.0, mod_index_decay: 1.0,
                carrier2_freq: 0.0, carrier2_gain: 0.0, mod2_ratio: 0.0, mod2_index: 0.0,
                // Glottal: moderate aspiration, slight jitter for organic feel
                glottal_aspiration: 0.05 + aggression * 0.1 + material * 0.05,
                glottal_jitter: 0.01 + body_size * 0.02,  // subtle pitch wobble
                glottal_pulse_shape: 2.0 + aggression * 1.5, // 2=clean, 3.5=buzzy/aggressive
                pitch_sweep: 0.0,
                attack_s: 0.04 + body_size * 0.06,
                decay_s: 0.15 + body_size * 0.1,
                sustain: 0.5 + aggression * 0.2,
                release_s: 0.15 + body_size * 0.2,
                gain: 0.4,
                noise_gain: 0.0,
                // Formant resonances (moderate Q — not too narrow)
                formant1_hz: f1_base,
                formant1_q: 4.0 + aggression * 2.0,
                formant2_hz: f2_base,
                formant2_q: 3.0 + aggression * 1.5,
                formant3_hz: f3_base,
                formant3_q: 2.5 + aggression * 1.0,
                // Vibrato: larger creatures = slower, aggressive = wider
                vibrato_rate: 4.0 + aggression * 3.0 - body_size * 1.5,
                vibrato_depth: 0.15 + aggression * 0.4,
            }
        },
    }
}

// === Engine (global state) ===

struct Engine {
    voices: Vec<Voice>,
    rng: Rng,
    sample_rate: f32,
    phase_inc_factor: f32,  // TAU / sample_rate (precomputed)
    alloc_stamp: u64,

    // Creature params (set by main thread)
    body_size: f32,
    material: f32,
    weight: f32,
    aggression: f32,

    // Telemetry (read by main thread via SAB)
    active_count: u32,
    peak_level: f32,
    total_renders: u32,
}

impl Engine {
    fn new(sample_rate: f32) -> Self {
        let mut voices = Vec::with_capacity(MAX_VOICES);
        for _ in 0..MAX_VOICES {
            voices.push(Voice::new());
        }
        Self {
            voices,
            rng: Rng::new(0xDEAD_BEEF),
            sample_rate,
            phase_inc_factor: TAU / sample_rate,
            alloc_stamp: 0,
            body_size: 0.5,
            material: 0.0,
            weight: 0.5,
            aggression: 0.3,
            active_count: 0,
            peak_level: 0.0,
            total_renders: 0,
        }
    }

    fn allocate_voice(&mut self) -> usize {
        // Find idle voice
        if let Some(i) = self.voices.iter().position(|v| !v.active) {
            return i;
        }
        // Steal oldest
        let oldest = self
            .voices
            .iter()
            .enumerate()
            .min_by_key(|(_, v)| v.age)
            .map(|(i, _)| i)
            .unwrap_or(0);
        oldest
    }

    fn trigger(&mut self, sound_type: SoundType) {
        let params = make_sound_params(
            sound_type,
            self.body_size,
            self.material,
            self.weight,
            self.aggression,
        );
        let slot = self.allocate_voice();
        self.alloc_stamp += 1;

        let voice = &mut self.voices[slot];
        voice.active = true;
        voice.synth_mode = params.synth_mode;
        voice.carrier_freq = params.carrier_freq;

        match params.synth_mode {
            SynthMode::FM => {
                // FM oscillator setup
                voice.carrier_phase = 0.0;
                voice.mod_phase = 0.0;
                voice.mod_ratio = params.mod_ratio;
                voice.mod_index = params.mod_index;
                voice.mod_index_target = params.mod_index_target;
                voice.mod_index_decay = params.mod_index_decay;
                // Operator 2
                voice.carrier2_phase = 0.0;
                voice.carrier2_freq = params.carrier2_freq;
                voice.mod2_phase = 0.0;
                voice.mod2_ratio = params.mod2_ratio;
                voice.mod2_index = params.mod2_index;
                voice.carrier2_gain = params.carrier2_gain;
                // Noise through formant filters
                voice.noise_gain = params.noise_gain;
            }
            SynthMode::Glottal => {
                // Initialize glottal pulse source
                voice.glottal = GlottalSource::new(
                    params.carrier_freq,
                    self.sample_rate,
                    params.glottal_aspiration,
                    params.glottal_jitter,
                    params.glottal_pulse_shape,
                );
                voice.noise_gain = 0.0;
            }
        }

        // Formant filters (used by both modes)
        voice.formant1 = BiquadBP::new(params.formant1_hz, params.formant1_q, self.sample_rate);
        voice.formant2 = BiquadBP::new(params.formant2_hz, params.formant2_q, self.sample_rate);
        voice.formant3 = BiquadBP::new(params.formant3_hz, params.formant3_q, self.sample_rate);

        // Vibrato
        voice.vibrato_phase = 0.0;
        voice.vibrato_rate = params.vibrato_rate;
        voice.vibrato_depth = params.vibrato_depth;
        // Common
        voice.pitch_sweep = params.pitch_sweep;
        voice.envelope = Envelope::new(
            self.sample_rate,
            params.attack_s,
            params.decay_s,
            params.sustain,
            params.release_s,
        );
        voice.gain = params.gain;
        // Randomize pan slightly for spatial width
        voice.pan = (self.alloc_stamp as f32 * 0.618).fract() * 2.0 - 1.0;
        voice.pan *= 0.6; // keep within ±0.6
        voice.age = self.alloc_stamp;
    }

    fn render_block(&mut self, output: &mut [f32]) {
        let block_frames = output.len() / CHANNELS;
        let phase_inc = self.phase_inc_factor;
        let sr = self.sample_rate;
        let rng = &mut self.rng;

        let mut peak: f32 = 0.0;
        let mut active: u32 = 0;

        // Zero output
        for s in output.iter_mut() {
            *s = 0.0;
        }

        // Render each active voice
        for voice in self.voices.iter_mut() {
            if !voice.active {
                continue;
            }
            active += 1;
            for frame in 0..block_frames {
                let (left, right) = voice.render_sample(phase_inc, sr, rng);
                let idx = frame * CHANNELS;
                output[idx] += left;
                output[idx + 1] += right;
            }
        }

        // Find peak
        for s in output.iter() {
            let abs = s.abs();
            if abs > peak {
                peak = abs;
            }
        }

        // Soft clip to prevent harsh distortion when many voices stack
        if peak > 1.0 {
            let scale = 1.0 / peak;
            for s in output.iter_mut() {
                *s *= scale;
            }
            peak = 1.0;
        }

        self.active_count = active;
        self.peak_level = peak;
        self.total_renders += 1;
    }
}

// === Global state (single-thread safety guaranteed by AudioWorklet) ===

struct WorkerCell(UnsafeCell<Option<Engine>>);
unsafe impl Sync for WorkerCell {}

static ENGINE: WorkerCell = WorkerCell(UnsafeCell::new(None));

fn with_engine<R>(f: impl FnOnce(&mut Engine) -> R) -> R {
    // SAFETY: AudioWorklet guarantees single-thread execution
    let cell = unsafe { &mut *ENGINE.0.get() };
    let engine = cell.as_mut().expect("engine not initialized");
    f(engine)
}

// === WASM exports ===

#[wasm_bindgen]
pub fn init_engine(sample_rate: f32) {
    let cell = unsafe { &mut *ENGINE.0.get() };
    *cell = Some(Engine::new(sample_rate));
}

#[wasm_bindgen]
pub fn render_block(output: &mut [f32]) {
    with_engine(|e| e.render_block(output));
}

#[wasm_bindgen]
pub fn trigger_sound(sound_type: u32) {
    let st = match sound_type {
        0 => SoundType::Footstep,
        1 => SoundType::ClawStrike,
        2 => SoundType::PartDetach,
        3 => SoundType::IdleBreath,
        4 => SoundType::Vocalize,
        _ => return,
    };
    with_engine(|e| e.trigger(st));
}

#[wasm_bindgen]
pub fn set_creature_params(body_size: f32, material: f32, weight: f32, aggression: f32) {
    with_engine(|e| {
        e.body_size = body_size.clamp(0.0, 1.0);
        e.material = material.clamp(0.0, 1.0);
        e.weight = weight.clamp(0.0, 1.0);
        e.aggression = aggression.clamp(0.0, 1.0);
    });
}

#[wasm_bindgen]
pub fn get_active_voice_count() -> u32 {
    with_engine(|e| e.active_count)
}

#[wasm_bindgen]
pub fn get_peak_level() -> f32 {
    with_engine(|e| e.peak_level)
}

#[wasm_bindgen]
pub fn get_total_renders() -> u32 {
    with_engine(|e| e.total_renders)
}

#[wasm_bindgen]
pub fn release_all_voices() {
    with_engine(|e| {
        for voice in e.voices.iter_mut() {
            if voice.active {
                voice.envelope.release();
            }
        }
    });
}
