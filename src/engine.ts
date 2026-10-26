import { SKILLS, type CharacterId } from './skills';
import { combinationKind, type Combination } from './combinations';

export const COLS = 8;
export const ROWS = 7;
export const COLORS = 5;
export type Special = 'normal' | 'bomb' | 'cross' | 'ultimate';
export type Tile = { id: number; color: number; special: Special };
export type Board = (Tile | null)[];
export type Difficulty = 'easy' | 'hard' | 'challenge';
export const LEVELS = {
  easy: { name: '简单', turns: 20, target: 2500 },
  hard: { name: '困难', turns: 30, target: 10000 },
  challenge: { name: '挑战', turns: 30, target: null },
};
export type State = { board: Board; score: number; turns: number; moves: number; energy: number; firstFired: boolean; status: 'ready' | 'playing' | 'won' | 'lost' | 'completed'; difficulty: Difficulty; character: CharacterId };
export type Frame = { kind: 'swap' | 'invalid' | 'clear' | 'drop' | 'skill' | 'combine' | 'shuffle' | 'end'; state: State; cells?: number[]; spawns?: number[]; pair?: number[]; points?: number; combo?: number; combination?: Combination; skill?: 1 | 2; special?: Special[]; skillCharacter?: CharacterId; skillName?: string };
export type Match = { cells: number[]; special: Special; spawn: number };

export function seededRandom(seed: number) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const adjacent = (a: number, b: number) => a >= 0 && b >= 0 && a < COLS * ROWS && b < COLS * ROWS && Math.abs(a % COLS - b % COLS) + Math.abs(Math.floor(a / COLS) - Math.floor(b / COLS)) === 1;
const matchesColor = (a: Tile | null, b: Tile | null) => !!a && !!b && a.special !== 'ultimate' && b.special !== 'ultimate' && a.color === b.color;

export function findMatches(board: Board, preferred: number[] = []): Match[] {
  const runs: { cells: number[]; axis: number }[] = [];
  for (let axis = 0; axis < 2; axis++) {
    const lines = axis === 0 ? ROWS : COLS;
    const length = axis === 0 ? COLS : ROWS;
    for (let line = 0; line < lines; line++) {
      const index = (v: number) => axis === 0 ? line * COLS + v : v * COLS + line;
      let start = 0;
      for (let v = 1; v <= length; v++) {
        if (v < length && matchesColor(board[index(start)], board[index(v)])) continue;
        if (v - start >= 3 && board[index(start)]?.special !== 'ultimate') runs.push({ cells: Array.from({ length: v - start }, (_, n) => index(start + n)), axis });
        start = v;
      }
    }
  }
  const groups: typeof runs[] = [];
  for (const run of runs) {
    const joined = groups.filter(group => group.some(r => r.cells.some(c => run.cells.includes(c))));
    if (!joined.length) groups.push([run]);
    else {
      const merged = [run, ...joined.flat()];
      joined.forEach(g => groups.splice(groups.indexOf(g), 1));
      groups.push(merged);
    }
  }
  return groups.map(group => {
    const cells = [...new Set(group.flatMap(r => r.cells))];
    const longest = Math.max(...group.map(r => r.cells.length));
    const intersection = cells.find(c => group.filter(r => r.cells.includes(c)).length > 1);
    const special: Special = longest >= 5 ? 'ultimate' : intersection !== undefined ? 'cross' : longest === 4 ? 'bomb' : 'normal';
    const spawn = preferred.find(c => cells.includes(c)) ?? intersection ?? cells[Math.floor(cells.length / 2)];
    return { cells, special, spawn };
  });
}

export function findMove(board: Board): [number, number] | null {
  for (let a = 0; a < board.length; a++) {
    for (const b of [a + 1, a + COLS]) {
      if (!adjacent(a, b) || !board[a] || !board[b]) continue;
      if (board[a]!.special === 'ultimate' || board[b]!.special === 'ultimate' || combinationKind(board[a]!.special, board[b]!.special)) return [a, b];
      [board[a], board[b]] = [board[b], board[a]];
      const valid = findMatches(board).some(m => m.cells.includes(a) || m.cells.includes(b));
      [board[a], board[b]] = [board[b], board[a]];
      if (valid) return [a, b];
    }
  }
  return null;
}

export class GameEngine {
  state: State;
  private nextId = 0;
  private random: () => number;
  constructor(difficulty: Difficulty = 'easy', random = Math.random, character: CharacterId = 'beth') {
    this.random = random;
    this.state = { board: [], score: 0, turns: LEVELS[difficulty].turns, moves: 0, energy: 0, firstFired: false, status: 'ready', difficulty, character };
    this.state.board = this.makeBoard();
  }
  tile(color = Math.floor(this.random() * COLORS), special: Special = 'normal'): Tile { return { id: ++this.nextId, color, special }; }
  snapshot(): State { return { ...this.state, board: this.state.board.map(t => t ? { ...t } : null) }; }
  start() { this.state.status = 'playing'; }
  private frame(kind: Frame['kind'], extra: Partial<Frame> = {}): Frame { return { kind, state: this.snapshot(), ...extra }; }
  private makeBoard(): Board {
    // Construct without matches. A finite fallback prevents a pathological RNG from hanging.
    for (let attempt = 0; attempt < 100; attempt++) {
      const board: Board = [];
      for (let i = 0; i < ROWS * COLS; i++) {
        let color = Math.floor(this.random() * COLORS);
        while ((i % COLS >= 2 && board[i - 1]?.color === color && board[i - 2]?.color === color) || (i >= COLS * 2 && board[i - COLS]?.color === color && board[i - COLS * 2]?.color === color)) color = (color + 1) % COLORS;
        board.push(this.tile(color));
      }
      if (findMove(board)) return board;
    }
    const board = Array.from({ length: ROWS * COLS }, (_, i) => this.tile((i % COLS + Math.floor(i / COLS)) % COLORS));
    [0, 2, 9].forEach(i => board[i] = this.tile(3));
    board[1] = this.tile(4);
    return board;
  }
  private counts(): number[] {
    const counts = Array(COLORS).fill(0) as number[];
    this.state.board.forEach(t => { if (t && t.special !== 'ultimate') counts[t.color]++; });
    return counts;
  }
  private clear(matches: Match[], forced: number[], combo: number, frames: Frame[], suppressedSpecials: number[] = [], combination?: Combination) {
    const board = this.state.board;
    const removed = new Set(forced);
    matches.forEach(m => m.cells.forEach(i => removed.add(i)));
    const specials: Special[] = [];
    const activated = new Set<number>();
    // Effects recursively activate other special pieces, with each piece counted once.
    while ([...removed].some(i => board[i] && !activated.has(i))) {
      for (const i of [...removed]) {
        if (activated.has(i) || !board[i]) continue;
        activated.add(i);
        const tile = board[i]!;
        const r = Math.floor(i / COLS), c = i % COLS;
        if (tile.special !== 'normal') specials.push(tile.special);
        // A combined pair uses its joint shape, rather than adding another
        // independent row/column from the second source. Other hits still chain.
        if (suppressedSpecials.includes(i)) continue;
        if (tile.special === 'bomb') {
          for (let y = Math.max(0, r - 1); y <= Math.min(ROWS - 1, r + 1); y++) for (let x = Math.max(0, c - 1); x <= Math.min(COLS - 1, c + 1); x++) removed.add(y * COLS + x);
        } else if (tile.special === 'cross') {
          for (let y = 0; y < ROWS; y++) removed.add(y * COLS + c);
          for (let x = 0; x < COLS; x++) removed.add(r * COLS + x);
        } else if (tile.special === 'ultimate') {
          const counts = this.counts();
          const target = counts.indexOf(Math.max(...counts));
          board.forEach((t, n) => { if (t?.color === target) removed.add(n); });
        }
      }
    }
    const spawned: { index: number; tile: Tile }[] = [];
    matches.forEach(m => {
      if (m.special !== 'normal') {
        const old = board[m.spawn]!;
        spawned.push({ index: m.spawn, tile: this.tile(old.color, m.special) });
        removed.delete(m.spawn);
      }
    });
    const cells = [...removed].filter(i => board[i]);
    cells.forEach(i => board[i] = null);
    spawned.forEach(s => board[s.index] = s.tile);
    const points = cells.length * 10;
    this.state.score += points;
    this.state.energy += cells.length * 2;
    // Spawn locations also consume their old visual, but are not scored twice.
    frames.push(this.frame('clear', { cells, spawns: spawned.map(s => s.index), points, combo, special: specials, combination }));
    this.drop();
    frames.push(this.frame('drop', { combo }));
  }
  private drop() {
    const board = this.state.board;
    for (let c = 0; c < COLS; c++) {
      const tiles: Tile[] = [];
      for (let r = ROWS - 1; r >= 0; r--) { const tile = board[r * COLS + c]; if (tile) tiles.push(tile); }
      for (let r = ROWS - 1; r >= 0; r--) board[r * COLS + c] = tiles[ROWS - 1 - r] ?? this.tile();
    }
  }
  private settle(frames: Frame[], preferred: number[] = [], startingCombo = 0) {
    let combo = startingCombo;
    for (let i = 0; i < 100; i++) {
      const matches = findMatches(this.state.board, preferred);
      if (!matches.length) return;
      this.clear(matches, [], ++combo, frames);
      preferred = [];
    }
    this.state.board = this.makeBoard();
    frames.push(this.frame('shuffle'));
  }
  private cast(skill: 1 | 2, frames: Frame[]) {
    const board = this.state.board;
    const cells: number[] = [];
    const spawns: number[] = [];
    const character = this.state.character;
    let directClear = false;
    // Mark the cycle before resolving effects: any earned energy belongs to the next cycle.
    if (skill === 1) this.state.firstFired = true;
    else { this.state.energy = 0; this.state.firstFired = false; }

    const upgradeOrdinary = (count: number, special: Special) => {
      const eligible = board.flatMap((tile, i) => tile?.special === 'normal' ? [i] : []);
      // Sample without replacement. A sparse or all-special board needs no retry loop.
      for (let n = 0; n < count && eligible.length; n++) {
        const [index] = eligible.splice(Math.floor(this.random() * eligible.length), 1);
        board[index] = this.tile(board[index]!.color, special);
        cells.push(index);
        spawns.push(index);
      }
    };

    if (character === 'lance') {
      if (skill === 1) upgradeOrdinary(2, 'cross');
      else {
        const firstRow = Math.floor(this.random() * (ROWS - 1));
        for (let r = firstRow; r < firstRow + 2; r++) for (let c = 0; c < COLS; c++) cells.push(r * COLS + c);
        directClear = true;
      }
    } else if (character === 'chris') {
      if (skill === 1) upgradeOrdinary(2, 'bomb');
      else {
        const top = Math.floor(this.random() * (ROWS - 4));
        const left = Math.floor(this.random() * (COLS - 4));
        for (let r = top; r < top + 5; r++) for (let c = left; c < left + 5; c++) cells.push(r * COLS + c);
        directClear = true;
      }
    } else if (character === 'ian') {
      if (skill === 1) {
        if (this.state.difficulty === 'challenge') upgradeOrdinary(1, 'bomb');
        else this.state.turns += 2;
      }
      else upgradeOrdinary(1, 'ultimate');
    } else if (skill === 1) {
      const candidates: number[][] = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (c <= COLS - 5) candidates.push(Array.from({ length: 5 }, (_, k) => r * COLS + c + k));
        if (r <= ROWS - 5) candidates.push(Array.from({ length: 5 }, (_, k) => (r + k) * COLS + c));
      }
      const eligible = candidates.filter(line => line.every(i => board[i] && board[i]!.special !== 'ultimate'));
      const line = eligible[Math.floor(this.random() * eligible.length)];
      if (line) {
        const color = Math.floor(this.random() * COLORS);
        line.forEach(i => { board[i]!.color = color; cells.push(i); });
      }
    } else {
      const counts = this.counts();
      // Fixed color order resolves ties consistently. Special markers are preserved.
      const rank = Array.from({ length: COLORS }, (_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
      board.forEach((t, i) => { if (t && t.special !== 'ultimate' && (t.color === rank[0] || t.color === rank[4])) { t.color = rank[2]; cells.push(i); } });
    }
    frames.push(this.frame('skill', { cells, spawns, skill, skillCharacter: character, skillName: SKILLS[character].skills[skill - 1].name }));
    if (directClear) {
      this.clear([], cells, 1, frames);
      this.settle(frames, [], 1);
    } else this.settle(frames);
  }
  ensurePlayable(frames: Frame[]) {
    if (findMove(this.state.board)) return;
    const original = this.state.board.slice();
    for (let attempt = 0; attempt < 200; attempt++) {
      const board = original.slice();
      for (let i = board.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [board[i], board[j]] = [board[j], board[i]]; }
      if (!findMatches(board).length && findMove(board)) { this.state.board = board; frames.push(this.frame('shuffle')); return; }
    }
    this.state.board = this.makeBoard();
    frames.push(this.frame('shuffle'));
  }
  private combine(combination: Combination, frames: Frame[]) {
    const { kind, origin, pair } = combination;
    const board = this.state.board, row = Math.floor(origin / COLS), column = origin % COLS;
    if (kind === 'ultimate-bomb' || kind === 'ultimate-cross') {
      const ultimate = pair.find(i => board[i]!.special === 'ultimate')!;
      const partner = pair.find(i => i !== ultimate)!;
      const color = board[partner]!.color;
      const special = kind === 'ultimate-bomb' ? 'bomb' : 'cross';
      combination.color = color;
      const cells = board.flatMap((tile, i) => tile && tile.special !== 'ultimate' && tile.color === color ? [i] : []);
      cells.forEach(i => board[i] = this.tile(color, special));
      // Conversion is visible and unscored; every converted special then fires
      // in the following clear, including the swapped colored partner.
      frames.push(this.frame('combine', { cells, spawns: cells, combination }));
      this.clear([], [...new Set([...pair, ...cells])], 1, frames, [ultimate], combination);
    } else {
      const cells = board.flatMap((tile, i) => {
        if (!tile) return [];
        const dr = Math.floor(i / COLS) - row, dc = i % COLS - column;
        const hit = kind === 'ultimate-ultimate' || (kind === 'bomb-bomb' ? Math.abs(dr) <= 2 && Math.abs(dc) <= 2 : kind === 'bomb-cross' ? Math.abs(dr) <= 1 || Math.abs(dc) <= 1 : dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc));
        return hit ? [i] : [];
      });
      frames.push(this.frame('combine', { cells: pair, combination }));
      this.clear([], [...new Set([...cells, ...pair])], 1, frames, pair, combination);
    }
    this.settle(frames, [], 1);
  }
  move(a: number, b: number): Frame[] {
    if (this.state.status !== 'playing' || !adjacent(a, b)) return [];
    const board = this.state.board;
    if (!board[a] || !board[b]) return [];
    [board[a], board[b]] = [board[b], board[a]];
    const ultimate = board[a]!.special === 'ultimate' || board[b]!.special === 'ultimate';
    const combined = combinationKind(board[a]!.special, board[b]!.special);
    const matches = findMatches(board, [b, a]);
    const valid = ultimate || !!combined || matches.some(m => m.cells.includes(a) || m.cells.includes(b));
    const frames: Frame[] = [];
    if (!valid) {
      frames.push(this.frame('swap', { pair: [a, b] }));
      [board[a], board[b]] = [board[b], board[a]];
      frames.push(this.frame('invalid', { pair: [a, b] }));
      return frames;
    }
    this.state.turns--;
    this.state.moves++;
    this.state.energy += 50;
    frames.push(this.frame('swap', { pair: [a, b] }));
    if (combined) {
      this.combine({ kind: combined, origin: b, pair: [a, b] }, frames);
    } else if (ultimate) {
      const double = board[a]!.special === 'ultimate' && board[b]!.special === 'ultimate';
      const target = board[a]!.special === 'ultimate' ? board[b]!.color : board[a]!.color;
      const forced = board.flatMap((t, i) => t && (double || i === a || i === b || t.color === target && t.special !== 'ultimate') ? [i] : []);
      this.clear([], forced, 1, frames, [a, b]);
      this.settle(frames, [], 1);
    } else this.settle(frames, [b, a]);
    // One cycle may charge the next through a large cascade. Bound degenerate RNG chains.
    for (let cycle = 0; cycle < 12; cycle++) {
      if (!this.state.firstFired && this.state.energy >= 300) this.cast(1, frames);
      else if (this.state.firstFired && this.state.energy >= 550) this.cast(2, frames);
      else break;
    }
    const target = LEVELS[this.state.difficulty].target;
    this.state.status = target === null ? (this.state.turns <= 0 ? 'completed' : 'playing') : this.state.score >= target ? 'won' : this.state.turns <= 0 ? 'lost' : 'playing';
    if (this.state.status === 'playing') this.ensurePlayable(frames);
    frames.push(this.frame('end'));
    return frames;
  }
}
