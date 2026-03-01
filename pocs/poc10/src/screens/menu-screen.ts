import type { Screen, ScreenContext } from './screen.js';

export class MenuScreen implements Screen {
  private ctx: ScreenContext | null = null;
  private el: HTMLElement;
  private onTeams: () => void;
  private onArena: () => void;

  constructor() {
    this.el = document.getElementById('menu-screen')!;

    this.onTeams = () => this.ctx?.navigate('teams');
    this.onArena = () => this.ctx?.navigate('arena');
  }

  enter(ctx: ScreenContext): void {
    this.ctx = ctx;
    this.el.classList.add('active');

    document.getElementById('btn-teams')!.addEventListener('click', this.onTeams);
    document.getElementById('btn-arena')!.addEventListener('click', this.onArena);
  }

  exit(): void {
    this.el.classList.remove('active');
    document.getElementById('btn-teams')!.removeEventListener('click', this.onTeams);
    document.getElementById('btn-arena')!.removeEventListener('click', this.onArena);
  }

  update(_dt: number): void {
    // Menu has no per-frame updates
  }

  resize(_w: number, _h: number): void {
    // Menu is CSS-driven, no resize logic needed
  }
}
