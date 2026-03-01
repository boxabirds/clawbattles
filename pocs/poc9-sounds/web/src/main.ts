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
function sendCreatureParams(): void {
  if (!synthNode) return;
  synthNode.port.postMessage({
    type: 'setParams',
    body_size: parseFloat(($ ('slider-body-size') as HTMLInputElement).value),
    material: parseFloat(($('slider-material') as HTMLInputElement).value),
    weight: parseFloat(($('slider-weight') as HTMLInputElement).value),
    aggression: parseFloat(($('slider-aggression') as HTMLInputElement).value),
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
