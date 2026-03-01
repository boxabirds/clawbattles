/**
 * POC 10: Creature Vocoder
 *
 * Uses KittenTTS as a sound source, then modulates the output through
 * a channel vocoder + FM synthesis chain to create alien creature vocalizations.
 */

import { CreatureVocoder } from './vocoder';
import { LFOEngine } from './lfo';

// -- Network --
const TTS_SERVICE_URL = 'http://localhost:5100';

// -- Voices available from KittenTTS --
const TTS_VOICES = ['Bella', 'Jasper', 'Luna', 'Bruno', 'Rosie', 'Hugo', 'Kiki', 'Leo'];

// -- Preset phrases for quick testing --
const PRESET_PHRASES = [
  'I am the swarm',
  'Feed me your parts',
  'Click click click',
  'You cannot escape',
  'We are many, you are one',
  'Surrender your limbs',
];

// -- LFO constants --
const LFO_MAX_FREQ_HZ = 1;
const LFO_FREQ_STEP = 0.01;

// -- LFO-enabled parameter definitions --
// Each param: its slider ID, default value, and the min/max/step for the param range.
// bandCount is excluded — rebuilding the audio graph at LFO rates would be destructive.
interface ParamDef {
  key: string;       // LFO engine key
  sliderId: string;  // main slider element ID
  min: number;       // param range min
  max: number;       // param range max
  step: number;      // param slider step
  defaultVal: number;
  group: 'creature' | 'vocoder';
  format: (v: number) => string;
}

const FILTER_CUTOFF_MIN_HZ = 20;
const FILTER_CUTOFF_MAX_HZ = 20000;

function formatCutoff(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`;
}

/** Map 0..1 slider to 20..20000 Hz logarithmically */
function logCutoff(t: number): number {
  const logMin = Math.log2(FILTER_CUTOFF_MIN_HZ);
  const logMax = Math.log2(FILTER_CUTOFF_MAX_HZ);
  return Math.pow(2, logMin + t * (logMax - logMin));
}

const LFO_PARAMS: ParamDef[] = [
  { key: 'bodySize',        sliderId: 'slider-body-size',          min: 0,                  max: 1,                  step: 0.01, defaultVal: 0.5,    group: 'creature', format: v => v.toFixed(2) },
  { key: 'material',        sliderId: 'slider-material',           min: 0,                  max: 1,                  step: 0.01, defaultVal: 0.0,    group: 'creature', format: v => v.toFixed(2) },
  { key: 'aggression',      sliderId: 'slider-aggression',         min: 0,                  max: 1,                  step: 0.01, defaultVal: 0.3,    group: 'creature', format: v => v.toFixed(2) },
  { key: 'wetDry',          sliderId: 'slider-wetdry',             min: 0,                  max: 1,                  step: 0.01, defaultVal: 1.0,    group: 'vocoder',  format: v => `${Math.round(v * 100)}%` },
  { key: 'formantShift',    sliderId: 'slider-formant-shift',      min: 0.5,                max: 2.0,                step: 0.1,  defaultVal: 1.0,    group: 'vocoder',  format: v => `${v.toFixed(2)}x` },
  { key: 'speed',           sliderId: 'slider-speed',              min: 0.25,               max: 2.0,                step: 0.05, defaultVal: 1.0,    group: 'vocoder',  format: v => `${v.toFixed(2)}x` },
  { key: 'filterCutoff',    sliderId: 'slider-filter-cutoff',      min: 0,                  max: 1,                  step: 0.001, defaultVal: 1,   group: 'vocoder',  format: v => formatCutoff(logCutoff(v)) },
  { key: 'filterResonance', sliderId: 'slider-filter-resonance',   min: 0,                  max: 30,                 step: 0.1,  defaultVal: 0,      group: 'vocoder',  format: v => v.toFixed(1) },
  { key: 'filterEnvFollow', sliderId: 'slider-filter-env-follow',  min: 0,                  max: 1,                  step: 0.01, defaultVal: 0,      group: 'vocoder',  format: v => v.toFixed(2) },
];

// -- State --
let audioContext: AudioContext | null = null;
let vocoder: CreatureVocoder | null = null;
let currentAudioBuffer: AudioBuffer | null = null;
let isPlaying = false;
let lfoEngine: LFOEngine | null = null;

// -- DOM refs --
const $ = (id: string) => document.getElementById(id)!;

// -- TTS fetch --
async function fetchTTS(text: string, voice: string): Promise<ArrayBuffer> {
  const response = await fetch(`${TTS_SERVICE_URL}/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`TTS request failed (${response.status}): ${detail}`);
  }

  return response.arrayBuffer();
}

// -- Check TTS service health --
async function checkTTSHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${TTS_SERVICE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// -- Audio init --
async function initAudio(): Promise<void> {
  audioContext = new AudioContext({ latencyHint: 'interactive' });
  vocoder = new CreatureVocoder(audioContext);

  // Set initial creature params from slider values
  vocoder.setCreatureParams({
    bodySize: parseFloat(($('slider-body-size') as HTMLInputElement).value),
    material: parseFloat(($('slider-material') as HTMLInputElement).value),
    aggression: parseFloat(($('slider-aggression') as HTMLInputElement).value),
  });

  // Start LFO engine
  lfoEngine!.start();
}

// -- LFO callback: pushes computed values to the vocoder each frame --
function onLFOTick(values: Record<string, number>): void {
  if (!vocoder) return;

  vocoder.setCreatureParams({
    bodySize: values.bodySize,
    material: values.material,
    aggression: values.aggression,
  });

  vocoder.setVocoderParams({
    bandCount: parseInt(($('slider-bands') as HTMLInputElement).value),
    wetDry: values.wetDry,
    formantShift: values.formantShift,
    speed: values.speed,
    filterCutoff: logCutoff(values.filterCutoff),
    filterResonance: values.filterResonance,
    filterEnvFollow: values.filterEnvFollow,
  });

  // Update main slider value displays to show LFO-driven values
  for (const param of LFO_PARAMS) {
    const valEl = document.getElementById(`${param.sliderId}-val`);
    if (valEl) valEl.textContent = param.format(values[param.key]);
  }
}

// -- Generate and play --
async function generateAndPlay(): Promise<void> {
  const statusEl = $('status');
  const textInput = $('text-input') as HTMLTextAreaElement;
  const voiceSelect = $('voice-select') as HTMLSelectElement;
  const text = textInput.value.trim();
  const voice = voiceSelect.value;

  if (!text) {
    statusEl.textContent = 'Enter some text first';
    statusEl.style.color = '#fbbf24';
    return;
  }

  // Init audio on first user gesture
  if (!audioContext) {
    await initAudio();
  }

  if (audioContext!.state === 'suspended') {
    await audioContext!.resume();
  }

  try {
    statusEl.textContent = 'Synthesizing speech...';
    statusEl.style.color = '#fbbf24';
    setGenerateEnabled(false);

    const wavData = await fetchTTS(text, voice);

    statusEl.textContent = 'Decoding audio...';
    currentAudioBuffer = await audioContext!.decodeAudioData(wavData);

    statusEl.textContent = `Decoded: ${currentAudioBuffer.duration.toFixed(2)}s @ ${currentAudioBuffer.sampleRate}Hz`;
    statusEl.style.color = '#4ade80';

    enablePlaybackControls(true);
    setGenerateEnabled(true);

    // Auto-play through vocoder
    playVocoded();
  } catch (err) {
    statusEl.textContent = `Error: ${err}`;
    statusEl.style.color = '#f87171';
    setGenerateEnabled(true);
    console.error('Generate failed:', err);
  }
}

// -- Play through vocoder --
function playVocoded(loop = false): void {
  if (!audioContext || !vocoder || !currentAudioBuffer || isPlaying) return;

  isPlaying = true;
  setPlaybackButtonsDisabled(true);
  const label = loop ? 'Playing looped (vocoded)...' : 'Playing (vocoded)...';
  $('status').textContent = label;
  $('status').style.color = '#a78bfa';

  vocoder.play(currentAudioBuffer, loop, () => {
    isPlaying = false;
    setPlaybackButtonsDisabled(false);
    $('status').textContent = 'Ready';
    $('status').style.color = '#4ade80';
  });
}

// -- Play dry (unprocessed TTS) --
function playDry(): void {
  if (!audioContext || !currentAudioBuffer || isPlaying) return;

  isPlaying = true;
  setPlaybackButtonsDisabled(true);
  $('status').textContent = 'Playing (dry TTS)...';
  $('status').style.color = '#fbbf24';

  const source = audioContext.createBufferSource();
  source.buffer = currentAudioBuffer;
  source.connect(audioContext.destination);
  source.onended = () => {
    isPlaying = false;
    setPlaybackButtonsDisabled(false);
    $('status').textContent = 'Ready';
    $('status').style.color = '#4ade80';
  };
  source.start();
}

// -- Stop playback --
function stopPlayback(): void {
  if (!vocoder) return;
  vocoder.stop();
  isPlaying = false;
  setPlaybackButtonsDisabled(false);
  $('status').textContent = 'Stopped';
  $('status').style.color = '#4ade80';
}

function setPlaybackButtonsDisabled(disabled: boolean): void {
  const ids = ['btn-play-vocoded', 'btn-play-looped', 'btn-play-dry'];
  for (const id of ids) {
    if (disabled) {
      $(id).setAttribute('disabled', 'true');
    } else {
      $(id).removeAttribute('disabled');
    }
  }
}

// -- UI helpers --
function setGenerateEnabled(enabled: boolean): void {
  const btn = $('btn-generate') as HTMLButtonElement;
  btn.disabled = !enabled;
  btn.textContent = enabled ? 'Generate' : 'Generating...';
}

function enablePlaybackControls(enabled: boolean): void {
  ($('btn-play-vocoded') as HTMLButtonElement).disabled = !enabled;
  ($('btn-play-looped') as HTMLButtonElement).disabled = !enabled;
  ($('btn-play-dry') as HTMLButtonElement).disabled = !enabled;
  ($('btn-stop') as HTMLButtonElement).disabled = !enabled;
}

// -- Generate LFO row DOM for a parameter --
function createLFORow(param: ParamDef): HTMLElement {
  const row = document.createElement('div');
  row.className = 'lfo-row';
  row.id = `lfo-${param.key}`;

  const tag = document.createElement('span');
  tag.className = 'lfo-tag';
  tag.textContent = 'LFO';
  row.appendChild(tag);

  const fields: Array<{ label: string; attr: 'min' | 'max' | 'freq'; rMin: number; rMax: number; rStep: number; defaultVal: number }> = [
    { label: 'Lo', attr: 'min',  rMin: param.min, rMax: param.max, rStep: param.step, defaultVal: param.min },
    { label: 'Hi', attr: 'max',  rMin: param.min, rMax: param.max, rStep: param.step, defaultVal: param.max },
    { label: 'Hz', attr: 'freq', rMin: 0,         rMax: LFO_MAX_FREQ_HZ, rStep: LFO_FREQ_STEP, defaultVal: 0 },
  ];

  for (const f of fields) {
    const fieldLabel = document.createElement('span');
    fieldLabel.className = 'lfo-field';
    fieldLabel.textContent = f.label;
    row.appendChild(fieldLabel);

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'lfo-slider';
    input.min = String(f.rMin);
    input.max = String(f.rMax);
    input.step = String(f.rStep);
    input.value = String(f.defaultVal);
    input.dataset.param = param.key;
    input.dataset.lfo = f.attr;
    row.appendChild(input);
  }

  const freqVal = document.createElement('span');
  freqVal.className = 'lfo-freq-val';
  freqVal.id = `lfo-${param.key}-freq-val`;
  freqVal.textContent = '0.0';
  row.appendChild(freqVal);

  return row;
}

// -- Wire LFO slider events --
function wireLFOSliders(): void {
  const sliders = document.querySelectorAll<HTMLInputElement>('.lfo-slider');
  for (const slider of sliders) {
    slider.addEventListener('input', () => {
      const paramKey = slider.dataset.param!;
      const lfoAttr = slider.dataset.lfo! as 'min' | 'max' | 'freq';
      const val = parseFloat(slider.value);

      lfoEngine!.setLFO(paramKey, { [lfoAttr]: val });

      // Update freq display
      if (lfoAttr === 'freq') {
        const freqEl = document.getElementById(`lfo-${paramKey}-freq-val`);
        if (freqEl) freqEl.textContent = val.toFixed(1);
      }

      // Toggle active class based on freq
      const row = document.getElementById(`lfo-${paramKey}`);
      const freqSlider = row?.querySelector<HTMLInputElement>('[data-lfo="freq"]');
      if (row && freqSlider) {
        row.classList.toggle('active', parseFloat(freqSlider.value) > 0);
      }
    });
  }
}

// -- UI Setup --
function setupUI(): void {
  // Voice selector
  const voiceSelect = $('voice-select') as HTMLSelectElement;
  for (const voice of TTS_VOICES) {
    const opt = document.createElement('option');
    opt.value = voice;
    opt.textContent = voice;
    voiceSelect.appendChild(opt);
  }

  // Preset phrase buttons
  const presetGrid = $('preset-grid');
  for (const phrase of PRESET_PHRASES) {
    const btn = document.createElement('button');
    btn.className = 'preset-btn';
    btn.textContent = phrase;
    btn.addEventListener('click', () => {
      ($('text-input') as HTMLTextAreaElement).value = phrase;
    });
    presetGrid.appendChild(btn);
  }

  // Generate button
  $('btn-generate').addEventListener('click', generateAndPlay);

  // Playback buttons
  $('btn-play-vocoded').addEventListener('click', () => playVocoded(false));
  $('btn-play-looped').addEventListener('click', () => playVocoded(true));
  $('btn-play-dry').addEventListener('click', playDry);
  $('btn-stop').addEventListener('click', stopPlayback);

  // -- Initialize LFO engine --
  lfoEngine = new LFOEngine(onLFOTick);

  // Register all LFO-enabled params and inject LFO rows into DOM
  for (const param of LFO_PARAMS) {
    lfoEngine.register(param.key, param.defaultVal, { min: param.min, max: param.max, freq: 0 });

    // Find the slider-hint div after this param's slider and inject LFO row after it
    const sliderEl = $(param.sliderId);
    const sliderRow = sliderEl.closest('.slider-row');
    // The hint div is the next sibling of the slider-row
    const hintDiv = sliderRow?.nextElementSibling;
    if (hintDiv && hintDiv.classList.contains('slider-hint')) {
      hintDiv.after(createLFORow(param));
    }
  }

  // Wire main slider events — update LFO static values
  for (const param of LFO_PARAMS) {
    const slider = $(param.sliderId) as HTMLInputElement;
    slider.addEventListener('input', () => {
      const val = parseFloat(slider.value);
      lfoEngine!.setStaticValue(param.key, val);
      // Update display (will be overwritten by LFO tick if active)
      const valEl = $(`${param.sliderId}-val`);
      valEl.textContent = param.format(val);
    });
  }

  // Band count slider (no LFO — just direct update)
  const bandSlider = $('slider-bands') as HTMLInputElement;
  const bandVal = $('slider-bands-val');
  bandSlider.addEventListener('input', () => {
    bandVal.textContent = bandSlider.value;
    // Band count is pushed to vocoder via the LFO tick callback (reads slider directly)
  });

  // Wire LFO slider events
  wireLFOSliders();

  // Keyboard shortcut: Enter to generate
  ($('text-input') as HTMLTextAreaElement).addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generateAndPlay();
    }
  });

  // Check TTS service health on load
  checkHealth();
}

async function checkHealth(): Promise<void> {
  const statusEl = $('status');
  const healthy = await checkTTSHealth();

  if (healthy) {
    statusEl.textContent = 'TTS service connected. Enter text and click Generate.';
    statusEl.style.color = '#4ade80';
    ($('btn-generate') as HTMLButtonElement).disabled = false;
  } else {
    statusEl.textContent = 'TTS service not available. Run ./start-docker.sh first.';
    statusEl.style.color = '#f87171';
    ($('btn-generate') as HTMLButtonElement).disabled = true;
    const HEALTH_RETRY_MS = 3000;
    setTimeout(checkHealth, HEALTH_RETRY_MS);
  }
}

// -- Boot --
setupUI();
enablePlaybackControls(false);
