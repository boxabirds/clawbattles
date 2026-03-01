/**
 * Per-parameter LFO (Low Frequency Oscillator) engine.
 *
 * Each parameter can have an independent LFO that sweeps its value
 * between min and max at a given frequency. When frequency is 0
 * the parameter uses its static slider value instead.
 */

const TWO_PI = 2 * Math.PI;

export interface LFOConfig {
  min: number;
  max: number;
  freq: number; // Hz, 0 = disabled
}

export type ParamCallback = (values: Record<string, number>) => void;

export class LFOEngine {
  private configs: Map<string, LFOConfig> = new Map();
  private staticValues: Map<string, number> = new Map();
  private callback: ParamCallback;
  private rafId: number | null = null;
  private startTime = 0;

  constructor(callback: ParamCallback) {
    this.callback = callback;
  }

  /** Register a parameter with its default static value and LFO config. */
  register(name: string, staticValue: number, config: LFOConfig): void {
    this.staticValues.set(name, staticValue);
    this.configs.set(name, { ...config });
  }

  /** Update the static slider value for a parameter (used when LFO freq=0). */
  setStaticValue(name: string, value: number): void {
    this.staticValues.set(name, value);
  }

  /** Update LFO config for a parameter. */
  setLFO(name: string, config: Partial<LFOConfig>): void {
    const existing = this.configs.get(name);
    if (existing) {
      Object.assign(existing, config);
    }
  }

  /** Get the current computed value for a parameter (static or LFO-driven). */
  getValue(name: string, time: number): number {
    const config = this.configs.get(name);
    const staticVal = this.staticValues.get(name) ?? 0;
    if (!config || config.freq <= 0) return staticVal;

    // Sine LFO: maps [-1, 1] to [min, max]
    const phase = Math.sin(TWO_PI * config.freq * time);
    const t = phase * 0.5 + 0.5; // normalize to [0, 1]
    return config.min + t * (config.max - config.min);
  }

  /** Returns true if any parameter has an active LFO. */
  hasActiveLFOs(): boolean {
    for (const config of this.configs.values()) {
      if (config.freq > 0) return true;
    }
    return false;
  }

  /** Start the animation loop. Idempotent. */
  start(): void {
    if (this.rafId !== null) return;
    this.startTime = performance.now() / 1000;
    this.tick();
  }

  /** Stop the animation loop. */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick = (): void => {
    const time = performance.now() / 1000 - this.startTime;
    const values: Record<string, number> = {};

    for (const [name] of this.configs) {
      values[name] = this.getValue(name, time);
    }

    this.callback(values);
    this.rafId = requestAnimationFrame(this.tick);
  };
}
