import type * as THREE from 'three';

/** Lifecycle interface for each screen (menu, teams, editor, arena) */
export interface Screen {
  /** Called when screen becomes active. Set up scene, UI, listeners. */
  enter(ctx: ScreenContext): void;
  /** Called when screen is deactivated. Clean up scene, UI, listeners. */
  exit(): void;
  /** Called every animation frame while screen is active */
  update(dt: number): void;
  /** Called on window resize */
  resize(width: number, height: number): void;
}

/** Shared context passed to all screens */
export interface ScreenContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  /** Navigate to a different screen */
  navigate: (screenId: ScreenId) => void;
  /** Navigate to editor with a specific team slot index */
  editCreature: (slotIndex: number) => void;
}

export type ScreenId = 'menu' | 'teams' | 'editor' | 'arena';
