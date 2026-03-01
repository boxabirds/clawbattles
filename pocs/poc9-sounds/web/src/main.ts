/**
 * POC 9: Generative Creature Sounds — Audio Synthesis Workbench
 *
 * Proves: Rust/WASM FM synthesis in AudioWorklet with SharedArrayBuffer telemetry.
 * Kill condition: latency >10ms or artifacts with 20+ simultaneous voices.
 */

import { loadCreatureSynthWasm } from './audio/wasm-loader';

// === SAB Layout (must match processor) ===
const SAB_ACTIVE_VOICES = 0;
const SAB_TOTAL_RENDERS = 1;
const SAB_PEAK_LEVEL = 2;
const SAB_RENDER_US = 3;
const SAB_STATE_SLOTS = 4;
const SAB_BYTES = SAB_STATE_SLOTS * 4; // 16 bytes

// === Sound type enum (must match Rust) ===
const SOUND_FOOTSTEP = 0;
const SOUND_CLAW_STRIKE = 1;
const SOUND_PART_DETACH = 2;
const SOUND_IDLE_BREATH = 3;
const SOUND_VOCALIZE = 4;

const STRESS_TEST_VOICE_COUNT = 30;
const TELEMETRY_POLL_MS = 50;

// === Config persistence ===
const CONFIG_VERSION = 1;

interface CreatureConfig {
  version: number;
  creature: {
    bodySize: number;
    material: number;
    weight: number;
    aggression: number;
  };
}

// === Offline render schedule ===
const RENDER_SOUND_SPACING_S = 0.8;
const RENDER_SOUND_COUNT = 5;
const RENDER_TAIL_S = 1.5;
const RENDER_BLOCK_FRAMES = 128;
const RENDER_CHANNELS = 2;
const DEFAULT_SAMPLE_RATE = 48000;

// === State ===
let audioContext: AudioContext | null = null;
let synthNode: AudioWorkletNode | null = null;
let sabInt32: Int32Array | null = null;
let sabFloat32: Float32Array | null = null;
let telemetryInterval: number | null = null;

// === DOM refs ===
const $ = (id: string) => document.getElementById(id)!;

// === Audio init ===
async function initAudio(): Promise<void> {
  const statusEl = $('status');
  statusEl.textContent = 'Loading WASM...';

  try {
    // 1. Load WASM module
    const wasmModule = await loadCreatureSynthWasm();
    statusEl.textContent = 'Creating AudioContext...';

    // 2. Create AudioContext
    audioContext = new AudioContext({ latencyHint: 'interactive' });

    // 3. Create SharedArrayBuffer for telemetry
    const sab = new SharedArrayBuffer(SAB_BYTES);
    sabInt32 = new Int32Array(sab, 0, SAB_STATE_SLOTS);
    sabFloat32 = new Float32Array(sab, 0, SAB_STATE_SLOTS);

    // 4. Register AudioWorklet processor
    const processorUrl = new URL('./audio/creature-synth-processor.ts', import.meta.url).href;
    await audioContext.audioWorklet.addModule(processorUrl);
    statusEl.textContent = 'Initializing engine...';

    // 5. Create AudioWorkletNode
    synthNode = new AudioWorkletNode(audioContext, 'creature-synth-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: { wasmModule, sab },
    });

    // 6. Connect to output
    synthNode.connect(audioContext.destination);

    // 7. Handle messages from processor
    synthNode.port.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'ready') {
        statusEl.textContent = `Running (${audioContext!.sampleRate} Hz)`;
        statusEl.style.color = '#4ade80';
        enableControls(true);
      } else if (msg.type === 'error') {
        statusEl.textContent = `Error: ${msg.message}`;
        statusEl.style.color = '#f87171';
      }
    };

    // 8. Start telemetry polling
    telemetryInterval = window.setInterval(pollTelemetry, TELEMETRY_POLL_MS);

    // Send initial creature params
    sendCreatureParams();
  } catch (err) {
    statusEl.textContent = `Failed: ${err}`;
    statusEl.style.color = '#f87171';
    console.error('Audio init failed:', err);
  }
}

// === Controls ===
function getCreatureParams() {
  return {
    bodySize: parseFloat(($('slider-body-size') as HTMLInputElement).value),
    material: parseFloat(($('slider-material') as HTMLInputElement).value),
    weight: parseFloat(($('slider-weight') as HTMLInputElement).value),
    aggression: parseFloat(($('slider-aggression') as HTMLInputElement).value),
  };
}

function setSlider(id: string, value: number): void {
  const slider = $(id) as HTMLInputElement;
  const valEl = $(`${id}-val`);
  const clamped = Math.max(0, Math.min(1, value));
  slider.value = clamped.toString();
  valEl.textContent = clamped.toFixed(2);
}

function sendCreatureParams(): void {
  if (!synthNode) return;
  const p = getCreatureParams();
  synthNode.port.postMessage({
    type: 'setParams',
    body_size: p.bodySize,
    material: p.material,
    weight: p.weight,
    aggression: p.aggression,
  });
}

function triggerSound(soundType: number): void {
  if (!synthNode) return;
  // Resume context if suspended (browser autoplay policy)
  if (audioContext?.state === 'suspended') {
    audioContext.resume();
  }
  synthNode.port.postMessage({ type: 'trigger', soundType });
}

function stressTest(): void {
  if (!synthNode) return;
  if (audioContext?.state === 'suspended') {
    audioContext.resume();
  }
  synthNode.port.postMessage({
    type: 'stressTest',
    count: STRESS_TEST_VOICE_COUNT,
    soundType: SOUND_FOOTSTEP,
  });
}

function releaseAll(): void {
  if (!synthNode) return;
  synthNode.port.postMessage({ type: 'releaseAll' });
}

// === Save / Load ===
function saveConfig(): void {
  const config: CreatureConfig = {
    version: CONFIG_VERSION,
    creature: getCreatureParams(),
  };
  const json = JSON.stringify(config, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), `creature-config-${Date.now()}.json`);
}

function loadConfig(): void {
  ($('file-load-config') as HTMLInputElement).click();
}

function handleConfigFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const config = JSON.parse(reader.result as string) as CreatureConfig;
      if (!config.creature) throw new Error('Missing creature params');
      const { bodySize, material, weight, aggression } = config.creature;
      setSlider('slider-body-size', bodySize);
      setSlider('slider-material', material);
      setSlider('slider-weight', weight);
      setSlider('slider-aggression', aggression);
      sendCreatureParams();
      $('status').textContent = 'Config loaded';
      $('status').style.color = '#4ade80';
    } catch (err) {
      $('status').textContent = `Config load failed: ${err}`;
      $('status').style.color = '#f87171';
    }
  };
  reader.readAsText(file);
}

async function saveAudio(): Promise<void> {
  const statusEl = $('status');
  const origText = statusEl.textContent;
  const origColor = statusEl.style.color;

  try {
    statusEl.textContent = 'Rendering audio...';
    statusEl.style.color = '#fbbf24';

    // Initialize a WASM instance on the main thread for offline rendering
    const wasmModule = await loadCreatureSynthWasm();
    const wasm = await import('@creature-synth/creature_synth.js');
    await wasm.default({ module_or_path: wasmModule });

    const sampleRate = audioContext?.sampleRate ?? DEFAULT_SAMPLE_RATE;
    wasm.init_engine(sampleRate);

    const params = getCreatureParams();
    wasm.set_creature_params(params.bodySize, params.material, params.weight, params.aggression);

    const totalSeconds = RENDER_SOUND_COUNT * RENDER_SOUND_SPACING_S + RENDER_TAIL_S;
    const totalFrames = Math.ceil(totalSeconds * sampleRate);
    const totalBlocks = Math.ceil(totalFrames / RENDER_BLOCK_FRAMES);

    // Pre-calculate which block triggers which sound type
    const triggerAtBlock = new Map<number, number>();
    for (let i = 0; i < RENDER_SOUND_COUNT; i++) {
      const block = Math.floor((i * RENDER_SOUND_SPACING_S * sampleRate) / RENDER_BLOCK_FRAMES);
      triggerAtBlock.set(block, i);
    }

    // Offline render
    const left = new Float32Array(totalBlocks * RENDER_BLOCK_FRAMES);
    const right = new Float32Array(totalBlocks * RENDER_BLOCK_FRAMES);
    const blockBuf = new Float32Array(RENDER_BLOCK_FRAMES * RENDER_CHANNELS);

    for (let b = 0; b < totalBlocks; b++) {
      const soundType = triggerAtBlock.get(b);
      if (soundType !== undefined) {
        wasm.trigger_sound(soundType);
      }
      wasm.render_block(blockBuf);
      const offset = b * RENDER_BLOCK_FRAMES;
      for (let i = 0; i < RENDER_BLOCK_FRAMES; i++) {
        left[offset + i] = blockBuf[i * RENDER_CHANNELS];
        right[offset + i] = blockBuf[i * RENDER_CHANNELS + 1];
      }
    }

    const wavData = encodeWav(left.subarray(0, totalFrames), right.subarray(0, totalFrames), sampleRate);
    downloadBlob(new Blob([wavData], { type: 'audio/wav' }), `creature-${Date.now()}.wav`);

    statusEl.textContent = origText ?? 'Audio saved!';
    statusEl.style.color = origColor || '#4ade80';
  } catch (err) {
    statusEl.textContent = `Export failed: ${err}`;
    statusEl.style.color = '#f87171';
    console.error('Audio export failed:', err);
  }
}

// === WAV encoder (16-bit PCM stereo) ===
const WAV_HEADER_SIZE = 44;
const WAV_BITS_PER_SAMPLE = 16;
const WAV_BYTES_PER_SAMPLE = WAV_BITS_PER_SAMPLE / 8;
const WAV_NUM_CHANNELS = 2;
const MAX_INT16 = 0x7FFF;

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function encodeWav(left: Float32Array, right: Float32Array, sampleRate: number): ArrayBuffer {
  const numFrames = left.length;
  const dataSize = numFrames * WAV_NUM_CHANNELS * WAV_BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_SIZE + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, WAV_NUM_CHANNELS, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * WAV_NUM_CHANNELS * WAV_BYTES_PER_SAMPLE, true);
  view.setUint16(32, WAV_NUM_CHANNELS * WAV_BYTES_PER_SAMPLE, true);
  view.setUint16(34, WAV_BITS_PER_SAMPLE, true);

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleaved 16-bit samples
  let byteOffset = WAV_HEADER_SIZE;
  for (let i = 0; i < numFrames; i++) {
    view.setInt16(byteOffset, Math.max(-1, Math.min(1, left[i])) * MAX_INT16, true);
    byteOffset += WAV_BYTES_PER_SAMPLE;
    view.setInt16(byteOffset, Math.max(-1, Math.min(1, right[i])) * MAX_INT16, true);
    byteOffset += WAV_BYTES_PER_SAMPLE;
  }

  return buffer;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// === Telemetry (reads SAB atomically) ===
function pollTelemetry(): void {
  if (!sabInt32 || !sabFloat32) return;

  const activeVoices = Atomics.load(sabInt32, SAB_ACTIVE_VOICES);
  const totalRenders = Atomics.load(sabInt32, SAB_TOTAL_RENDERS);
  const peakLevel = sabFloat32[SAB_PEAK_LEVEL];
  const renderUs = sabFloat32[SAB_RENDER_US];

  $('tel-voices').textContent = `${activeVoices} / 32`;
  $('tel-renders').textContent = totalRenders.toLocaleString();
  $('tel-render-time').textContent = `${renderUs.toFixed(1)} \u00b5s`;
  $('tel-peak').textContent = peakLevel.toFixed(3);

  // Voice count bar
  const voiceBar = $('voice-bar-fill') as HTMLElement;
  const voicePct = (activeVoices / 32) * 100;
  voiceBar.style.width = `${voicePct}%`;
  voiceBar.style.background = activeVoices > 24 ? '#f87171' : activeVoices > 16 ? '#fbbf24' : '#4ade80';

  // Peak level bar
  const peakBar = $('peak-bar-fill') as HTMLElement;
  peakBar.style.width = `${Math.min(peakLevel, 1.0) * 100}%`;
  peakBar.style.background = peakLevel > 0.9 ? '#f87171' : peakLevel > 0.6 ? '#fbbf24' : '#4ade80';

  // Render time indicator
  const renderTimeEl = $('tel-render-time');
  // At 48kHz, 128 samples = 2667 µs budget
  const BLOCK_BUDGET_US = 2667;
  const loadPct = (renderUs / BLOCK_BUDGET_US) * 100;
  renderTimeEl.style.color = loadPct > 80 ? '#f87171' : loadPct > 50 ? '#fbbf24' : '#4ade80';
}

// === UI wiring ===
function enableControls(enabled: boolean): void {
  const controls = document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('.control');
  controls.forEach((el) => (el.disabled = !enabled));
}

function setupUI(): void {
  // Sound trigger buttons
  $('btn-footstep').addEventListener('click', () => triggerSound(SOUND_FOOTSTEP));
  $('btn-claw').addEventListener('click', () => triggerSound(SOUND_CLAW_STRIKE));
  $('btn-detach').addEventListener('click', () => triggerSound(SOUND_PART_DETACH));
  $('btn-breath').addEventListener('click', () => triggerSound(SOUND_IDLE_BREATH));
  $('btn-vocalize').addEventListener('click', () => triggerSound(SOUND_VOCALIZE));

  // Stress test
  $('btn-stress').addEventListener('click', stressTest);
  $('btn-release').addEventListener('click', releaseAll);

  // Save / Load
  $('btn-save-config').addEventListener('click', saveConfig);
  $('btn-load-config').addEventListener('click', loadConfig);
  $('btn-save-audio').addEventListener('click', saveAudio);
  ($('file-load-config') as HTMLInputElement).addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleConfigFile(file);
    (e.target as HTMLInputElement).value = ''; // allow re-selecting same file
  });

  // Creature param sliders
  const sliders = ['slider-body-size', 'slider-material', 'slider-weight', 'slider-aggression'];
  for (const id of sliders) {
    const slider = $(id) as HTMLInputElement;
    const valueEl = $(`${id}-val`);
    slider.addEventListener('input', () => {
      valueEl.textContent = parseFloat(slider.value).toFixed(2);
      sendCreatureParams();
    });
  }

  // Init button (first user gesture needed for AudioContext)
  $('btn-init').addEventListener('click', async () => {
    $('btn-init').setAttribute('disabled', 'true');
    ($('btn-init') as HTMLButtonElement).textContent = 'Initializing...';
    await initAudio();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!synthNode) return;
    switch (e.key) {
      case '1': triggerSound(SOUND_FOOTSTEP); break;
      case '2': triggerSound(SOUND_CLAW_STRIKE); break;
      case '3': triggerSound(SOUND_PART_DETACH); break;
      case '4': triggerSound(SOUND_IDLE_BREATH); break;
      case '5': triggerSound(SOUND_VOCALIZE); break;
      case ' ':
        e.preventDefault();
        stressTest();
        break;
    }
  });
}

// === Boot ===
setupUI();
enableControls(false);
