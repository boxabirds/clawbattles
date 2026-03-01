/**
 * Playwright diagnostic: sound in real browser conditions (no autoplay bypass).
 * Tests that AudioContext is created in user gesture and actually produces audio.
 */

import { chromium } from 'playwright';

const PAGE_URL = 'http://localhost:3006';
const SOUND_INIT_TIMEOUT_MS = 10_000;

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: [
      // NO --autoplay-policy flag — testing real browser behavior
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
    ],
  });

  const page = await (await browser.newContext()).newPage();

  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    if (msg.text().includes('sound') || msg.text().includes('Sound') || msg.text().includes('Audio')) {
      console.log(`  CONSOLE: ${text}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`  PAGE ERROR: ${err.message}`);
    logs.push(`PAGE ERROR: ${err.message}`);
  });

  console.log(`\n=== 1. Loading page (NO autoplay bypass) ===`);
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const statusBefore = await page.$eval('#sound-status', (el) => el.textContent);
  console.log(`  SND before click: "${statusBefore}"`);

  // Simulate a real user click (this is the gesture that must unlock AudioContext)
  console.log(`\n=== 2. Clicking page (user gesture) ===`);
  await page.click('#control-panel'); // click somewhere visible

  // Wait for init
  try {
    await page.waitForFunction(
      () => document.getElementById('sound-status')?.textContent?.includes('OK'),
      { timeout: SOUND_INIT_TIMEOUT_MS },
    );
  } catch {
    const status = await page.$eval('#sound-status', (el) => el.textContent);
    console.log(`  SND stuck at: "${status}"`);
  }

  const statusAfter = await page.$eval('#sound-status', (el) => el.textContent);
  console.log(`  SND after click: "${statusAfter}"`);

  // Check AudioContext state
  const acState = await page.evaluate(() => {
    // Try to find AudioContext state via a debug hook
    // We injected nothing, but we can check if there's audio output
    const ctx = (window as any).__debugAudioCtx;
    return ctx ? ctx.state : 'not exposed';
  });
  console.log(`  AudioContext state: ${acState}`);

  // Instrument and observe triggers
  await page.evaluate(() => {
    const origPost = MessagePort.prototype.postMessage;
    (window as any).__triggers = [] as any[];
    MessagePort.prototype.postMessage = function (msg: any, ...args: any[]) {
      if (msg?.type === 'trigger') {
        (window as any).__triggers.push({ soundType: msg.soundType, time: performance.now() });
      }
      return origPost.apply(this, [msg, ...args] as any);
    };
  });

  console.log(`\n=== 3. Observing 5s ===`);
  await page.waitForTimeout(5000);

  const triggers: any[] = await page.evaluate(() => (window as any).__triggers);
  const names = ['footstep', 'claw_strike', 'part_detach'];
  const counts: Record<string, number> = {};
  for (const t of triggers) {
    const name = names[t.soundType] ?? String(t.soundType);
    counts[name] = (counts[name] ?? 0) + 1;
  }

  console.log(`  Total triggers: ${triggers.length}`);
  for (const [name, count] of Object.entries(counts)) {
    console.log(`    ${name}: ${count}`);
  }

  // Check for any audio-related errors
  const audioErrors = logs.filter(
    (l) => (l.includes('Audio') || l.includes('audio') || l.includes('suspend') ||
            l.includes('gesture') || l.includes('autoplay')) && l.includes('error'),
  );
  if (audioErrors.length > 0) {
    console.log(`\n=== Audio errors ===`);
    audioErrors.forEach((l) => console.log(`  ${l}`));
  }

  console.log(`\n=== ${statusAfter?.includes('OK') && triggers.length > 0 ? 'PASS' : 'FAIL'} ===`);

  await browser.close();
}

main().catch((e) => { console.error('Test failed:', e); process.exit(1); });
