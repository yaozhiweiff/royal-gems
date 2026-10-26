import Phaser from 'phaser';
import { COLS, ROWS, type Frame, type State } from './engine';
import { animationTimings, paceDuration, type AnimationSpeed, type MotionMode } from './motion';
import type { Combination, CombinationKind } from './combinations';
import { BoardLayout, CELL_SIZE as SIZE, BOARD_PAD as PAD } from './board-layout';

const GOLD = 0xf5d797, IVORY = 0xfff3d3;
const COLORS = [0xff796c, 0x8ce7ff, 0xb5ed82, 0xe4a5ff, 0xffdb72];
const TEXTURES = { glow: 'clear-fx-glow', star: 'clear-fx-star', shard: 'clear-fx-shard' };
const MAX_OBJECTS = 440, MAX_PARTICLES = 270;
type Point = { x: number; y: number };
type EffectObject = Phaser.GameObjects.Image | Phaser.GameObjects.Graphics;
type EffectStats = {
  serial: number; tier: number; count: number; activeObjects: number;
  peakObjects: number; reducedMotion: boolean; duration: number;
  mode: MotionMode; speed: AnimationSpeed;
  combination?: CombinationKind;
};
const quadratic = (start: Point, bend: Point, end: Point, t: number): Point => ({
  x: (1 - t) ** 2 * start.x + 2 * (1 - t) * t * bend.x + t * t * end.x,
  y: (1 - t) ** 2 * start.y + 2 * (1 - t) * t * bend.y + t * t * end.y,
});

/** Intensity follows the number actually removed in this clear, never the combo label. */
export function getClearTier(count: number): 0 | 1 | 2 | 3 {
  return count >= 24 ? 3 : count >= 12 ? 2 : count >= 6 ? 1 : 0;
}

/** Disposable, view-only effects. Does not read or write input, scoring or the simulation. */
export class ClearEffects {
  private layer: Phaser.GameObjects.Container | null = null;
  private objects = new Set<EffectObject>();
  private tweens = new Set<Phaser.Tweens.Tween>();
  private cleanup: Phaser.Time.TimerEvent | null = null;
  private last: Omit<EffectStats, 'activeObjects'> = {
    serial: 0, tier: 0, count: 0, peakObjects: 0, reducedMotion: false, duration: 0, mode: 'full', speed: 'normal',
  };

  constructor(private readonly scene: Phaser.Scene, private readonly layout: BoardLayout) {}

  get stats(): Readonly<EffectStats> {
    return { ...this.last, activeObjects: this.objects.size + (this.layer ? 1 : 0) };
  }

  play(frame: Frame, previous: State, reducedMotion: boolean, speed: AnimationSpeed = 'normal'): { duration: number; tier: number; count: number } {
    // Successive cascades never inherit old particles or timers.
    this.dispose();
    const removed = [...new Set(frame.cells ?? [])].filter(i => Number.isInteger(i) && i >= 0 && i < COLS * ROWS && previous.board[i]);
    // The old gem at a spawn location dissolves with the match. Keep feedback
    // counts tied to scored removals; a transformation never adds score/energy.
    const cells = [...new Set([...removed, ...(frame.spawns ?? [])])].filter(i => Number.isInteger(i) && i >= 0 && i < COLS * ROWS && previous.board[i]);
    const count = removed.length, tier = getClearTier(count);
    const mode: MotionMode = reducedMotion ? 'gentle' : 'full';
    const duration = cells.length ? animationTimings(mode, speed).clear[tier] : 0;
    this.last = { serial: this.last.serial + 1, tier, count, duration, reducedMotion, mode, speed, peakObjects: 0, combination: frame.combination?.kind };
    if (!cells.length) return { duration, tier, count };
    this.layer = this.scene.add.container(0, 0).setName('clear-effects-layer').setDepth(16);
    this.last.peakObjects = 1;

    if (reducedMotion) {
      const marks = this.graphics('fx-reduced-clear');
      if (marks) {
        cells.forEach(i => {
          const p = this.layout.center(i), tile = previous.board[i]!;
          const color = tile.special === 'ultimate' ? GOLD : COLORS[tile.color] ?? GOLD;
          marks.fillStyle(color, .16).fillRoundedRect(p.x - 39, p.y - 39, 78, 78, 9);
          marks.fillStyle(color, .12).fillCircle(p.x, p.y, 29);
          marks.lineStyle(2.5, color, .95).strokeRoundedRect(p.x - 39, p.y - 39, 78, 78, 9);
          marks.lineStyle(1, IVORY, .65).strokeRoundedRect(p.x - 35, p.y - 35, 70, 70, 7);
        });
        this.animate(marks, { alpha: 0, duration, ease: 'Sine.easeIn' });
      }
    } else {
      this.prepareTextures();
      const points = cells.map(this.layout.center);
      const origin = { x: points.reduce((sum, p) => sum + p.x, 0) / cells.length, y: points.reduce((sum, p) => sum + p.y, 0) / cells.length };
      const cleared = new Set(cells);
      const isConversion = frame.kind === 'combine';
      const mergedPair: readonly number[] = frame.combination && !frame.combination.kind.startsWith('ultimate') ? frame.combination.pair : [];
      const sources = previous.board.flatMap((tile, i) => !isConversion && !mergedPair.includes(i) && tile && tile.special !== 'normal' &&
        (cleared.has(i) || frame.state.board[i]?.id !== tile.id) ? [i] : []);
      const ultimates = sources.filter(i => previous.board[i]!.special === 'ultimate');
      const fullBoardUltimate = ultimates.length >= 2 && count === COLS * ROWS;

      // Macro effects go behind the individual fragments, preserving the cell silhouettes.
      this.wave(origin, tier, duration, fullBoardUltimate);
      if (frame.kind === 'clear' && frame.combination) this.combinationBlast(frame.combination, duration);
      sources.filter(i => previous.board[i]!.special === 'bomb').slice(0, 6).forEach(i => this.bomb(this.layout.center(i), duration));
      sources.filter(i => previous.board[i]!.special === 'cross').slice(0, 5).forEach(i => this.cross(this.layout.center(i), duration));
      if (ultimates.length) this.ultimate(ultimates.slice(0, 2).map(this.layout.center), cells, previous, duration, fullBoardUltimate);
      if (isConversion && frame.combination) {
        const source = frame.combination.pair.find(i => previous.board[i]?.special === 'ultimate');
        if (source !== undefined) this.ultimate([this.layout.center(source)], cells, previous, duration, false);
      }

      const requested = Math.min(MAX_PARTICLES, cells.length * [4, 5, 6, 7][tier]);
      const perCell = Math.floor(requested / cells.length), remainder = requested % cells.length;
      const comboBoost = Math.min(3, Math.max(0, (frame.combo ?? 1) - 1));
      cells.forEach((cell, order) => {
        const p = this.layout.center(cell), tile = previous.board[cell]!;
        const color = tile.special === 'ultimate' ? GOLD : COLORS[tile.color] ?? GOLD;
        const delay = paceDuration(tier ? Math.min(48, Math.hypot(p.x - origin.x, p.y - origin.y) / 9) : order * 9);
        this.cellBurst(p, color, tier, duration, delay, order);
        const fragments = perCell + (order < remainder ? 1 : 0);
        for (let k = 0; k < fragments; k++) {
          const angle = k / fragments * Math.PI * 2 + cell * 1.73 + order * .21;
          const distance = [38, 57, 82, 108][tier] * (.72 + (k % 3) * .16) + comboBoost * 3;
          const particle = this.image(k % 3 === 0 ? TEXTURES.star : TEXTURES.shard, p.x, p.y, 'fx-fragment');
          if (!particle) break;
          const scale = k % 3 === 0 ? .27 + tier * .034 : .32 + tier * .035;
          particle.setTint(k % 4 === 0 ? IVORY : color).setScale(scale).setAlpha(1).setRotation(angle);
          particle.setPosition(p.x + Math.cos(angle) * 9, p.y + Math.sin(angle) * 9);
          this.animate(particle, {
            x: p.x + Math.cos(angle) * distance,
            y: p.y + Math.sin(angle) * distance + tier * 6,
            rotation: angle + (k % 2 ? 1 : -1) * 1.25,
            scale: { value: .055, ease: 'Sine.easeIn' },
            alpha: { value: 0, ease: 'Sine.easeIn' }, delay,
            duration: duration - paceDuration(15) + paceDuration((k % 3) * 18), ease: 'Cubic.easeOut',
          });
        }
      });
    }

    // A hard lifetime ceiling also covers effects interrupted by a render/reset.
    this.cleanup = this.scene.time.delayedCall(duration + 120, () => {
      this.cleanup = null;
      this.dispose();
    });
    return { duration, tier, count };
  }

  dispose() {
    this.cleanup?.remove(false); this.cleanup = null;
    this.tweens.forEach(tween => { tween.stop(); tween.remove(); });
    this.tweens.clear();
    this.objects.forEach(object => object.destroy());
    this.objects.clear();
    this.layer?.destroy(); this.layer = null;
  }

  private adopt<T extends EffectObject>(object: T, name: string): T | null {
    if (!this.layer || this.objects.size + 1 >= MAX_OBJECTS) { object.destroy(); return null; }
    // Phaser 3's ADD uses DST_ALPHA for the destination factor. On this
    // transparent canvas, repeated additive strokes darken the board underneath.
    // Normal premultiplied-alpha blending preserves both the board and soft glows.
    object.setName(name).setBlendMode(Phaser.BlendModes.NORMAL);
    this.layer.add(object); this.objects.add(object);
    this.last.peakObjects = Math.max(this.last.peakObjects, this.objects.size + 1);
    return object;
  }
  private image(texture: string, x: number, y: number, name: string) {
    return this.adopt(this.scene.add.image(x, y, texture), name);
  }
  private graphics(name: string) { return this.adopt(this.scene.add.graphics(), name); }
  private animate(object: EffectObject, config: Omit<Phaser.Types.Tweens.TweenBuilderConfig, 'targets'>) {
    const tween = this.scene.tweens.add({
      ...config, targets: object,
      onComplete: () => { this.tweens.delete(tween); this.objects.delete(object); object.destroy(); },
    });
    this.tweens.add(tween);
  }

  private cellBurst(p: Point, color: number, tier: number, duration: number, delay: number, order: number) {
    const halo = this.image(TEXTURES.glow, p.x, p.y, 'fx-cell-halo');
    if (halo) {
      halo.setTint(color).setScale(.55 + tier * .07).setAlpha(tier === 3 ? .52 : .67);
      this.animate(halo, { scale: 1.05 + tier * .15, alpha: 0, duration: duration * .84, delay, ease: 'Sine.easeOut' });
    }
    const star = this.image(TEXTURES.star, p.x, p.y, 'fx-cell-star');
    if (star) {
      star.setTint(IVORY).setScale(.62 + tier * .07).setAlpha(1).setRotation(Math.PI / 8);
      this.animate(star, {
        scale: { value: .08, ease: 'Sine.easeIn' }, rotation: Math.PI / 3,
        alpha: { value: 0, ease: 'Sine.easeIn' }, duration: duration * .82, delay, ease: 'Sine.easeOut',
      });
    }
    if (tier > 0 && order % (tier === 3 ? 5 : 2) === 0) {
      this.ring(p, 20, color, .55, 1.8 + tier * .4, duration * .78, delay, 'fx-cell-ring');
    }
  }

  private ring(p: Point, radius: number, color: number, alpha: number, scale: number, duration: number, delay = 0, name = 'fx-wave-ring') {
    const ring = this.graphics(name) as (Phaser.GameObjects.Graphics & { travel: number }) | null;
    if (!ring) return;
    ring.setPosition(p.x, p.y).setAlpha(alpha);
    ring.travel = 0;
    const draw = () => {
      const r = radius * (1 + (scale - 1) * ring.travel);
      ring.clear();
      // Redraw the radius instead of scaling the Graphics: expanding ripples
      // keep their fine luminous outline rather than becoming thick bands.
      ring.lineStyle(3.2, color, .2).strokeCircle(0, 0, r);
      ring.lineStyle(1.25, color, 1).strokeCircle(0, 0, r);
      ring.lineStyle(.65, IVORY, .6).strokeCircle(0, 0, r - 3);
    };
    draw();
    this.animate(ring, {
      travel: 1, alpha: { value: 0, ease: 'Sine.easeIn' }, duration, delay,
      ease: 'Cubic.easeOut', onUpdate: draw,
    });
  }

  private wave(origin: Point, tier: number, duration: number, fullBoard: boolean) {
    if (!tier) return;
    const p = fullBoard ? { x: this.layout.width / 2, y: this.layout.height / 2 } : origin;
    this.ring(p, 40, GOLD, tier === 1 ? .58 : .78, [0, 2.6, 5.3, 9.5][tier], duration, 0);
    if (tier >= 2) {
      this.ring(p, 37, GOLD, .5, tier === 2 ? 4.4 : 8.4, duration - paceDuration(30), paceDuration(55), 'fx-wave-echo');
      const halo = this.image(TEXTURES.glow, p.x, p.y, 'fx-wave-glow');
      if (halo) {
        halo.setTint(GOLD).setAlpha(tier === 2 ? .11 : .15).setScale(1.4);
        this.animate(halo, { scale: tier === 2 ? 3.2 : 5.6, alpha: 0, duration: duration * .9, ease: 'Sine.easeOut' });
      }
    }
    if (tier === 3) {
      for (let k = 0; k < 12; k++) {
        const angle = Math.PI * 2 * k / 12;
        const ray = this.graphics('fx-grand-ray');
        if (!ray) break;
        ray.setPosition(p.x, p.y).setRotation(angle).setAlpha(.66);
        ray.lineStyle(1.3, GOLD, .82).lineBetween(48, 0, 110 + k % 3 * 16, 0);
        ray.lineStyle(3, GOLD, .13).lineBetween(50, 0, 108 + k % 3 * 16, 0);
        this.animate(ray, { scaleX: 2.9, alpha: { value: 0, ease: 'Sine.easeIn' }, duration: duration * .88, ease: 'Cubic.easeOut' });
      }
    }
  }

  private combinationBlast(combination: Combination, duration: number) {
    const p = this.layout.center(combination.origin), row = Math.floor(combination.origin / COLS), column = combination.origin % COLS;
    if (combination.kind === 'bomb-bomb') {
      const area = this.graphics('fx-combination-bomb-5x5');
      if (area) {
        const left = Math.max(PAD, p.x - SIZE * 2.5), right = Math.min(this.layout.width - PAD, p.x + SIZE * 2.5);
        const top = Math.max(PAD, p.y - this.layout.rowHeight * 2.5), bottom = Math.min(this.layout.height - PAD, p.y + this.layout.rowHeight * 2.5);
        area.lineStyle(3, GOLD, .9).strokeRoundedRect(left + 4, top + 4, right - left - 8, bottom - top - 8, 14);
        area.fillStyle(GOLD, .055).fillRoundedRect(left + 4, top + 4, right - left - 8, bottom - top - 8, 14);
        this.animate(area, { alpha: 0, duration });
      }
      this.ring(p, 38, IVORY, .9, 6.3, duration, 0, 'fx-combination-bomb-wave');
    } else if (combination.kind === 'bomb-cross') {
      for (let offset = -1; offset <= 1; offset++) {
        if (row + offset >= 0 && row + offset < ROWS) this.combinationBeam({ x: PAD, y: p.y + offset * this.layout.rowHeight }, { x: this.layout.width - PAD, y: p.y + offset * this.layout.rowHeight }, duration);
        if (column + offset >= 0 && column + offset < COLS) this.combinationBeam({ x: p.x + offset * SIZE, y: PAD }, { x: p.x + offset * SIZE, y: this.layout.height - PAD }, duration);
      }
    } else if (combination.kind === 'cross-cross') {
      for (const [dr, dc] of [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]]) {
        let r = row, c = column;
        while (r + dr >= 0 && r + dr < ROWS && c + dc >= 0 && c + dc < COLS) { r += dr; c += dc; }
        const last = this.layout.center(r * COLS + c);
        this.combinationBeam(p, { x: last.x + dc * SIZE * .4, y: last.y + dr * this.layout.rowHeight * .4 }, duration);
      }
    }
  }
  private combinationBeam(start: Point, end: Point, duration: number) {
    const beam = this.graphics('fx-combination-beam');
    if (!beam) return;
    beam.lineStyle(23, GOLD, .1).lineBetween(start.x, start.y, end.x, end.y);
    beam.lineStyle(7, GOLD, .45).lineBetween(start.x, start.y, end.x, end.y);
    beam.lineStyle(2.3, IVORY, 1).lineBetween(start.x, start.y, end.x, end.y);
    this.animate(beam, { alpha: 0, duration: duration * .95, ease: 'Sine.easeIn' });
  }

  private bomb(p: Point, duration: number) {
    const area = this.graphics('fx-bomb-area');
    if (area) {
      area.setPosition(p.x, p.y).setAlpha(.65);
      area.lineStyle(1.5, GOLD, .65).strokeRoundedRect(-SIZE * 1.5 + 5, -this.layout.rowHeight * 1.5 + 5, SIZE * 3 - 10, this.layout.rowHeight * 3 - 10, 16);
      area.fillStyle(GOLD, .035).fillRoundedRect(-SIZE * 1.5 + 5, -this.layout.rowHeight * 1.5 + 5, SIZE * 3 - 10, this.layout.rowHeight * 3 - 10, 16);
      this.animate(area, { alpha: 0, duration: duration * .88, ease: 'Sine.easeIn' });
    }
    this.ring(p, 32, GOLD, .8, 4.1, duration * .9, 0, 'fx-bomb-shockwave');
    this.ring(p, 26, IVORY, .48, 4.4, duration * .78, paceDuration(45), 'fx-bomb-echo');
  }

  private cross(p: Point, duration: number) {
    (['horizontal', 'vertical'] as const).forEach(axis => {
      const beam = this.graphics(`fx-cross-${axis}`);
      if (!beam) return;
      const horizontal = axis === 'horizontal';
      const start = horizontal ? { x: PAD - p.x, y: 0 } : { x: 0, y: PAD - p.y };
      const end = horizontal ? { x: this.layout.width - PAD - p.x, y: 0 } : { x: 0, y: this.layout.height - PAD - p.y };
      beam.setPosition(p.x, p.y).setAlpha(.95);
      beam.lineStyle(20, GOLD, .09).lineBetween(start.x, start.y, end.x, end.y);
      beam.lineStyle(7, GOLD, .4).lineBetween(start.x, start.y, end.x, end.y);
      beam.lineStyle(2.2, IVORY, 1).lineBetween(start.x, start.y, end.x, end.y);
      beam.setScale(horizontal ? .05 : 1, horizontal ? 1 : .05);
      this.animate(beam, { scaleX: 1, scaleY: 1, alpha: { value: 0, ease: 'Sine.easeIn' }, duration: duration * .92, ease: 'Cubic.easeOut' });
    });
  }

  private ultimate(sources: Point[], cells: number[], previous: State, duration: number, fullBoard: boolean) {
    const arcs = this.graphics('fx-ultimate-arcs');
    if (!arcs) return;
    arcs.setAlpha(fullBoard ? .6 : .78);
    const stride = Math.max(1, Math.ceil(cells.length / (fullBoard ? 24 : 20)));
    let cometCount = 0;
    cells.filter((_, n) => n % stride === 0).forEach((cell, index) => {
      const start = sources[index % sources.length], end = this.layout.center(cell);
      const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
      if (length < 10) return;
      const color = COLORS[previous.board[cell]!.color] ?? GOLD;
      const direction = index % 2 ? 1 : -1;
      const bend = { x: (start.x + end.x) / 2 - dy / length * 33 * direction, y: (start.y + end.y) / 2 + dx / length * 33 * direction };
      const points = Array.from({ length: 17 }, (_, n) => quadratic(start, bend, end, n / 16));
      arcs.lineStyle(4, color, .15).strokePoints(points);
      arcs.lineStyle(1.4, color, .85).strokePoints(points);
      if (cometCount >= 10 || index % 2) return;
      cometCount++;
      const comet = this.image(TEXTURES.star, start.x, start.y, 'fx-ultimate-comet') as (Phaser.GameObjects.Image & { flight: number }) | null;
      if (!comet) return;
      comet.flight = 0; comet.setTint(color).setScale(.35).setAlpha(1);
      this.animate(comet, {
        flight: 1, alpha: { value: 0, ease: 'Sine.easeIn' }, duration: duration * .8, delay: paceDuration(index * 3),
        ease: 'Sine.easeInOut',
        onUpdate: () => { const p = quadratic(start, bend, end, comet.flight); comet.setPosition(p.x, p.y); },
      });
    });
    this.animate(arcs, { alpha: 0, duration: duration * .95, ease: 'Sine.easeIn' });
    sources.forEach(p => this.ring(p, 25, IVORY, .8, fullBoard ? 5.5 : 3.5, duration * .9, 0, 'fx-ultimate-origin'));
    if (fullBoard) {
      const p = { x: this.layout.width / 2, y: this.layout.height / 2 };
      COLORS.forEach((color, index) => this.ring(p, 45 + index * 5, color, .55, 8 - index * .45, duration - paceDuration(index * 15), paceDuration(index * 22), 'fx-ultimate-rainbow-wave'));
    }
  }

  private prepareTextures() {
    if (!this.scene.textures.exists(TEXTURES.glow)) {
      const texture = this.scene.textures.createCanvas(TEXTURES.glow, 128, 128);
      if (texture) {
        const context = texture.context;
        const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
        gradient.addColorStop(0, 'rgba(255,255,255,0.94)');
        gradient.addColorStop(.14, 'rgba(255,255,255,0.62)');
        gradient.addColorStop(.4, 'rgba(255,255,255,0.18)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient; context.fillRect(0, 0, 128, 128); texture.refresh();
      }
    }
    if (!this.scene.textures.exists(TEXTURES.star)) {
      const texture = this.scene.textures.createCanvas(TEXTURES.star, 64, 64);
      if (texture) {
        const context = texture.context;
        context.translate(32, 32);
        const points = [[0, -30], [4, -5], [30, 0], [4, 5], [0, 30], [-4, 5], [-30, 0], [-4, -5]];
        context.beginPath(); points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath();
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 30);
        gradient.addColorStop(0, '#ffffff'); gradient.addColorStop(.3, 'rgba(255,255,255,.96)'); gradient.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = gradient; context.fill(); texture.refresh();
      }
    }
    if (!this.scene.textures.exists(TEXTURES.shard)) {
      const texture = this.scene.textures.createCanvas(TEXTURES.shard, 64, 64);
      if (texture) {
        const context = texture.context;
        context.beginPath(); context.moveTo(31, 5); context.lineTo(47, 28); context.lineTo(30, 59); context.lineTo(17, 31); context.closePath();
        context.fillStyle = '#cdd5df'; context.fill();
        context.beginPath(); context.moveTo(31, 5); context.lineTo(32, 31); context.lineTo(17, 31); context.closePath(); context.fillStyle = '#ffffff'; context.fill();
        context.beginPath(); context.moveTo(31, 5); context.lineTo(47, 28); context.lineTo(32, 31); context.closePath(); context.fillStyle = '#edf2ff'; context.fill();
        context.beginPath(); context.moveTo(32, 31); context.lineTo(47, 28); context.lineTo(30, 59); context.closePath(); context.fillStyle = '#a9b3c5'; context.fill();
        texture.refresh();
      }
    }
  }
}
