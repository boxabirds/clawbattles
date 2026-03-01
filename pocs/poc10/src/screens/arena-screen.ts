import * as THREE from 'three';
import type { Screen, ScreenContext } from './screen.js';
import type { CreatureBlueprint, CreatureState, SensoryEvent } from '../simulation/types.js';
import { initLiveMatch, stepTick, getMatchResult, type LiveMatch } from '../simulation/match.js';
import { buildCreatureMesh, type CreatureMeshResult } from '../rendering/creature-mesh.js';
import { createArenaCamera, updateArenaCamera } from '../rendering/camera.js';
import { EffectsManager } from '../rendering/effects.js';
import { ARENA } from '../simulation/constants.js';
import { SoundManager } from '../audio/sound-manager.js';

// ── Arena constants ───────────────────────────────────────────────
const TICK_INTERVAL_MS = 100; // 10 Hz simulation
const LERP_FACTOR = 0.2; // Position interpolation per frame
const ARENA_FLOOR_COLOR = 0x0a0a10;
const ARENA_FLOOR_RADIUS = 50;
const ARENA_RING_COLOR = 0x222244;
const ARENA_RING_GLOW_COLOR = 0x6c63ff;

// Health bar team colors
const TEAM_COLORS = ['#34d399', '#60a5fa', '#f87171', '#fbbf24'];

interface CreatureVisual {
  meshResult: CreatureMeshResult;
  state: CreatureState;
  alive: boolean;
}

export class ArenaScreen implements Screen {
  private ctx: ScreenContext | null = null;
  private el: HTMLElement;
  private team: CreatureBlueprint[];

  // Simulation
  private match: LiveMatch | null = null;
  private tickTimer = 0;

  // Three.js
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private visuals: CreatureVisual[] = [];
  private effects: EffectsManager | null = null;
  private arenaObjects: THREE.Object3D[] = [];
  private startTime = 0;

  // Audio
  private sound: SoundManager;

  // Event handlers
  private onBack: (() => void) | null = null;

  constructor(team: CreatureBlueprint[]) {
    this.el = document.getElementById('arena-screen')!;
    this.team = team;
    this.sound = new SoundManager();
  }

  setTeam(team: CreatureBlueprint[]): void {
    this.team = team;
  }

  enter(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.el.classList.add('active');
    this.startTime = performance.now() * 0.001;

    // Set up scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(ARENA_FLOOR_COLOR);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0x8888aa, 1.2));
    const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight.position.set(20, 40, 20);
    this.scene.add(dirLight);
    const fillLight = new THREE.DirectionalLight(0x8899cc, 1.0);
    fillLight.position.set(-15, 10, -15);
    this.scene.add(fillLight);
    this.scene.add(new THREE.HemisphereLight(0x6699dd, 0x334466, 0.8));

    // Arena floor
    const floorGeo = new THREE.CircleGeometry(ARENA_FLOOR_RADIUS, 64);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: ARENA_FLOOR_COLOR,
      roughness: 0.9,
      metalness: 0.1,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    this.scene.add(floor);
    this.arenaObjects.push(floor);

    // Arena boundary ring
    const ringGeo = new THREE.TorusGeometry(ARENA_FLOOR_RADIUS, 0.3, 8, 64);
    ringGeo.rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshStandardMaterial({
      color: ARENA_RING_GLOW_COLOR,
      emissive: ARENA_RING_GLOW_COLOR,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.6,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.3;
    this.scene.add(ring);
    this.arenaObjects.push(ring);

    // Camera
    this.camera = createArenaCamera();

    // Effects
    this.effects = new EffectsManager(this.scene);

    // Initialize match: player team vs same team (mirror match)
    const allCreatures = [...this.team, ...this.team.map((bp) => ({
      ...structuredClone(bp),
      name: `${bp.name} (B)`,
    }))];

    this.match = initLiveMatch({
      seed: Date.now(),
      maxTicks: ARENA.MAX_TICKS,
      creatures: allCreatures,
    });

    // Build creature meshes
    this.visuals = [];
    for (let i = 0; i < this.match.creatures.length; i++) {
      const creature = this.match.creatures[i];
      const meshResult = buildCreatureMesh(creature.blueprint.body);
      meshResult.group.position.set(creature.position.x, 0, creature.position.y);
      this.scene.add(meshResult.group);

      this.visuals.push({
        meshResult,
        state: creature,
        alive: true,
      });
    }

    // Build health bars
    this.buildHealthBars();

    // Back button
    this.onBack = () => this.ctx?.navigate('menu');
    document.getElementById('btn-arena-back')!.addEventListener('click', this.onBack);

    // Winner overlay
    document.getElementById('winner-overlay')!.classList.remove('active');

    // Initialize sound (requires user gesture — arena entry counts)
    this.sound.init().then(() => {
      // Set synth params from first team creature
      if (this.team.length > 0) {
        this.sound.setCreatureParams(this.team[0]);
      }
    });

    this.tickTimer = 0;
  }

  exit(): void {
    this.el.classList.remove('active');
    if (this.onBack) {
      document.getElementById('btn-arena-back')!.removeEventListener('click', this.onBack);
    }
    this.effects?.dispose();
    this.sound.dispose();

    // Clean up meshes
    if (this.scene) {
      for (const v of this.visuals) {
        this.scene.remove(v.meshResult.group);
      }
      for (const obj of this.arenaObjects) {
        this.scene.remove(obj);
      }
    }
    this.visuals = [];
    this.arenaObjects = [];
    this.scene = null;
    this.camera = null;
    this.match = null;
  }

  update(dt: number): void {
    if (!this.scene || !this.camera || !this.ctx || !this.match) return;

    // Step simulation at 10 Hz
    this.tickTimer += dt;
    while (this.tickTimer >= TICK_INTERVAL_MS / 1000 && !this.match.finished) {
      this.tickTimer -= TICK_INTERVAL_MS / 1000;
      const events = stepTick(this.match);
      this.processEvents(events);
      this.sound.processEvents(events, this.match.creatures);
    }

    // Lerp creature positions
    for (const v of this.visuals) {
      if (!v.state.alive && v.alive) {
        // Just died
        v.alive = false;
        this.handleDeath(v);
      }

      if (v.alive) {
        const targetX = v.state.position.x;
        const targetZ = v.state.position.y;
        v.meshResult.group.position.x += (targetX - v.meshResult.group.position.x) * LERP_FACTOR;
        v.meshResult.group.position.z += (targetZ - v.meshResult.group.position.z) * LERP_FACTOR;
        v.meshResult.group.rotation.y = -v.state.facing + Math.PI / 2;
      }
    }

    // Update camera
    const alivePositions = this.visuals
      .filter((v) => v.alive)
      .map((v) => ({
        x: v.meshResult.group.position.x,
        y: 0,
        z: v.meshResult.group.position.z,
      }));
    const time = performance.now() * 0.001 - this.startTime;
    updateArenaCamera(this.camera, alivePositions, time);

    // Update effects
    this.effects?.update();

    // Update HUD
    this.updateTimer();
    this.updateHealthBars();

    // Check for match end
    if (this.match.finished) {
      this.showWinner();
    }

    // Render
    this.ctx.renderer.render(this.scene, this.camera);
  }

  resize(w: number, h: number): void {
    if (!this.camera) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ── Event Processing ────────────────────────────────────────────

  private processEvents(events: SensoryEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'contact_hit': {
          const targetVisual = this.visuals.find((v) => v.state.id === ev.creatureId);
          if (targetVisual) {
            // Flash the body mesh
            const bodyMesh = targetVisual.meshResult.group.children[0];
            if (bodyMesh instanceof THREE.Mesh) {
              this.effects?.triggerFlash(bodyMesh);
            }
          }
          break;
        }
        case 'part_lost': {
          const ownerVisual = this.visuals.find((v) => v.state.id === ev.creatureId);
          const instanceId = ev.data.instanceId as string;
          if (ownerVisual) {
            const partMesh = ownerVisual.meshResult.partMeshes.get(instanceId);
            if (partMesh) {
              const worldPos = new THREE.Vector3();
              partMesh.getWorldPosition(worldPos);
              this.effects?.spawnDebris(partMesh, worldPos);
              partMesh.removeFromParent();
            }
            this.addKillFeedEntry(ev);
          }
          break;
        }
        case 'enemy_killed': {
          this.addKillFeedEntry(ev);
          break;
        }
      }
    }
  }

  private handleDeath(visual: CreatureVisual): void {
    // Fade out and sink
    visual.meshResult.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.transparent = true;
        mat.opacity = 0.3;
      }
    });
    visual.meshResult.group.position.y = -0.5;
  }

  // ── HUD ─────────────────────────────────────────────────────────

  private buildHealthBars(): void {
    const container = document.getElementById('health-bars')!;
    container.innerHTML = '';

    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i];
      const color = TEAM_COLORS[i % TEAM_COLORS.length];

      const bar = document.createElement('div');
      bar.className = 'health-bar';
      bar.id = `hbar-${i}`;
      bar.innerHTML = `
        <div class="health-bar-name" style="color: ${color}">${v.state.name}</div>
        <div class="health-bar-bg">
          <div class="health-bar-fill" id="hbar-fill-${i}" style="width: 100%; background: ${color}"></div>
        </div>
      `;
      container.appendChild(bar);
    }
  }

  private updateHealthBars(): void {
    for (let i = 0; i < this.visuals.length; i++) {
      const v = this.visuals[i];
      const fill = document.getElementById(`hbar-fill-${i}`);
      if (!fill) continue;

      if (!v.state.alive) {
        fill.style.width = '0%';
      } else {
        // Estimate health from core durability
        const maxDur = v.state.rootPart.definition.durability;
        const curDur = Math.max(0, v.state.rootPart.currentDurability);
        const pct = Math.max(0, Math.min(100, (curDur / maxDur) * 100));
        fill.style.width = `${pct}%`;
      }
    }
  }

  private updateTimer(): void {
    if (!this.match) return;
    const seconds = Math.floor(this.match.tick / 10);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    document.getElementById('arena-timer')!.textContent =
      `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  private addKillFeedEntry(ev: SensoryEvent): void {
    const feed = document.getElementById('kill-feed')!;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';

    if (ev.type === 'part_lost') {
      const partId = ev.data.partId as string;
      entry.textContent = `${ev.creatureId} lost ${partId}`;
    } else if (ev.type === 'enemy_killed') {
      const cause = ev.data.cause as string;
      entry.textContent = `${ev.creatureId} died (${cause})`;
    }

    feed.appendChild(entry);

    // Limit visible entries
    const KILL_FEED_MAX = 6;
    const KILL_FEED_DURATION_MS = 6000;
    while (feed.children.length > KILL_FEED_MAX) {
      feed.removeChild(feed.firstChild!);
    }

    setTimeout(() => {
      if (entry.parentElement) {
        entry.remove();
      }
    }, KILL_FEED_DURATION_MS);
  }

  private showWinner(): void {
    if (!this.match) return;
    const result = getMatchResult(this.match);
    const winner = result.placements[0];

    const overlay = document.getElementById('winner-overlay')!;
    const text = document.getElementById('winner-text')!;

    if (overlay.classList.contains('active')) return; // already shown

    text.textContent = winner.creatureName;
    text.style.color = TEAM_COLORS[0]; // approximate
    overlay.classList.add('active');
  }
}
