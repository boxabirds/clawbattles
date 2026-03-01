import * as THREE from 'three';
import type { Screen, ScreenContext, ScreenId } from './screens/screen.js';
import type { CreatureBlueprint } from './simulation/types.js';
import { MenuScreen } from './screens/menu-screen.js';
import { TeamsScreen } from './screens/teams-screen.js';
import { EditorScreen } from './screens/editor-screen.js';
import { ArenaScreen } from './screens/arena-screen.js';
import { ARCHETYPES } from './simulation/archetypes.js';

// ── Constants ────────────────────────────────────────────────────
const CANVAS_ID = 'viewport';
const MIN_DT = 1 / 120;
const MAX_DT = 1 / 10;
const TEAM_SIZE = 4;

// ── Bootstrap ────────────────────────────────────────────────────

function initRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}

function buildInitialTeam(): CreatureBlueprint[] {
  return [
    ARCHETYPES.berserker(),
    ARCHETYPES.tank(),
    ARCHETYPES.flanker(),
    ARCHETYPES.spiker(),
  ];
}

// ── App ──────────────────────────────────────────────────────────

class App {
  private renderer: THREE.WebGLRenderer;
  private canvas: HTMLCanvasElement;
  private team: CreatureBlueprint[];

  // Screen management
  private screens: Map<ScreenId, Screen>;
  private activeScreenId: ScreenId | null = null;
  private activeScreen: Screen | null = null;

  // Animation loop
  private lastTime = 0;

  constructor() {
    this.canvas = document.getElementById(CANVAS_ID) as HTMLCanvasElement;
    this.renderer = initRenderer(this.canvas);
    this.team = buildInitialTeam();

    // Create screens
    const teamsScreen = new TeamsScreen(this.team);
    const arenaScreen = new ArenaScreen(this.team);
    const editorScreen = new EditorScreen(
      this.team[0],
      0,
      (index, bp) => this.onEditorSave(index, bp),
    );

    this.screens = new Map<ScreenId, Screen>([
      ['menu', new MenuScreen()],
      ['teams', teamsScreen],
      ['editor', editorScreen],
      ['arena', arenaScreen],
    ]);

    // Handle resize
    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    // Start on menu
    this.navigate('menu');

    // Start animation loop
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  private buildContext(): ScreenContext {
    return {
      renderer: this.renderer,
      scene: new THREE.Scene(),
      canvas: this.canvas,
      navigate: (id: ScreenId) => this.navigate(id),
      editCreature: (slotIndex: number) => this.editCreature(slotIndex),
    };
  }

  private navigate(id: ScreenId): void {
    // Exit current screen
    if (this.activeScreen) {
      this.activeScreen.exit();
    }

    // Refresh arena team data before entering
    if (id === 'arena') {
      const arena = this.screens.get('arena') as ArenaScreen;
      arena.setTeam([...this.team]);
    }

    // Enter new screen
    this.activeScreenId = id;
    this.activeScreen = this.screens.get(id)!;
    this.activeScreen.enter(this.buildContext());

    // Trigger resize for new screen's camera
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.activeScreen.resize(w, h);
  }

  private editCreature(slotIndex: number): void {
    if (slotIndex < 0 || slotIndex >= TEAM_SIZE) return;

    const editor = this.screens.get('editor') as EditorScreen;
    editor.setBlueprint(this.team[slotIndex], slotIndex);
    this.navigate('editor');
  }

  private onEditorSave(index: number, blueprint: CreatureBlueprint): void {
    if (index < 0 || index >= TEAM_SIZE) return;

    this.team[index] = blueprint;

    // Update the teams screen data
    const teams = this.screens.get('teams') as TeamsScreen;
    teams.setCreature(index, blueprint);
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.activeScreen?.resize(w, h);
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));

    const rawDt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // Clamp dt to avoid spiral of death on tab-away
    const dt = Math.max(MIN_DT, Math.min(MAX_DT, rawDt));

    this.activeScreen?.update(dt);
  }
}

// ── Entry Point ──────────────────────────────────────────────────
new App();
