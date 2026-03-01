import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Screen, ScreenContext } from './screen.js';
import type { CreatureBlueprint, PartId, PartInstance, PortSlot } from '../simulation/types.js';
import { EditorState, getOpenPorts, canAttach, collectParts, findPart, findParent } from '../editor/editor-state.js';
import { createPartObject, orientPartAtPort, buildCreatureMesh } from '../rendering/creature-mesh.js';
import { getPartDef, getAllParts } from '../simulation/catalog.js';
import { createScene, clearSceneObjects } from '../rendering/scene-setup.js';

// ── Port visualization constants ──────────────────────────────────
const PORT_RADIUS = 0.06;
const PORT_COLOR = 0x00e5ff;
const PORT_EMISSIVE_INTENSITY = 2.0;
const PORT_HOVER_COLOR = 0xffffff;
const PORT_HOVER_SCALE = 1.5;
const PORT_PULSE_SPEED = 3.0;
const PORT_PULSE_MIN = 0.4;
const PORT_PULSE_MAX = 1.0;
const SNAP_THRESHOLD = 0.15;

// ── Stat display constants ────────────────────────────────────────
const STAT_MAX_SPEED = 12;
const STAT_MAX_HP = 120;
const STAT_MAX_DPS = 40;
const STAT_MAX_VISION = 30;
const STAT_MAX_WEIGHT = 20;
const STAT_MAX_ENERGY = 10;

// ── Part category colors (for left panel dots) ────────────────────
const PART_DOT_COLORS: Record<string, string> = {
  core: '#6688aa',
  locomotion: '#44aa88',
  weapon: '#cc6644',
  armor: '#8888aa',
  sensor: '#aa44cc',
  passive_armor: '#777799',
};

interface PortMeshInfo {
  mesh: THREE.Mesh;
  parentInstanceId: string;
  portIndex: number;
  slot: PortSlot;
}

export class EditorScreen implements Screen {
  private ctx: ScreenContext | null = null;
  private el: HTMLElement;
  private state: EditorState;
  private slotIndex: number;
  private onSave: (index: number, bp: CreatureBlueprint) => void;

  // Three.js
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private creatureGroup: THREE.Group | null = null;
  private portMeshes: PortMeshInfo[] = [];
  private ghostMesh: THREE.Object3D | null = null;
  private hoveredPort: PortMeshInfo | null = null;
  private persistentObjects: THREE.Object3D[] = [];

  // Event handler refs
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onClick: ((e: MouseEvent) => void) | null = null;
  private onRightClick: ((e: MouseEvent) => void) | null = null;
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private onBack: (() => void) | null = null;

  constructor(
    blueprint: CreatureBlueprint,
    slotIndex: number,
    onSave: (index: number, bp: CreatureBlueprint) => void
  ) {
    this.el = document.getElementById('editor-screen')!;
    this.state = new EditorState(structuredClone(blueprint));
    this.slotIndex = slotIndex;
    this.onSave = onSave;
  }

  /** Replace the blueprint being edited */
  setBlueprint(blueprint: CreatureBlueprint, slotIndex: number): void {
    this.state = new EditorState(structuredClone(blueprint));
    this.slotIndex = slotIndex;
    this.rebuildCreature();
  }

  enter(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.el.classList.add('active');

    // Set up 3D scene
    const setup = createScene();
    this.scene = setup.scene;
    this.camera = setup.camera;
    this.persistentObjects = [setup.lights.ambient, setup.lights.directional, setup.lights.fill, setup.lights.hemisphere, setup.ground];

    const viewportEl = document.getElementById('editor-viewport')!;
    this.controls = new OrbitControls(this.camera, viewportEl);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Build UI
    this.buildPartsPanel();
    this.buildStatsPanel();
    this.rebuildCreature();

    // Event listeners
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onClick = (e) => this.handleClick(e);
    this.onRightClick = (e) => this.handleRightClick(e);
    this.onKeyDown = (e) => this.handleKeyDown(e);
    this.onBack = () => {
      this.onSave(this.slotIndex, structuredClone(this.state.blueprint));
      this.ctx?.navigate('teams');
    };

    viewportEl.addEventListener('mousemove', this.onMouseMove);
    viewportEl.addEventListener('click', this.onClick);
    viewportEl.addEventListener('contextmenu', this.onRightClick);
    document.addEventListener('keydown', this.onKeyDown);
    document.getElementById('btn-editor-back')!.addEventListener('click', this.onBack);
  }

  exit(): void {
    this.el.classList.remove('active');

    const viewportEl = document.getElementById('editor-viewport')!;
    if (this.onMouseMove) viewportEl.removeEventListener('mousemove', this.onMouseMove);
    if (this.onClick) viewportEl.removeEventListener('click', this.onClick);
    if (this.onRightClick) viewportEl.removeEventListener('contextmenu', this.onRightClick);
    if (this.onKeyDown) document.removeEventListener('keydown', this.onKeyDown);
    if (this.onBack) document.getElementById('btn-editor-back')!.removeEventListener('click', this.onBack);

    this.controls?.dispose();
    this.controls = null;

    // Clean up scene
    if (this.scene) {
      clearSceneObjects(this.scene, []);
    }
    this.scene = null;
    this.camera = null;
    this.portMeshes = [];
    this.ghostMesh = null;
    this.hoveredPort = null;
  }

  update(_dt: number): void {
    if (!this.scene || !this.camera || !this.ctx) return;

    this.controls?.update();

    // Pulse port meshes
    const now = performance.now() * 0.001;
    for (const pm of this.portMeshes) {
      if (pm === this.hoveredPort) continue;
      const pulse = Math.sin(now * PORT_PULSE_SPEED);
      const opacity = PORT_PULSE_MIN + (PORT_PULSE_MAX - PORT_PULSE_MIN) * (pulse * 0.5 + 0.5);
      (pm.mesh.material as THREE.MeshStandardMaterial).opacity = opacity;
    }

    // Render
    this.ctx.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    if (!this.camera) return;
    // Account for side panels
    const panelWidth = 180 + 200; // left + right panels
    const viewW = Math.max(w - panelWidth, 200);
    this.camera.aspect = viewW / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Parts Panel ─────────────────────────────────────────────────

  private buildPartsPanel(): void {
    const panel = document.getElementById('editor-parts-panel')!;
    panel.innerHTML = '';

    const categories: Record<string, PartId[]> = {
      'Core': ['body_small', 'body_large'],
      'Locomotion': ['leg_short', 'leg_long'],
      'Weapons': ['claw_small', 'claw_large', 'spike'],
      'Sensors': ['sensor_eye', 'sensor_antenna'],
      'Armor': ['armor_plate', 'shell_dorsal'],
    };

    for (const [catName, partIds] of Object.entries(categories)) {
      const title = document.createElement('div');
      title.className = 'part-section-title';
      title.textContent = catName;
      panel.appendChild(title);

      for (const partId of partIds) {
        const def = getPartDef(partId);
        const btn = document.createElement('button');
        btn.className = 'part-btn';
        btn.dataset.partId = partId;

        const dotColor = PART_DOT_COLORS[def.role] ?? '#888';
        btn.innerHTML = `
          <span class="part-dot" style="background: ${dotColor}"></span>
          <span>${def.name}</span>
          <span class="part-cost">${def.weight}</span>
        `;

        btn.addEventListener('click', () => this.selectPartType(partId));
        panel.appendChild(btn);
      }
    }

    // Action buttons
    const actionsTitle = document.createElement('div');
    actionsTitle.className = 'part-section-title';
    actionsTitle.textContent = 'Actions';
    panel.appendChild(actionsTitle);

    const undoBtn = document.createElement('button');
    undoBtn.className = 'action-btn secondary';
    undoBtn.textContent = 'Undo';
    undoBtn.addEventListener('click', () => {
      this.state.undo();
      this.rebuildCreature();
    });
    panel.appendChild(undoBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'action-btn secondary';
    clearBtn.textContent = 'Clear All';
    clearBtn.addEventListener('click', () => {
      this.state.reset();
      this.rebuildCreature();
    });
    panel.appendChild(clearBtn);
  }

  private selectPartType(partId: PartId): void {
    if (this.state.selectedPartType === partId) {
      this.state.selectedPartType = null;
      this.removeGhost();
    } else {
      this.state.selectedPartType = partId;
      this.createGhost(partId);
    }
    this.updatePartButtons();
  }

  private updatePartButtons(): void {
    const buttons = document.querySelectorAll('.part-btn');
    buttons.forEach((btn) => {
      const el = btn as HTMLElement;
      el.classList.toggle('active', el.dataset.partId === this.state.selectedPartType);
    });
  }

  // ── Stats Panel ─────────────────────────────────────────────────

  private buildStatsPanel(): void {
    const panel = document.getElementById('editor-stats-panel')!;
    panel.innerHTML = '';
    this.updateStatsPanel();
  }

  private updateStatsPanel(): void {
    const panel = document.getElementById('editor-stats-panel')!;
    const stats = this.state.getStats();

    const rows = [
      { label: 'Speed', value: stats.speed.toFixed(1), max: STAT_MAX_SPEED, color: '#34d399' },
      { label: 'HP', value: String(stats.hp), max: STAT_MAX_HP, color: '#60a5fa' },
      { label: 'DPS', value: String(stats.dps), max: STAT_MAX_DPS, color: '#f87171' },
      { label: 'Vision', value: String(stats.vision), max: STAT_MAX_VISION, color: '#a78bfa' },
      { label: 'Weight', value: `${stats.weight}/${STAT_MAX_WEIGHT}`, max: STAT_MAX_WEIGHT, color: '#fbbf24', current: stats.weight },
      { label: 'Energy', value: `${stats.energy}/${STAT_MAX_ENERGY}`, max: STAT_MAX_ENERGY, color: '#f472b6', current: stats.energy },
    ];

    panel.innerHTML = '<div class="part-section-title">Stats</div>';

    for (const row of rows) {
      const current = row.current ?? parseFloat(String(row.value));
      const pct = Math.min(100, (current / row.max) * 100);
      const overBudget = row.label === 'Weight' && stats.weight > STAT_MAX_WEIGHT;

      panel.innerHTML += `
        <div class="stat-row">
          <span class="stat-label">${row.label}</span>
          <div class="stat-bar-bg">
            <div class="stat-bar-fill" style="width: ${pct}%; background: ${overBudget ? '#ef4444' : row.color}"></div>
          </div>
          <span class="stat-value" style="${overBudget ? 'color: #ef4444' : ''}">${row.value}</span>
        </div>
      `;
    }

    // Creature info
    panel.innerHTML += `
      <div class="part-section-title" style="margin-top: 16px">Info</div>
      <div class="stat-row">
        <span class="stat-label">Parts</span>
        <span class="stat-value">${stats.partCount}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">Legs</span>
        <span class="stat-value">${stats.legCount}</span>
      </div>
    `;
  }

  // ── Creature Mesh Management ────────────────────────────────────

  private rebuildCreature(): void {
    if (!this.scene) return;

    // Remove old creature
    if (this.creatureGroup) {
      this.scene.remove(this.creatureGroup);
    }

    // Remove old port meshes
    for (const pm of this.portMeshes) {
      this.scene.remove(pm.mesh);
    }
    this.portMeshes = [];

    // Build new creature mesh
    const { group } = buildCreatureMesh(this.state.blueprint.body);
    this.creatureGroup = group;
    this.scene.add(group);

    // Build port meshes
    this.rebuildPorts();

    // Update stats
    this.updateStatsPanel();
  }

  private rebuildPorts(): void {
    if (!this.scene) return;

    // Remove existing
    for (const pm of this.portMeshes) {
      this.scene.remove(pm.mesh);
    }
    this.portMeshes = [];

    // Walk tree and add port spheres for open ports
    const addPorts = (instance: PartInstance, worldPos: THREE.Vector3) => {
      const openPorts = getOpenPorts(instance);
      const def = getPartDef(instance.partId);

      for (const { portIndex, slot } of openPorts) {
        // Filter: only show ports compatible with selected type
        if (this.state.selectedPartType && !canAttach(this.state.selectedPartType, slot)) {
          continue;
        }

        const geo = new THREE.SphereGeometry(PORT_RADIUS, 12, 12);
        const mat = new THREE.MeshStandardMaterial({
          color: PORT_COLOR,
          emissive: PORT_COLOR,
          emissiveIntensity: PORT_EMISSIVE_INTENSITY,
          transparent: true,
          opacity: 0.8,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);

        // Position at port location in world space
        const portPos = new THREE.Vector3(...slot.position);
        portPos.add(worldPos);
        mesh.position.copy(portPos);

        this.scene!.add(mesh);
        this.portMeshes.push({
          mesh,
          parentInstanceId: instance.instanceId,
          portIndex,
          slot,
        });
      }

      // Recurse into children
      for (const child of instance.children) {
        const childDef = getPartDef(child.partId);
        if (child.portIndex >= 0 && child.portIndex < def.portLayout.length) {
          const parentPort = def.portLayout[child.portIndex];
          const childWorldPos = worldPos.clone().add(new THREE.Vector3(...parentPort.position));
          addPorts(child, childWorldPos);
        }
      }
    };

    addPorts(this.state.blueprint.body, new THREE.Vector3(0, 0, 0));
  }

  // ── Ghost Preview ───────────────────────────────────────────────

  private createGhost(partId: PartId): void {
    this.removeGhost();
    this.ghostMesh = createPartObject(partId, true);
    this.ghostMesh.visible = false;
    this.scene?.add(this.ghostMesh);
    this.rebuildPorts();
  }

  private removeGhost(): void {
    if (this.ghostMesh && this.scene) {
      this.scene.remove(this.ghostMesh);
    }
    this.ghostMesh = null;
  }

  // ── Input Handling ──────────────────────────────────────────────

  private handleMouseMove(e: MouseEvent): void {
    if (!this.scene || !this.camera || !this.state.selectedPartType) return;

    const viewportEl = document.getElementById('editor-viewport')!;
    const rect = viewportEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    // Reset previous hover
    if (this.hoveredPort) {
      const mat = this.hoveredPort.mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(PORT_COLOR);
      mat.emissive.setHex(PORT_COLOR);
      this.hoveredPort.mesh.scale.setScalar(1);
      this.hoveredPort = null;
    }

    // Find nearest port
    let bestDist = SNAP_THRESHOLD;
    let bestPort: PortMeshInfo | null = null;

    for (const pm of this.portMeshes) {
      const ray = raycaster.ray;
      const portPos = pm.mesh.position;
      const dist = ray.distanceToPoint(portPos);
      if (dist < bestDist) {
        bestDist = dist;
        bestPort = pm;
      }
    }

    if (bestPort) {
      this.hoveredPort = bestPort;
      const mat = bestPort.mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(PORT_HOVER_COLOR);
      mat.emissive.setHex(PORT_HOVER_COLOR);
      bestPort.mesh.scale.setScalar(PORT_HOVER_SCALE);

      // Position ghost at port
      if (this.ghostMesh) {
        this.ghostMesh.visible = true;
        this.ghostMesh.position.copy(bestPort.mesh.position);
      }
    } else if (this.ghostMesh) {
      this.ghostMesh.visible = false;
    }
  }

  private handleClick(_e: MouseEvent): void {
    if (!this.hoveredPort || !this.state.selectedPartType) return;

    const added = this.state.addPart(
      this.state.selectedPartType,
      this.hoveredPort.parentInstanceId,
      this.hoveredPort.portIndex
    );

    if (added) {
      this.rebuildCreature();
    }
  }

  private handleRightClick(e: MouseEvent): void {
    e.preventDefault();
    if (!this.scene || !this.camera) return;

    // Find closest part under cursor and remove it
    const viewportEl = document.getElementById('editor-viewport')!;
    const rect = viewportEl.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const intersects = raycaster.intersectObjects(this.creatureGroup?.children ?? [], true);
    if (intersects.length > 0) {
      // Find which instance was hit — walk up to find top-level part object
      // For simplicity, remove the last placed part
      this.state.undo();
      this.rebuildCreature();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    switch (e.key.toLowerCase()) {
      case 's':
        this.state.symmetryOn = !this.state.symmetryOn;
        this.updateSymmetryBadge();
        break;
      case 'z':
        if (e.ctrlKey || e.metaKey) {
          this.state.undo();
          this.rebuildCreature();
        }
        break;
      case 'escape':
        this.state.selectedPartType = null;
        this.removeGhost();
        this.updatePartButtons();
        this.rebuildPorts();
        break;
      case 'delete':
      case 'backspace':
        this.state.undo();
        this.rebuildCreature();
        break;
    }
  }

  private updateSymmetryBadge(): void {
    const badge = document.getElementById('symmetry-badge')!;
    badge.textContent = `Symmetry: ${this.state.symmetryOn ? 'ON' : 'OFF'} [S]`;
    badge.classList.toggle('on', this.state.symmetryOn);
  }
}
