import Phaser from 'phaser';
import { COLS, ROWS, type Board, type State, type Frame, type Tile } from './engine';
import { GEMS, assetUrl } from './assets';
import { ClearEffects, getClearTier } from './clear-effects';
import { animationTimings, paceDuration, type AnimationSpeed, type MotionMode } from './motion';

const SIZE = 90, PAD = 12;
const INSPECT_X = 28, INSPECT_Y = 28, INSPECT_HIT_RADIUS = 16;
const DOUBLE_TAP_MS = 280;
export const CANVAS_WIDTH = COLS * SIZE + PAD * 2;
export const CANVAS_HEIGHT = ROWS * SIZE + PAD * 2;
const center = (i: number) => ({ x: PAD + (i % COLS + .5) * SIZE, y: PAD + (Math.floor(i / COLS) + .5) * SIZE });
type GemView = Phaser.GameObjects.Container & { gemKind?: string };

export class BoardScene extends Phaser.Scene {
  private views = new Map<number, GemView>();
  private selected: number | null = null;
  private down: { cell: number; x: number; y: number; inspect: boolean } | null = null;
  private board: Board;
  private pendingClick: { cell: number; tileId: number; timer: Phaser.Time.TimerEvent } | null = null;
  private selection!: Phaser.GameObjects.Graphics;
  private hintMarks: Phaser.GameObjects.Graphics[] = [];
  private keyboardCell = 0;
  private ready = false;
  private clearFx?: ClearEffects;
  private scoreLabels = new Set<Phaser.GameObjects.Text>();
  private birthEffects: Phaser.GameObjects.Graphics | null = null;
  private specialCreation: { phase: 'idle' | 'clearing' | 'empty' | 'forming'; cells: number[]; oldIds: number[]; newIds: number[] } = { phase: 'idle', cells: [], oldIds: [], newIds: [] };
  private initial: State;
  private inputEnabled = false;
  private motionMode: MotionMode = 'full';
  private animationSpeed: AnimationSpeed = 'normal';
  onMove: (a: number, b: number) => void;
  onReady: () => void;
  onLoadError: () => void;
  onInspect: (tile: Tile) => void;
  onClear: (frame: Frame, tier: number, count: number) => void;

  constructor(initial: State, onMove: (a: number, b: number) => void, onReady: () => void, onLoadError: () => void, onInspect: (tile: Tile) => void, onClear: (frame: Frame, tier: number, count: number) => void) {
    super('board'); this.initial = initial; this.board = initial.board; this.onMove = onMove; this.onReady = onReady; this.onLoadError = onLoadError; this.onInspect = onInspect;
    this.onClear = onClear;
  }
  get reducedMotion() { return this.motionMode === 'gentle'; }
  setAnimationPreferences(mode: MotionMode, speed: AnimationSpeed) {
    this.motionMode = mode; this.animationSpeed = speed;
  }
  getAnimationPreferences() { return { mode: this.motionMode, speed: this.animationSpeed }; }
  private get timings() { return animationTimings(this.motionMode, this.animationSpeed); }
  get enabled() { return this.inputEnabled; }
  set enabled(value: boolean) {
    this.inputEnabled = value;
    if (!value) {
      this.cancelPendingClick(); this.down = null;
      if (this.selection) this.select(null);
      if (this.game?.canvas) { this.game.canvas.style.cursor = 'default'; this.game.canvas.title = ''; }
    }
  }
  preload() {
    [...GEMS, 'ultimate'].forEach(key => this.load.image(key, assetUrl(`gems/${key}.png`)));
    this.load.on('loaderror', () => this.onLoadError());
  }
  create() {
    this.clearFx = new ClearEffects(this);
    const cells = this.add.graphics();
    for (let i = 0; i < COLS * ROWS; i++) {
      const { x, y } = center(i);
      cells.fillStyle((Math.floor(i / COLS) + i % COLS) % 2 ? 0x23382e : 0x2a4035, .94);
      cells.fillRoundedRect(x - SIZE / 2 + 3, y - SIZE / 2 + 3, SIZE - 6, SIZE - 6, 9);
      cells.lineStyle(1, 0xd5be7b, .12);
      cells.strokeRoundedRect(x - SIZE / 2 + 3, y - SIZE / 2 + 3, SIZE - 6, SIZE - 6, 9);
      cells.fillStyle(0xffffff, .035);
      cells.fillRoundedRect(x - SIZE / 2 + 4, y - SIZE / 2 + 4, SIZE - 8, 20, 8);
    }
    this.selection = this.add.graphics().setDepth(10);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.enabled) return;
      const cell = this.cellAt(p.x, p.y);
      if (cell !== null) {
        this.keyboardCell = cell;
        const inspect = this.isInspectTarget(cell, p.x, p.y);
        // A badge gesture must never resolve a previously queued swap.
        if (inspect) this.cancelPendingClick();
        this.down = { cell, x: p.x, y: p.y, inspect };
      }
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (!this.enabled || !this.down) { this.down = null; return; }
      const { cell, x, y, inspect } = this.down; this.down = null;
      const dx = p.x - x, dy = p.y - y;
      this.clearHints();
      if (inspect) {
        if (Math.hypot(dx, dy) <= 18 && this.isInspectTarget(cell, p.x, p.y)) this.inspectCell(cell);
        return;
      }
      if (Math.hypot(dx, dy) > 18) {
        this.cancelPendingClick();
        const other = cell + (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : -1) : (dy > 0 ? COLS : -COLS));
        this.select(null); this.onMove(cell, other);
      } else if (this.cellAt(p.x, p.y) === cell) this.tapCell(cell);
    });
    this.input.on('pointerupoutside', () => { this.down = null; this.cancelPendingClick(); });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const cell = this.cellAt(p.x, p.y);
      const inspect = this.enabled && cell !== null && this.isInspectTarget(cell, p.x, p.y);
      this.game.canvas.style.cursor = inspect ? 'help' : this.enabled ? 'pointer' : 'default';
      this.game.canvas.title = inspect ? '查看特殊宝石效果' : '';
    });
    const canvas = this.game.canvas;
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', '八列七行宝石棋盘。方向键移动，空格或回车选择，再选择相邻宝石交换。双击特殊宝石或点击右下角放大镜查看效果，也可按I键查看。');
    canvas.addEventListener('keydown', this.keyHandler);
    this.events.once('shutdown', () => { this.cancelPendingClick(); this.clearEffects(); canvas.removeEventListener('keydown', this.keyHandler); });
    this.ready = true;
    this.renderState(this.initial);
    this.onReady();
  }
  private keyHandler = (event: KeyboardEvent) => {
    if (!this.enabled || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Escape', 'i', 'I'].includes(event.key)) return;
    event.preventDefault();
    this.cancelPendingClick();
    if (event.key.toLowerCase() === 'i') { this.inspectCell(this.keyboardCell); return; }
    let r = Math.floor(this.keyboardCell / COLS), c = this.keyboardCell % COLS;
    if (event.key === 'ArrowUp') r = Math.max(0, r - 1);
    if (event.key === 'ArrowDown') r = Math.min(ROWS - 1, r + 1);
    if (event.key === 'ArrowLeft') c = Math.max(0, c - 1);
    if (event.key === 'ArrowRight') c = Math.min(COLS - 1, c + 1);
    this.keyboardCell = r * COLS + c;
    if (event.key === 'Enter' || event.key === ' ') this.clickCell(this.keyboardCell);
    else if (event.key === 'Escape') { this.select(null); this.clearHints(); }
    else this.showHint([this.keyboardCell], false);
  };
  private cellAt(x: number, y: number) {
    const c = Math.floor((x - PAD) / SIZE), r = Math.floor((y - PAD) / SIZE);
    return c >= 0 && c < COLS && r >= 0 && r < ROWS ? r * COLS + c : null;
  }
  private isInspectTarget(cell: number, x: number, y: number) {
    const tile = this.board[cell];
    if (!tile || tile.special === 'normal') return false;
    const pos = center(cell);
    return Math.hypot(x - pos.x - INSPECT_X, y - pos.y - INSPECT_Y) <= INSPECT_HIT_RADIUS;
  }
  private cancelPendingClick() {
    this.pendingClick?.timer.remove(false);
    this.pendingClick = null;
  }
  private commitPendingClick() {
    const pending = this.pendingClick;
    this.cancelPendingClick();
    if (pending && this.enabled && this.board[pending.cell]?.id === pending.tileId) this.clickCell(pending.cell);
  }
  private tapCell(cell: number) {
    const tile = this.board[cell];
    if (!tile) return;
    if (this.pendingClick?.cell === cell && this.pendingClick.tileId === tile.id) {
      this.inspectCell(cell);
      return;
    }
    // A second, different cell confirms the first tap immediately for tap-to-swap.
    this.commitPendingClick();
    if (!this.enabled) return;
    if (tile.special === 'normal') { this.clickCell(cell); return; }
    // Delay only a special gem's single tap, so an adjacent selection cannot turn
    // the first half of a double tap into a swap (especially for an ultimate).
    const timer = this.time.delayedCall(DOUBLE_TAP_MS, () => this.commitPendingClick());
    this.pendingClick = { cell, tileId: tile.id, timer };
  }
  private inspectCell(cell: number) {
    const tile = this.board[cell];
    if (!this.enabled || !tile || tile.special === 'normal') return;
    this.cancelPendingClick(); this.down = null; this.select(null); this.clearHints();
    this.onInspect({ ...tile });
  }
  private clickCell(i: number) {
    if (this.selected === null) this.select(i);
    else if (this.selected === i) this.select(null);
    else {
      const previous = this.selected;
      if (Math.abs(previous % COLS - i % COLS) + Math.abs(Math.floor(previous / COLS) - Math.floor(i / COLS)) === 1) { this.select(null); this.onMove(previous, i); }
      else this.select(i);
    }
  }
  private select(i: number | null) {
    this.selected = i; this.selection.clear();
    if (i === null) return;
    const { x, y } = center(i);
    this.selection.lineStyle(3, 0xf6dfa2, 1).strokeRoundedRect(x - 42, y - 42, 84, 84, 10);
    this.selection.fillStyle(0xffe3a1, .1).fillRoundedRect(x - 42, y - 42, 84, 84, 10);
  }
  private createGem(tile: Tile): GemView {
    const container = this.add.container(0, 0) as GemView;
    container.gemKind = `${tile.color}:${tile.special}`;
    if (tile.special === 'bomb') {
      const ring = this.add.graphics();
      ring.lineStyle(2, 0xf6cf7a, .95).strokeCircle(0, 0, 35);
      [-1, 1].forEach(dx => [-1, 1].forEach(dy => { ring.fillStyle(0xf8d581).fillTriangle(dx * 36, dy * 26, dx * 26, dy * 36, dx * 37, dy * 37); }));
      container.add(ring);
    }
    if (tile.special === 'cross') {
      const cross = this.add.graphics();
      cross.lineStyle(6, 0xffe2a2, .35).lineBetween(-38, 0, 38, 0).lineBetween(0, -38, 0, 38);
      cross.lineStyle(2, 0xffe8ad, .95).lineBetween(-38, 0, 38, 0).lineBetween(0, -38, 0, 38);
      container.add(cross);
    }
    const gem = this.add.image(0, -1, tile.special === 'ultimate' ? 'ultimate' : GEMS[tile.color]);
    const max = tile.special === 'ultimate' ? 78 : 74;
    const scale = max / Math.max(gem.width, gem.height);
    gem.setScale(scale);
    container.add(gem);
    if (tile.special !== 'normal') {
      const badge = this.add.circle(INSPECT_X, INSPECT_Y, 12, 0xe4c27e).setStrokeStyle(1.5, 0x5b4523);
      const symbol = this.add.graphics();
      symbol.lineStyle(2, 0x28382c, 1).strokeCircle(INSPECT_X - 2, INSPECT_Y - 2, 4);
      symbol.lineBetween(INSPECT_X + 1, INSPECT_Y + 1, INSPECT_X + 5, INSPECT_Y + 5);
      container.add([badge, symbol]);
    }
    return container;
  }
  renderState(state: State, animate = false, kind: Frame['kind'] = 'drop'): Promise<void> {
    this.cancelPendingClick(); this.down = null; this.board = state.board;
    if (!this.ready) { this.initial = state; return Promise.resolve(); }
    const currentIds = new Set(state.board.filter(Boolean).map(t => t!.id));
    this.views.forEach((v, id) => { if (!currentIds.has(id)) { v.destroy(); this.views.delete(id); } });
    const promises: Promise<void>[] = [];
    const duration = kind === 'swap' || kind === 'invalid' ? this.timings.swap : kind === 'skill' ? this.timings.skillTransform : this.timings.drop;
    state.board.forEach((tile, i) => {
      if (!tile) return;
      let view = this.views.get(tile.id);
      const { x, y } = center(i);
      if (view && view.gemKind !== `${tile.color}:${tile.special}`) { view.destroy(); this.views.delete(tile.id); view = undefined; }
      if (!view) {
        view = this.createGem(tile); this.views.set(tile.id, view);
        view.setPosition(x, animate && kind === 'drop' && !this.reducedMotion ? y - SIZE * 2 : y);
        if (animate) view.setAlpha(0);
      }
      if (animate) {
        // Gentle mode still shows a readable arrival, without moving gems across
        // the board. It must never collapse a whole cascade into a 45ms tween.
        if (this.reducedMotion && (view.x !== x || view.y !== y)) view.setPosition(x, y).setAlpha(0);
        promises.push(this.tween({ targets: view, x, y, alpha: 1, scale: 1, duration, ease: 'Sine.easeInOut' }));
      }
      else view.setPosition(x, y).setAlpha(1).setScale(1);
    });
    return Promise.all(promises).then(() => undefined);
  }
  private tween(config: Phaser.Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise(resolve => this.tweens.add({ ...config, onComplete: () => resolve() }));
  }
  getEffectStats() {
    return this.clearFx?.stats ?? { serial: 0, tier: 0, count: 0, activeObjects: 0, peakObjects: 0, reducedMotion: this.reducedMotion, duration: 0, mode: this.motionMode, speed: this.animationSpeed };
  }
  getSpecialCreationStats() {
    const view = (id: number) => {
      const gem = this.views.get(id);
      return gem ? { alpha: gem.alpha, scale: gem.scaleX } : null;
    };
    return { ...this.specialCreation, oldViews: this.specialCreation.oldIds.map(view), newViews: this.specialCreation.newIds.map(view), effectActive: !!this.birthEffects };
  }
  clearEffects() {
    this.clearFx?.dispose();
    this.clearScoreLabels();
    this.birthEffects?.destroy(); this.birthEffects = null;
    this.specialCreation = { phase: 'idle', cells: [], oldIds: [], newIds: [] };
  }
  private beginSpecialCreation(frame: Frame, previous: State) {
    const cells = [...new Set(frame.spawns ?? [])].filter(i => previous.board[i] && frame.state.board[i] && frame.state.board[i]!.special !== 'normal');
    if (cells.length) this.specialCreation = { phase: 'clearing', cells, oldIds: cells.map(i => previous.board[i]!.id), newIds: cells.map(i => frame.state.board[i]!.id) };
    return cells;
  }
  private async revealSpecials(state: State, cells: number[]) {
    // Render a genuinely empty cell between the consumed gem and its replacement.
    // The simulation snapshot stays intact; only the presentation is staged.
    const vacant = { ...state, board: state.board.map((tile, i) => cells.includes(i) ? null : tile) };
    this.clearFx?.dispose();
    this.clearScoreLabels();
    await this.renderState(vacant);
    this.specialCreation.phase = 'empty';
    await this.delay(this.timings.settle);
    this.board = state.board;
    const births = cells.map(i => {
      const tile = state.board[i]!, pos = center(i), view = this.createGem(tile);
      view.setPosition(pos.x, pos.y).setAlpha(0).setScale(this.reducedMotion ? 1 : .18);
      this.views.set(tile.id, view);
      return view;
    });
    this.specialCreation.phase = 'forming';
    const effect = this.add.graphics().setDepth(16).setName('special-birth-effects');
    this.birthEffects = effect;
    const progress = { value: 0 };
    const draw = () => {
      effect.clear();
      const p = progress.value, opacity = Math.sin(Math.PI * p);
      cells.forEach(i => {
        const { x, y } = center(i), kind = state.board[i]!.special;
        const color = kind === 'bomb' ? 0xffc790 : kind === 'cross' ? 0xbde6ff : 0xe2c3ff;
        if (this.reducedMotion) {
          effect.fillStyle(color, opacity * .12).fillRoundedRect(x - 39, y - 39, 78, 78, 9);
          effect.lineStyle(2, color, opacity * .85).strokeRoundedRect(x - 39, y - 39, 78, 78, 9);
        } else {
          effect.lineStyle(2, color, opacity * .9).strokeCircle(x, y, 52 - p * 17);
          effect.lineStyle(1, 0xffefcb, opacity * .6).strokeCircle(x, y, 40 + p * 10);
          for (let k = 0; k < 8; k++) {
            const angle = k * Math.PI / 4 + Math.PI / 8;
            const outer = 57 - p * 27, inner = outer - 9;
            effect.lineStyle(k % 2 ? 1 : 2, k % 2 ? color : 0xffefcb, opacity);
            effect.lineBetween(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner, x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
          }
        }
      });
    };
    try {
      await Promise.all([
        this.tween({ targets: births, alpha: 1, scale: 1, duration: this.timings.specialBirth, ease: this.reducedMotion ? 'Sine.easeInOut' : 'Back.easeOut' }),
        this.tween({ targets: progress, value: 1, duration: this.timings.specialBirth, onUpdate: draw }),
      ]);
    } finally {
      effect.destroy(); this.birthEffects = null;
      this.specialCreation = { phase: 'idle', cells: [], oldIds: [], newIds: [] };
    }
  }
  private clearScoreLabels() {
    this.scoreLabels.forEach(label => { this.tweens.killTweensOf(label); label.destroy(); });
    this.scoreLabels.clear();
  }
  async play(frame: Frame, previous: State) {
    this.select(null); this.clearHints();
    const timings = this.timings;
    if (frame.kind === 'clear') {
      const cells = [...new Set(frame.cells ?? [])].filter(i => previous.board[i]);
      const spawns = this.beginSpecialCreation(frame, previous);
      const visualCells = [...new Set([...cells, ...spawns])];
      const tier = getClearTier(cells.length);
      const fading = visualCells.map(i => this.views.get(previous.board[i]!.id)).filter(Boolean);
      // Selection, gathering, burst and refill are separate readable beats.
      // Gentle keeps the highlight and the pause, while omitting scale motion.
      this.showHint(visualCells, false);
      if (fading.length && !this.reducedMotion) await this.tween({ targets: fading, scale: 1.07 + tier * .015, duration: timings.anticipation, ease: 'Sine.easeInOut' });
      else await this.delay(timings.anticipation);
      this.clearHints();
      const fx = this.clearFx!.play(frame, previous, this.reducedMotion, this.animationSpeed);
      this.onClear(frame, tier, cells.length);
      this.clearScoreLabels();
      const positions = cells.map(center);
      const midpoint = positions.length ? { x: positions.reduce((sum, p) => sum + p.x, 0) / positions.length, y: positions.reduce((sum, p) => sum + p.y, 0) / positions.length } : center(27);
      const x = Phaser.Math.Clamp(midpoint.x, 85, CANVAS_WIDTH - 85), y = Phaser.Math.Clamp(midpoint.y, 92, CANVAS_HEIGHT - 48);
      const label = this.add.text(x, y, `+${frame.points ?? cells.length * 10}`, { fontFamily: 'Georgia', fontSize: `${34 + tier * 7}px`, fontStyle: 'bold', color: tier >= 2 ? '#fff2c4' : '#fff8e4', stroke: '#193123', strokeThickness: 6, shadow: { color: '#d7ab4a', blur: tier * 5, fill: true } }).setOrigin(.5).setDepth(60).setName('clear-score');
      this.scoreLabels.add(label);
      this.tween({ targets: label, y: this.reducedMotion ? y : y - 40 - tier * 6, alpha: 0, duration: Math.max(timings.score, fx.duration + paceDuration(220)), ease: 'Sine.easeIn' }).then(() => { this.scoreLabels.delete(label); label.destroy(); });
      await Promise.all([
        fading.length ? this.tween({ targets: fading, scale: this.reducedMotion ? 1 : .12, alpha: 0, duration: timings.gemFade[tier], ease: 'Sine.easeIn' }) : Promise.resolve(),
        this.delay(fx.duration),
      ]);
      if (spawns.length) await this.revealSpecials(frame.state, spawns);
      else {
        await this.renderState(frame.state);
        await this.delay(timings.settle);
      }
    } else if (frame.kind === 'skill' || frame.kind === 'combine') {
      const spawns = this.beginSpecialCreation(frame, previous);
      const character = frame.skillCharacter ?? frame.state.character;
      const color = frame.kind === 'combine' ? 0xffdda0 : ({ beth: 0xe2c3ff, lance: 0x9bdcff, chris: 0xffb1ba, ian: 0xffdda0 } as Record<string, number>)[character] ?? 0xffe4a1;
      this.showHint(frame.cells ?? [], false, color, true);
      const affected = (frame.cells ?? []).map(i => previous.board[i]).filter(Boolean).map(tile => this.views.get(tile!.id)).filter(Boolean);
      if (affected.length && !this.reducedMotion) await this.tween({ targets: affected, scale: 1.055, duration: timings.anticipation, ease: 'Sine.easeInOut' });
      else await this.delay(timings.anticipation);
      if (spawns.length) {
        // Skill-created specials use the same consume → empty → form sequence,
        // without pretending the transformation awards clear points or energy.
        this.clearHints();
        const fx = this.clearFx!.play({ ...frame, cells: [] }, previous, this.reducedMotion, this.animationSpeed);
        await Promise.all([
          this.tween({ targets: affected, scale: this.reducedMotion ? 1 : .12, alpha: 0, duration: timings.gemFade[0], ease: 'Sine.easeIn' }),
          this.delay(fx.duration),
        ]);
        await this.revealSpecials(frame.state, spawns);
      } else {
        await this.renderState(frame.state, true, 'skill');
        await this.delay(Math.max(0, timings.skill - timings.anticipation - timings.skillTransform));
      }
      this.clearHints();
    } else if (frame.kind === 'shuffle') {
      await this.tween({ targets: [...this.views.values()], alpha: .1, duration: timings.shuffle });
      await this.renderState(frame.state, true);
    } else if (frame.kind !== 'end') await this.renderState(frame.state, true, frame.kind);
  }
  delay(ms: number) { return new Promise<void>(resolve => this.time.delayedCall(ms, () => resolve())); }
  showHint(cells: number[], pulsing = true, color = 0xffe4a1, filled = false) {
    this.clearHints();
    cells.forEach(i => {
      const { x, y } = center(i);
      const mark = this.add.graphics().setDepth(8);
      mark.lineStyle(3, color, 1).strokeRoundedRect(x - 41, y - 41, 82, 82, 10);
      if (filled) {
        mark.fillStyle(color, .12).fillRoundedRect(x - 39, y - 39, 78, 78, 9);
        mark.lineStyle(1, 0xfff0cf, .65).strokeRoundedRect(x - 36, y - 36, 72, 72, 7);
      }
      this.hintMarks.push(mark);
      if (pulsing && !this.reducedMotion) this.tweens.add({ targets: mark, alpha: .25, duration: paceDuration(450), yoyo: true, repeat: 3 });
    });
  }
  clearHints() { this.hintMarks.forEach(g => { this.tweens.killTweensOf(g); g.destroy(); }); this.hintMarks = []; }
}

export function createBoard(scene: BoardScene) {
  return new Phaser.Game({ type: Phaser.AUTO, parent: 'board-canvas', width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transparent: true, antialias: true, scene: [scene], scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH }, audio: { noAudio: true }, banner: false });
}
