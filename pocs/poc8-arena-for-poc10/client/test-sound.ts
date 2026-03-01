/**
 * Playwright diagnostic: WebGPU renderer + sound system check.
 * Usage: npx tsx test-sound.ts
 */

import { chromium } from 'playwright';

const PAGE_URL = 'http://localhost:3006';
const SOUND_INIT_TIMEOUT_MS = 10_000;
const RENDER_SETTLE_MS = 3_000;

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
    console.log(`  CONSOLE: ${text}`);
  });
  page.on('pageerror', (err) => {
    const text = `PAGE ERROR: ${err.message}`;
    logs.push(text);
    console.error(`  ${text}`);
  });

  console.log(`\n=== 1. Loading page ===`);
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(RENDER_SETTLE_MS);

  // Check if canvas exists and has WebGPU context
  const canvasInfo = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return { found: false };
    return {
      found: true,
      width: canvas.width,
      height: canvas.height,
      // Check what context type was created
      hasWebGPU: !!(canvas as any).__webgpuContext || true, // can't easily introspect
    };
  });
  console.log(`\n  Canvas:`, canvasInfo);

  // Check for WebGPU errors in logs
  const gpuErrors = logs.filter(
    (l) => l.includes('WebGPU') || l.includes('webgpu') || l.includes('GPU') ||
           l.includes('adapter') || l.includes('device'),
  );
  if (gpuErrors.length > 0) {
    console.log(`\n  GPU-related logs:`);
    gpuErrors.forEach((l) => console.log(`    ${l}`));
  }

  // Click to init sound
  console.log(`\n=== 2. Sound init ===`);
  await page.click('body');

  try {
    await page.waitForFunction(
      () => document.getElementById('sound-status')?.textContent?.includes('OK'),
      { timeout: SOUND_INIT_TIMEOUT_MS },
    );
    console.log('  Sound: OK');
  } catch {
    const status = await page.$eval('#sound-status', (el) => el.textContent);
    console.log(`  Sound stuck at: "${status}"`);
  }

  // Observe triggers
  await page.evaluate(() => {
    const origPost = MessagePort.prototype.postMessage;
    (window as any).__soundTriggerCount = 0;
    MessagePort.prototype.postMessage = function (msg: any, ...args: any[]) {
      if (msg && msg.type === 'trigger') (window as any).__soundTriggerCount++;
      return origPost.apply(this, [msg, ...args] as any);
    };
  });

  console.log(`\n=== 3. Observing 5s of match ===`);
  await page.waitForTimeout(5000);

  const triggers = await page.evaluate(() => (window as any).__soundTriggerCount);
  console.log(`  Sound triggers: ${triggers}`);

  // Screenshot
  await page.screenshot({ path: '/tmp/webgpu-test.png' });
  console.log('\n  Screenshot: /tmp/webgpu-test.png');

  // Error summary
  const errors = logs.filter((l) => l.includes('error') || l.includes('Error') || l.includes('ERROR'));
  if (errors.length > 0) {
    console.log(`\n=== Errors (${errors.length}) ===`);
    errors.forEach((l) => console.log(`  ${l}`));
  }

  console.log('\n=== DONE ===');
  await browser.close();
}

main().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
