# Cylon Vocoder — Design Document

## Historical Context

The original 1978 Battlestar Galactica Cylon voice was created by sound designer Joe Grandberg using a specific chain of rare analog hardware. The distinctive "robot voice with shimmer" is not a generic vocoder effect — it requires particular gear characteristics that contribute equally to the final sound.

## Original Hardware Chain

### 1. Carrier Signal — EMS Vocoder Internal Oscillator

- **Waveform**: Sawtooth (all harmonics, harmonically rich)
- The EMS vocoder had a built-in oscillator with pitch adjustment
- A single steady pitched note — not a complex chord or modulated signal
- Sawtooth was chosen over pulse/square because it contains all harmonics (not just odd), giving the vocoder more spectral material to shape

### 2. Modulator Signal — Voice via Nagra Tape

- **Recording**: Nagra III or IV quarter-inch mono tape recorder
- **Nagra tape character**: Adds a 100Hz frequency bump and softens high-end frequencies. This is critical — the tape pre-processing shapes the voice before it enters the vocoder
- **Pre-processing**: Voice EQ'd at a mixing console + broadcast limiters before entering the vocoder
- The compression/limiting before the vocoder ensures consistent envelope levels across all 16 bands, preventing the effect from "dropping out" on quieter syllables

### 3. Vocoder — EMS 1000 (identical to 2000/3000)

- **Band count**: 16 bands (specifically)
  - Lower counts (8) are too "gritty"
  - Software with 100+ bands is too "glassy" and clear
  - 16 is the sweet spot for robotic texture with intelligibility
- **Filter slope**: 30dB/octave bandpass filters (steep)
- **Topology**: Analysis BPFs → envelope followers → modulate carrier through synthesis BPFs
- **Band range**: ~80 Hz to ~8 kHz (speech intelligibility range)

### 4. Post-Processing — The Countryman 968A Phase Shifter

This is the most distinctive and least understood part of the chain.

- **Input overload (CRITICAL)**: Line-level output of the vocoder fed into the phaser's **microphone input**. This impedance/level mismatch causes the input stage to distort, creating the "raspy and grainy" character central to the Cylon sound. This is NOT a standard clean phase effect.
- **Envelope follower (NOT LFO)**: The Countryman 968A uses an internal envelope follower instead of a standard LFO. The phase shift depth responds dynamically to the volume of the input signal — louder passages get more phase shifting, quieter passages get less. This creates the sense of the voice "pulsing" and "shimmering" in response to speech dynamics rather than at a fixed periodic rate.
- **6 allpass stages**: Standard analog phaser topology, but driven by envelope rather than oscillator

### 5. Compression Sandwich

- Multiple compressors and broadcast limiters at every stage
- Pre-vocoder: broadcast limiter (keeps modulator levels consistent)
- Post-vocoder: compressor (tames dynamics before distortion)
- Final: limiter (prevents overloads, adds density)
- The overall effect is a very "hot", dense, present sound with minimal dynamic range

## Web Audio Implementation

### Signal Flow

```
Speech
  │
  ├──→ Nagra EQ (low-shelf +4dB@100Hz, high-shelf -3dB@6kHz)
  │       │
  │       └──→ Broadcast Limiter (DynamicsCompressor, -18dB threshold, 8:1)
  │               │
  │               └──→ 16x Analysis BPFs → Rectifier → Envelope LPF
  │                       │
  │                       └──→ [envelope modulates carrier gain per band]
  │
  ├──→ Dry path (wet/dry mix)
  │
  └──→ Sibilance HP (4kHz) → 0.35 mix to wet
         (modern intelligibility aid — not in original chain)

Carrier: Sawtooth osc (bodySize→pitch) + Noise (aggression→blend)
  │
  └──→ 16x Synthesis BPFs → Carrier Gain (envelope-driven) → Band Output → Wet

Wet + Dry
  │
  └──→ Post-Compressor (broadcast limiter)
         │
         └──→ Overload Distortion (asymmetric tanh waveshaper, +18dB drive)
                │
                ├──→ Envelope Follower (rectifier → LPF@15Hz → depth gain)
                │       │
                │       └──→ modulates 6x Allpass filter frequencies
                │
                └──→ 6x Allpass Phaser Stages (env-follower driven)
                       │
                       └──→ Final Limiter (-3dB threshold, 20:1)
                              │
                              └──→ HP Filter → LP Filter → Output
```

### Creature Parameter Mapping

| Parameter   | Maps To              | Range                | Effect |
|-------------|----------------------|----------------------|--------|
| bodySize    | Carrier pitch        | 600Hz (0) → 60Hz (1)| Higher = deeper robot voice fundamental |
| material    | Phaser env depth     | 0 → 1200 Hz         | 0 = no phaser, 1 = deep dynamic shimmer |
| aggression  | Noise/sawtooth blend | 0 = sawtooth, 1 = noise | More noise = more unvoiced/breathy |

### Key Implementation Details

**Carrier: Sawtooth, not square**
The original EMS oscillator used sawtooth. Sawtooth contains all integer harmonics (fundamental, 2nd, 3rd, 4th...) while square only has odd harmonics (1st, 3rd, 5th...). The even harmonics give the vocoder more spectral content to work with across all 16 bands, resulting in a fuller, richer robotic voice.

**Phaser: Envelope follower, not LFO**
The Countryman 968A phaser modulates its allpass filter frequencies based on the amplitude of the input signal (envelope following), not at a fixed rate (LFO). In Web Audio, this is implemented by:
1. Routing the post-distortion signal through a rectifier + LPF (envelope extraction)
2. Scaling the envelope by a depth gain (controlled by `material`)
3. Connecting the scaled envelope to the `frequency` AudioParam of each allpass filter
This creates dynamic, speech-responsive shimmer rather than periodic wobble.

**Distortion: Asymmetric tanh waveshaper**
Simulates the impedance mismatch of feeding a line-level signal into a microphone input. The waveshaper applies +18dB of gain followed by asymmetric tanh saturation (positive half clips harder). The `oversample: '2x'` setting reduces aliasing artifacts from the nonlinear distortion.

**Nagra tape EQ**
Two shelf filters simulate the Nagra tape recorder's frequency response:
- Low shelf: +4dB at 100Hz (the characteristic Nagra "bump")
- High shelf: -3dB at 6kHz (softened high end from tape)

**Compression sandwich**
Three DynamicsCompressorNode instances:
1. Input limiter (pre-vocoder): -18dB threshold, 8:1 ratio, fast attack
2. Post compressor (post-vocoder): same settings, tames vocoder output dynamics
3. Final limiter: -3dB threshold, 20:1 ratio (brick-wall), prevents output clipping

### Deviations from Original

1. **Sibilance passthrough** — Not in the original chain. We add a 4kHz highpass tap from the raw speech mixed at 35% into the wet signal. This preserves consonant intelligibility (s, t, sh) that the 16-band vocoder would otherwise destroy. Pragmatic modern addition.

2. **Digital noise carrier** — The original used analog noise generators. We use a looping 2-second white noise buffer. Perceptually equivalent.

3. **No analog drift** — The original hardware had component tolerances, temperature drift, and tape speed variation that contributed subtle pitch/timing instabilities. Our implementation is deterministic. Could add subtle random modulation to carrier pitch for authenticity.

### Notable Absent Components

- **Actual Nagra tape saturation** — Our shelf EQ approximates the frequency response but not the harmonic distortion, compression, and tape hiss of actual tape recording. A more accurate simulation would require a tape saturation waveshaper with frequency-dependent saturation.
- **Console preamp coloring** — The original signal passed through mixing console preamps which added subtle harmonic content. Not modeled.
- **Analog filter resonance behavior** — Real analog bandpass filters have resonance that varies with frequency and component aging. Our BiquadFilter nodes are mathematically ideal.
