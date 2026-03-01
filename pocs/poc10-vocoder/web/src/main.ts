/**
 * POC 10: Creature Vocoder
 *
 * Uses KittenTTS as a sound source, then modulates the output through
 * a channel vocoder + FM synthesis chain to create alien creature vocalizations.
 */

import { CreatureVocoder, type CarrierType } from './vocoder';
import { ShepardVocoder } from './shepard-vocoder';
import { CylonVocoder } from './cylon-vocoder';
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

/** Map 0..1 slider to 500..12000 Hz logarithmically (sibilance crossover) */
const SIBILANCE_FREQ_MIN_HZ = 500;
const SIBILANCE_FREQ_MAX_HZ = 12000;

function logSibilanceFreq(t: number): number {
  const logMin = Math.log2(SIBILANCE_FREQ_MIN_HZ);
  const logMax = Math.log2(SIBILANCE_FREQ_MAX_HZ);
  return Math.pow(2, logMin + t * (logMax - logMin));
}

const LFO_PARAMS: ParamDef[] = [
  { key: 'bodySize',        sliderId: 'slider-body-size',          min: 0,                  max: 1,                  step: 0.01, defaultVal: 0.5,    group: 'creature', format: v => v.toFixed(2) },
  { key: 'material',        sliderId: 'slider-material',           min: 0,                  max: 1,                  step: 0.01, defaultVal: 0.0,    group: 'creature', format: v => v.toFixed(2) },
  { key: 'aggression',      sliderId: 'slider-aggression',         min: 0,                  max: 1,                  step: 0.01, defaultVal: 0.3,    group: 'creature', format: v => v.toFixed(2) },
  { key: 'wetDry',          sliderId: 'slider-wetdry',             min: 0,                  max: 1,                  step: 0.01, defaultVal: 1.0,    group: 'vocoder',  format: v => `${Math.round(v * 100)}%` },
  { key: 'formantShift',    sliderId: 'slider-formant-shift',      min: 0.5,                max: 2.0,                step: 0.1,  defaultVal: 1.0,    group: 'vocoder',  format: v => `${v.toFixed(2)}x` },
  { key: 'speed',           sliderId: 'slider-speed',              min: 0.25,               max: 2.0,                step: 0.05, defaultVal: 1.0,    group: 'vocoder',  format: v => `${v.toFixed(2)}x` },
  { key: 'filterHPCutoff',    sliderId: 'slider-filter-hp-cutoff',     min: 0,   max: 1,   step: 0.001, defaultVal: 0,   group: 'vocoder',  format: v => formatCutoff(logCutoff(v)) },
  { key: 'filterHPResonance', sliderId: 'slider-filter-hp-resonance', min: 0,   max: 30,  step: 0.1,   defaultVal: 0,   group: 'vocoder',  format: v => v.toFixed(1) },
  { key: 'filterCutoff',       sliderId: 'slider-filter-cutoff',      min: 0,   max: 1,   step: 0.001, defaultVal: 1,   group: 'vocoder',  format: v => formatCutoff(logCutoff(v)) },
  { key: 'filterResonance',    sliderId: 'slider-filter-resonance',   min: 0,   max: 30,  step: 0.1,   defaultVal: 0,   group: 'vocoder',  format: v => v.toFixed(1) },
  { key: 'filterEnvFollow',    sliderId: 'slider-filter-env-follow',  min: 0,   max: 1,   step: 0.01,  defaultVal: 0,   group: 'vocoder',  format: v => v.toFixed(2) },
];

// -- Vocoder mode --
type VocoderMode = 'creature' | 'shepard' | 'cylon';

function activeVocoder(): CreatureVocoder | ShepardVocoder | CylonVocoder | null {
  if (activeMode === 'creature') return creatureVocoder;
  if (activeMode === 'shepard') return shepardVocoder;
  return cylonVocoder;
}

// -- State --
let audioContext: AudioContext | null = null;
let creatureVocoder: CreatureVocoder | null = null;
let shepardVocoder: ShepardVocoder | null = null;
let cylonVocoder: CylonVocoder | null = null;
let activeMode: VocoderMode = 'creature';
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
  creatureVocoder = new CreatureVocoder(audioContext);
  shepardVocoder = new ShepardVocoder(audioContext);
  cylonVocoder = new CylonVocoder(audioContext);

  // Start LFO engine (will push initial params to active vocoder on first tick)
  lfoEngine!.start();
}

// -- LFO callback: pushes computed values to the vocoder each frame --
function onLFOTick(values: Record<string, number>): void {
  const v = activeVocoder();
  if (!v) return;

  v.setCreatureParams({
    bodySize: values.bodySize,
    material: values.material,
    aggression: values.aggression,
  });

  v.setVocoderParams({
    bandCount: parseInt(($('slider-bands') as HTMLInputElement).value),
    carrierType: getActiveCarrierType(),
    wetDry: values.wetDry,
    formantShift: values.formantShift,
    speed: values.speed,
    filterHPCutoff: logCutoff(values.filterHPCutoff),
    filterHPResonance: values.filterHPResonance,
    filterCutoff: logCutoff(values.filterCutoff),
    filterResonance: values.filterResonance,
    filterEnvFollow: values.filterEnvFollow,
  });

  // Push sibilance params to CylonVocoder when in cylon mode
  if (activeMode === 'cylon' && v instanceof CylonVocoder) {
    const freqT = parseFloat(($('slider-sibilance-freq') as HTMLInputElement).value);
    const mix = parseFloat(($('slider-sibilance-mix') as HTMLInputElement).value);
    v.setSibilanceParams(logSibilanceFreq(freqT), mix);
  }

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
  const v = activeVocoder();
  if (!audioContext || !v || !currentAudioBuffer || isPlaying) return;

  isPlaying = true;
  setPlaybackButtonsDisabled(true);
  const MODE_LABELS: Record<VocoderMode, string> = {
    creature: 'vocoded',
    shepard: 'Shepard',
    cylon: 'Cylon',
  };
  const modeLabel = MODE_LABELS[activeMode];
  const label = loop ? `Playing looped (${modeLabel})...` : `Playing (${modeLabel})...`;
  $('status').textContent = label;
  $('status').style.color = '#a78bfa';

  v.play(currentAudioBuffer, loop, () => {
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
  const v = activeVocoder();
  if (!v) return;
  v.stop();
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
  ($('btn-save-audio') as HTMLButtonElement).disabled = !enabled;
}

// -- Carrier type --

function getActiveCarrierType(): CarrierType {
  const active = document.querySelector('.carrier-btn.active');
  return (active?.getAttribute('data-carrier') as CarrierType) ?? 'fm';
}

function setCarrierType(type: CarrierType): void {
  document.querySelectorAll('.carrier-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-carrier') === type);
  });
  updateModeUI();
}

// -- Vocoder mode switch --

// -- Per-mode slider labels --
const MODE_LABELS: Record<VocoderMode, Record<string, string>> = {
  creature: {
    'label-body-size': 'Body Size',
    'label-material': 'Material',
    'label-aggression': 'Aggression',
  },
  shepard: {
    'label-body-size': 'Center Freq',
    'label-material': 'Resonance',
    'label-aggression': 'Rise Rate',
  },
  cylon: {
    'label-body-size': 'Carrier Pitch',
    'label-material': 'Phaser Depth',
    'label-aggression': 'Noise Blend',
  },
};

/** Hint text for creature params. Depends on both vocoder mode and carrier type. */
const SHEPARD_HINTS: Record<string, [string, string]> = {
  'hint-body-size':  ['High center (4kHz)', 'Low center (200Hz)'],
  'hint-material':   ['Wide / soft resonance', 'Tight / sharp resonance'],
  'hint-aggression': ['Slow rise (0.1 oct/s)', 'Fast rise (2 oct/s)'],
};

const CYLON_HINTS: Record<string, [string, string]> = {
  'hint-body-size':  ['High pitch (600 Hz)', 'Low pitch (60 Hz)'],
  'hint-material':   ['No phaser', 'Deep dynamic shimmer'],
  'hint-aggression': ['Pure sawtooth', 'Pure noise (whisper)'],
};

const CREATURE_HINTS: Record<CarrierType, Record<string, [string, string]>> = {
  fm: {
    'hint-body-size':  ['Small (high pitch)', 'Large (low pitch)'],
    'hint-material':   ['Organic / Chitin', 'Metallic'],
    'hint-aggression': ['Calm (smooth)', 'Aggressive (harsh)'],
  },
  saw: {
    'hint-body-size':  ['Small (high pitch)', 'Large (low pitch)'],
    'hint-material':   ['(no effect)', '(no effect)'],
    'hint-aggression': ['(no effect)', '(no effect)'],
  },
  square: {
    'hint-body-size':  ['Small (high pitch)', 'Large (low pitch)'],
    'hint-material':   ['(no effect)', '(no effect)'],
    'hint-aggression': ['(no effect)', '(no effect)'],
  },
  noise: {
    'hint-body-size':  ['(no effect)', '(no effect)'],
    'hint-material':   ['(no effect)', '(no effect)'],
    'hint-aggression': ['(no effect)', '(no effect)'],
  },
};

function updateModeUI(): void {
  // Update slider labels per mode
  const labels = MODE_LABELS[activeMode];
  for (const [id, text] of Object.entries(labels)) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  // Update hint text
  let hints: Record<string, [string, string]>;
  if (activeMode === 'shepard') hints = SHEPARD_HINTS;
  else if (activeMode === 'cylon') hints = CYLON_HINTS;
  else hints = CREATURE_HINTS[getActiveCarrierType()];

  for (const [id, [lo, hi]] of Object.entries(hints)) {
    const el = $(id);
    if (el) {
      const spans = el.querySelectorAll('span');
      if (spans.length >= 2) {
        spans[0].textContent = lo;
        spans[1].textContent = hi;
      }
    }
  }

  // Show/hide carrier type selector — only relevant in creature mode
  const carrierPanel = document.getElementById('carrier-type-panel');
  if (carrierPanel) {
    carrierPanel.style.display = activeMode === 'creature' ? '' : 'none';
  }

  // Show/hide sibilance panel — only relevant in cylon mode
  const sibilancePanel = document.getElementById('cylon-sibilance-panel');
  if (sibilancePanel) {
    sibilancePanel.style.display = activeMode === 'cylon' ? '' : 'none';
  }
}

function setVocoderMode(mode: VocoderMode): void {
  if (mode === activeMode) return;

  // Stop playback on old vocoder
  activeVocoder()?.stop();
  isPlaying = false;
  setPlaybackButtonsDisabled(false);

  activeMode = mode;

  $('btn-mode-creature').classList.toggle('active', mode === 'creature');
  $('btn-mode-shepard').classList.toggle('active', mode === 'shepard');
  $('btn-mode-cylon').classList.toggle('active', mode === 'cylon');

  updateModeUI();
}

// -- Save / Load --

const CONFIG_VERSION = 1;

interface SavedConfig {
  version: number;
  vocoderMode: VocoderMode;
  carrierType: CarrierType;
  text: string;
  voice: string;
  bandCount: number;
  sibilanceFreq?: number;  // 0..1 slider position
  sibilanceMix?: number;
  params: Record<string, number>;
  lfos: Record<string, { min: number; max: number; freq: number }>;
}

function gatherConfig(): SavedConfig {
  const params: Record<string, number> = {};
  for (const p of LFO_PARAMS) {
    params[p.key] = parseFloat(($(p.sliderId) as HTMLInputElement).value);
  }

  const lfos: Record<string, { min: number; max: number; freq: number }> = {};
  for (const p of LFO_PARAMS) {
    const row = $(`lfo-${p.key}`);
    lfos[p.key] = {
      min: parseFloat(row.querySelector<HTMLInputElement>('[data-lfo="min"]')!.value),
      max: parseFloat(row.querySelector<HTMLInputElement>('[data-lfo="max"]')!.value),
      freq: parseFloat(row.querySelector<HTMLInputElement>('[data-lfo="freq"]')!.value),
    };
  }

  return {
    version: CONFIG_VERSION,
    vocoderMode: activeMode,
    carrierType: getActiveCarrierType(),
    text: ($('text-input') as HTMLTextAreaElement).value,
    voice: ($('voice-select') as HTMLSelectElement).value,
    bandCount: parseInt(($('slider-bands') as HTMLInputElement).value),
    sibilanceFreq: parseFloat(($('slider-sibilance-freq') as HTMLInputElement).value),
    sibilanceMix: parseFloat(($('slider-sibilance-mix') as HTMLInputElement).value),
    params,
    lfos,
  };
}

function applyConfig(config: SavedConfig): void {
  setVocoderMode(config.vocoderMode ?? 'creature');
  setCarrierType(config.carrierType ?? 'fm');

  ($('text-input') as HTMLTextAreaElement).value = config.text;
  ($('voice-select') as HTMLSelectElement).value = config.voice;

  const bandSlider = $('slider-bands') as HTMLInputElement;
  bandSlider.value = String(config.bandCount);
  $('slider-bands-val').textContent = String(config.bandCount);

  if (config.sibilanceFreq !== undefined) {
    const sf = $('slider-sibilance-freq') as HTMLInputElement;
    sf.value = String(config.sibilanceFreq);
    sf.dispatchEvent(new Event('input'));
  }
  if (config.sibilanceMix !== undefined) {
    const sm = $('slider-sibilance-mix') as HTMLInputElement;
    sm.value = String(config.sibilanceMix);
    sm.dispatchEvent(new Event('input'));
  }

  for (const p of LFO_PARAMS) {
    if (config.params[p.key] !== undefined) {
      const slider = $(p.sliderId) as HTMLInputElement;
      slider.value = String(config.params[p.key]);
      slider.dispatchEvent(new Event('input'));
    }
  }

  for (const p of LFO_PARAMS) {
    const lfo = config.lfos?.[p.key];
    if (!lfo) continue;
    const row = $(`lfo-${p.key}`);
    for (const [attr, val] of Object.entries(lfo)) {
      const slider = row.querySelector<HTMLInputElement>(`[data-lfo="${attr}"]`);
      if (slider) {
        slider.value = String(val);
        slider.dispatchEvent(new Event('input'));
      }
    }
  }
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function pickFile(accept: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { reject(new Error('No file selected')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    };
    input.click();
  });
}

function saveConfig(): void {
  const config = gatherConfig();
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob(blob, `vocoder-config-${Date.now()}.json`);
}

async function loadConfig(): Promise<void> {
  try {
    const json = await pickFile('.json');
    const config = JSON.parse(json) as SavedConfig;
    if (config.version !== CONFIG_VERSION) {
      $('status').textContent = `Unknown config version: ${config.version}`;
      $('status').style.color = '#f87171';
      return;
    }
    applyConfig(config);
    $('status').textContent = 'Config loaded';
    $('status').style.color = '#4ade80';
  } catch (err) {
    if ((err as Error).message === 'No file selected') return;
    $('status').textContent = `Load error: ${err}`;
    $('status').style.color = '#f87171';
  }
}

// -- WAV export --

/** Tail padding so envelope followers can ring out after source ends */
const OFFLINE_TAIL_S = 0.5;
const WAV_BITS_PER_SAMPLE = 16;
const WAV_HEADER_BYTES = 44;

async function renderOffline(): Promise<AudioBuffer> {
  if (!currentAudioBuffer) throw new Error('No audio buffer');

  const speed = parseFloat(($('slider-speed') as HTMLInputElement).value);
  const duration = currentAudioBuffer.duration / speed + OFFLINE_TAIL_S;
  const sampleRate = currentAudioBuffer.sampleRate;
  const numFrames = Math.ceil(duration * sampleRate);

  const offlineCtx = new OfflineAudioContext(2, numFrames, sampleRate);
  const ctx = offlineCtx as unknown as AudioContext;
  let offlineVocoder: CreatureVocoder | ShepardVocoder | CylonVocoder;
  if (activeMode === 'creature') offlineVocoder = new CreatureVocoder(ctx);
  else if (activeMode === 'shepard') offlineVocoder = new ShepardVocoder(ctx);
  else offlineVocoder = new CylonVocoder(ctx);

  offlineVocoder.setCreatureParams({
    bodySize: parseFloat(($('slider-body-size') as HTMLInputElement).value),
    material: parseFloat(($('slider-material') as HTMLInputElement).value),
    aggression: parseFloat(($('slider-aggression') as HTMLInputElement).value),
  });

  offlineVocoder.setVocoderParams({
    bandCount: parseInt(($('slider-bands') as HTMLInputElement).value),
    carrierType: getActiveCarrierType(),
    wetDry: parseFloat(($('slider-wetdry') as HTMLInputElement).value),
    formantShift: parseFloat(($('slider-formant-shift') as HTMLInputElement).value),
    speed: parseFloat(($('slider-speed') as HTMLInputElement).value),
    filterHPCutoff: logCutoff(parseFloat(($('slider-filter-hp-cutoff') as HTMLInputElement).value)),
    filterHPResonance: parseFloat(($('slider-filter-hp-resonance') as HTMLInputElement).value),
    filterCutoff: logCutoff(parseFloat(($('slider-filter-cutoff') as HTMLInputElement).value)),
    filterResonance: parseFloat(($('slider-filter-resonance') as HTMLInputElement).value),
    filterEnvFollow: parseFloat(($('slider-filter-env-follow') as HTMLInputElement).value),
  });

  // Push sibilance params for Cylon offline render
  if (activeMode === 'cylon' && offlineVocoder instanceof CylonVocoder) {
    const freqT = parseFloat(($('slider-sibilance-freq') as HTMLInputElement).value);
    const mix = parseFloat(($('slider-sibilance-mix') as HTMLInputElement).value);
    offlineVocoder.setSibilanceParams(logSibilanceFreq(freqT), mix);
  }

  offlineVocoder.play(currentAudioBuffer, false, undefined, duration);
  return offlineCtx.startRendering();
}

function writeWAVString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWAV(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const bytesPerSample = WAV_BITS_PER_SAMPLE / 8;
  const blockAlign = numChannels * bytesPerSample;
  const numFrames = buffer.length;
  const dataSize = numFrames * blockAlign;

  const wav = new ArrayBuffer(WAV_HEADER_BYTES + dataSize);
  const view = new DataView(wav);

  writeWAVString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeWAVString(view, 8, 'WAVE');

  writeWAVString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);  // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);

  writeWAVString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(buffer.getChannelData(ch));
  }

  let offset = WAV_HEADER_BYTES;
  const MAX_POSITIVE = 0x7FFF;
  const MAX_NEGATIVE = 0x8000;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * MAX_NEGATIVE : sample * MAX_POSITIVE, true);
      offset += bytesPerSample;
    }
  }

  return wav;
}

async function saveAudio(): Promise<void> {
  if (!currentAudioBuffer) return;

  const statusEl = $('status');
  statusEl.textContent = 'Rendering audio offline...';
  statusEl.style.color = '#fbbf24';

  try {
    const rendered = await renderOffline();
    const wav = encodeWAV(rendered);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const durationSec = rendered.duration.toFixed(1);
    const sizeMB = (wav.byteLength / (1024 * 1024)).toFixed(2);
    downloadBlob(blob, `creature-voice-${Date.now()}.wav`);
    statusEl.textContent = `Saved ${durationSec}s WAV (${sizeMB} MB)`;
    statusEl.style.color = '#4ade80';
  } catch (err) {
    statusEl.textContent = `Render error: ${err}`;
    statusEl.style.color = '#f87171';
    console.error('Save audio failed:', err);
  }
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

  // Vocoder mode toggle
  $('btn-mode-creature').addEventListener('click', () => setVocoderMode('creature'));
  $('btn-mode-shepard').addEventListener('click', () => setVocoderMode('shepard'));
  $('btn-mode-cylon').addEventListener('click', () => setVocoderMode('cylon'));

  // Carrier type buttons
  document.querySelectorAll('.carrier-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setCarrierType(btn.getAttribute('data-carrier') as CarrierType);
    });
  });

  // Sibilance sliders (Cylon mode only)
  const sibilanceFreqSlider = $('slider-sibilance-freq') as HTMLInputElement;
  const sibilanceFreqVal = $('slider-sibilance-freq-val');
  sibilanceFreqSlider.addEventListener('input', () => {
    const t = parseFloat(sibilanceFreqSlider.value);
    sibilanceFreqVal.textContent = formatCutoff(logSibilanceFreq(t));
  });

  const sibilanceMixSlider = $('slider-sibilance-mix') as HTMLInputElement;
  const sibilanceMixVal = $('slider-sibilance-mix-val');
  sibilanceMixSlider.addEventListener('input', () => {
    sibilanceMixVal.textContent = `${Math.round(parseFloat(sibilanceMixSlider.value) * 100)}%`;
  });

  // Save / Load buttons
  $('btn-save-config').addEventListener('click', saveConfig);
  $('btn-load-config').addEventListener('click', loadConfig);
  $('btn-save-audio').addEventListener('click', saveAudio);

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
