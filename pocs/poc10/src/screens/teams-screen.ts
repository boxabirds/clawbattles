import * as THREE from 'three';
import type { Screen, ScreenContext } from './screen.js';
import type { CreatureBlueprint } from '../simulation/types.js';
import { buildCreatureMesh } from '../rendering/creature-mesh.js';
import { computeStats } from '../editor/editor-state.js';

/** Size of rendered creature preview thumbnails */
const PREVIEW_SIZE = 256;

/** Camera settings for creature preview */
const PREVIEW_CAM_DISTANCE = 4;
const PREVIEW_CAM_HEIGHT = 2;
const PREVIEW_CAM_FOV = 40;

export class TeamsScreen implements Screen {
  private ctx: ScreenContext | null = null;
  private el: HTMLElement;
  private gridEl: HTMLElement;
  private team: CreatureBlueprint[];
  private previewRenderers: THREE.WebGLRenderer[] = [];
  private previewScenes: THREE.Scene[] = [];
  private previewCameras: THREE.PerspectiveCamera[] = [];
  private onBack: () => void;
  private cellClickHandlers: Array<() => void> = [];

  constructor(team: CreatureBlueprint[]) {
    this.el = document.getElementById('teams-screen')!;
    this.gridEl = document.getElementById('team-grid')!;
    this.team = team;

    this.onBack = () => this.ctx?.navigate('menu');
  }

  /** Update a team slot (called after editor saves) */
  setCreature(index: number, blueprint: CreatureBlueprint): void {
    this.team[index] = blueprint;
  }

  getTeam(): CreatureBlueprint[] {
    return this.team;
  }

  enter(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.el.classList.add('active');

    document.getElementById('btn-teams-back')!.addEventListener('click', this.onBack);

    this.buildGrid();
  }

  exit(): void {
    this.el.classList.remove('active');
    document.getElementById('btn-teams-back')!.removeEventListener('click', this.onBack);

    // Clean up click handlers
    for (const handler of this.cellClickHandlers) {
      // handlers attached to elements that get cleared
    }
    this.cellClickHandlers = [];

    // Clean up preview renderers
    for (const r of this.previewRenderers) {
      r.dispose();
    }
    this.previewRenderers = [];
    this.previewScenes = [];
    this.previewCameras = [];
  }

  private buildGrid(): void {
    this.gridEl.innerHTML = '';

    for (let i = 0; i < this.team.length; i++) {
      const bp = this.team[i];
      const stats = computeStats(bp);

      const cell = document.createElement('div');
      cell.className = 'team-cell';

      // Preview canvas
      const canvas = document.createElement('canvas');
      canvas.className = 'cell-canvas';
      canvas.width = PREVIEW_SIZE;
      canvas.height = PREVIEW_SIZE;
      cell.appendChild(canvas);

      // Info
      const info = document.createElement('div');
      info.className = 'cell-info';
      info.innerHTML = `
        <div class="cell-name">${bp.name}</div>
        <div class="cell-stats">
          Parts: ${stats.partCount} | W: ${stats.weight} | E: ${stats.energy} | SPD: ${stats.speed.toFixed(1)}
        </div>
      `;
      cell.appendChild(info);

      // Edit hint
      const hint = document.createElement('div');
      hint.className = 'cell-edit-hint';
      hint.textContent = 'Click to edit';
      cell.appendChild(hint);

      // Click handler
      const handler = () => this.ctx?.editCreature(i);
      cell.addEventListener('click', handler);
      this.cellClickHandlers.push(handler);

      this.gridEl.appendChild(cell);

      // Set up 3D preview
      this.setupPreview(canvas, bp, i);
    }
  }

  private setupPreview(canvas: HTMLCanvasElement, bp: CreatureBlueprint, _index: number): void {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE);
    renderer.setClearColor(0x0f0f1e, 1);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0x8888aa, 1.2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(3, 5, 3);
    scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8899cc, 0.8);
    fillLight.position.set(-3, 2, -2);
    scene.add(fillLight);

    const camera = new THREE.PerspectiveCamera(PREVIEW_CAM_FOV, 1, 0.1, 50);
    camera.position.set(PREVIEW_CAM_DISTANCE, PREVIEW_CAM_HEIGHT, PREVIEW_CAM_DISTANCE);
    camera.lookAt(0, 0, 0);

    const { group } = buildCreatureMesh(bp.body);
    scene.add(group);

    this.previewRenderers.push(renderer);
    this.previewScenes.push(scene);
    this.previewCameras.push(camera);
  }

  update(_dt: number): void {
    const time = performance.now() * 0.001;

    // Slowly rotate creature previews
    for (let i = 0; i < this.previewScenes.length; i++) {
      const scene = this.previewScenes[i];
      // Rotate the creature group (first child after lights)
      const group = scene.children.find((c) => c instanceof THREE.Group);
      if (group) {
        group.rotation.y = time * 0.5 + i * Math.PI / 2;
      }

      this.previewRenderers[i].render(scene, this.previewCameras[i]);
    }
  }

  resize(_w: number, _h: number): void {
    // Grid is CSS-driven
  }
}
