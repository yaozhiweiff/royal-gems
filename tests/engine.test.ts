import { describe, it, expect } from 'vitest';
import { GameEngine, COLS, ROWS, LEVELS, adjacent, findMatches, findMove, seededRandom, type Frame, type Special } from '../src/engine';

function fixture(seed = 42) {
  const game = new GameEngine('easy', seededRandom(seed));
  game.state.board = Array.from({ length: ROWS * COLS }, (_, i) => game.tile((i % COLS + Math.floor(i / COLS) * 2) % 5));
  game.start();
  return game;
}
function set(game: GameEngine, cells: number[], color: number, special: Special = 'normal') { cells.forEach(i => game.state.board[i] = game.tile(color, special)); }
function basicMove(game: GameEngine) {
  set(game, [0, 1, 10], 3); set(game, [2], 1); set(game, [3], 4);
  return game.move(2, 10);
}

describe('board construction and input', () => {
  it('starts without matches and with a legal move across 100 seeds', () => {
    for (let seed = 0; seed < 100; seed++) {
      const game = new GameEngine('easy', seededRandom(seed));
      expect(game.state.board).toHaveLength(56);
      expect(findMatches(game.state.board)).toHaveLength(0);
      expect(findMove(game.state.board)).not.toBeNull();
    }
  });
  it('prevents row wrapping and diagonal swaps', () => {
    expect(adjacent(7, 8)).toBe(false); expect(adjacent(0, 9)).toBe(false); expect(adjacent(0, 8)).toBe(true);
    const game = fixture(); expect(game.move(7, 8)).toEqual([]); expect(game.state.turns).toBe(20);
  });
  it('reverts invalid swaps without charging or consuming turns', () => {
    const game = fixture(), before = game.snapshot();
    const frames = game.move(0, 1);
    expect(frames.map(f => f.kind)).toEqual(['swap', 'invalid']);
    expect(game.snapshot()).toEqual(before);
    expect(game.state.moves).toBe(0);
  });
  it('scores 10 per cleared tile and awards 50 per action plus 2 per cleared tile', () => {
    const game = fixture();
    const frames = basicMove(game), first = frames.find(f => f.kind === 'clear')!;
    expect(first.cells).toHaveLength(3); expect(first.points).toBe(30);
    expect(first.state.energy).toBe(56); expect(first.state.turns).toBe(19);
    expect(game.state.moves).toBe(1);
    expect(game.state.board.every(Boolean)).toBe(true); expect(findMatches(game.state.board)).toHaveLength(0);
  });
});
describe('special creation and activation', () => {
  it('creates a bomb for straight four and an ultimate for five', () => {
    const game = fixture(); set(game, [16, 17, 18, 19], 4);
    expect(findMatches(game.state.board).find(m => m.cells.includes(16))!.special).toBe('bomb');
    set(game, [20], 4);
    expect(findMatches(game.state.board).find(m => m.cells.includes(16))!.special).toBe('ultimate');
  });
  it('creates crosses for T and L shapes and favors the swap destination', () => {
    for (const cells of [[17, 18, 19, 10, 26], [16, 17, 18, 24, 32]]) {
      const game = fixture(); set(game, cells, 4);
      const match = findMatches(game.state.board, [cells[0]]).find(m => m.cells.includes(cells[0]))!;
      expect(match.special).toBe('cross'); expect(match.spawn).toBe(cells[0]);
    }
  });
  it('retains a generated special at the destination during settlement', () => {
    const game = fixture(); set(game, [0, 1, 3, 10], 3); set(game, [2], 1);
    const first = game.move(2, 10).find(f => f.kind === 'clear')!;
    expect(first.state.board[2]?.special).toBe('bomb'); expect(first.cells).not.toContain(2);
    expect(first.spawns).toEqual([2]);
    expect(first.points).toBe(first.cells!.length * 10);
  });
  it('limits a corner explosion to valid cells and counts each cleared cell once', () => {
    const game = fixture(); set(game, [0], 3, 'bomb'); set(game, [1, 10], 3); set(game, [2], 1); set(game, [3], 4);
    const first = game.move(2, 10).find(f => f.kind === 'clear')!;
    expect(first.cells).toEqual(expect.arrayContaining([0, 1, 2, 8, 9]));
    expect(new Set(first.cells).size).toBe(first.cells!.length);
    expect(first.points).toBe(first.cells!.length * 10);
  });
  it('cross clears a whole row and column and chains into a bomb', () => {
    const game = fixture(); set(game, [0], 3, 'cross'); set(game, [1, 10], 3); set(game, [2], 1); set(game, [3], 4); set(game, [40], 2, 'bomb');
    const first = game.move(2, 10).find(f => f.kind === 'clear')!;
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 8, 16, 24, 32, 40, 48, 33, 41, 49]) expect(first.cells).toContain(i);
  });
  it('ultimate swap removes every tile of the partner color', () => {
    const game = fixture(); set(game, [0], 0, 'ultimate');
    const target = game.state.board[1]!.color;
    const expected = game.state.board.flatMap((t, i) => i === 0 || t?.color === target ? [i] : []);
    const first = game.move(0, 1).find(f => f.kind === 'clear')!;
    expect(first.cells!.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
  });
  it('two ultimates clear all 56 cells once', () => {
    const game = fixture(); set(game, [0, 1], 0, 'ultimate');
    const first = game.move(0, 1).find(f => f.kind === 'clear')!;
    expect(first.cells).toHaveLength(56); expect(first.points).toBe(560);
  });
});
describe('skills and game end', () => {
  it('automatically casts skill one at 300 and makes a straight same-color five', () => {
    const game = fixture(); game.state.energy = 250;
    const frame = basicMove(game).find(f => f.kind === 'skill' && f.skill === 1)!;
    expect(frame).toBeDefined(); expect(frame.cells).toHaveLength(5);
    const colors = frame.cells!.map(i => frame.state.board[i]!.color);
    expect(new Set(colors).size).toBe(1); expect(frame.state.firstFired).toBe(true);
  });
  it('casts skill two at 550 and resets the energy cycle', () => {
    const game = fixture(); game.state.energy = 500; game.state.firstFired = true;
    const frames = basicMove(game); const index = frames.findIndex(f => f.kind === 'skill' && f.skill === 2);
    expect(index).toBeGreaterThan(-1); const skill = frames[index];
    expect(skill.state.energy).toBe(0); expect(skill.state.firstFired).toBe(false);
    const prior = frames[index - 1].state;
    const counts = Array(5).fill(0); prior.board.forEach(t => { if (t && t.special !== 'ultimate') counts[t.color]++; });
    const ranks = [0, 1, 2, 3, 4].sort((a, b) => counts[b] - counts[a] || a - b);
    skill.cells!.forEach(i => expect(skill.state.board[i]!.color).toBe(ranks[2]));
  });
  it('wins on the last move after all cascades settle, otherwise loses', () => {
    const win = fixture(); win.state.turns = 1; win.state.score = LEVELS.easy.target - 10; basicMove(win); expect(win.state.status).toBe('won');
    const loss = fixture(); loss.state.turns = 1; basicMove(loss); expect(loss.state.status).toBe('lost'); expect(loss.move(0, 1)).toEqual([]);
  });
  it('uses separate easy and hard limits', () => {
    const game = new GameEngine('hard'); expect(game.state.turns).toBe(30); expect(LEVELS.hard.target).toBe(10000);
  });
  it('automatically reshuffles a dead board without consuming turns or score', () => {
    const game = fixture();
    game.state.board = Array.from({ length: 56 }, (_, i) => game.tile((i % 8 + Math.floor(i / 8)) % 5));
    expect(findMove(game.state.board)).toBeNull();
    const frames: Frame[] = []; game.ensurePlayable(frames);
    expect(findMove(game.state.board)).not.toBeNull(); expect(findMatches(game.state.board)).toHaveLength(0);
    expect(game.state.turns).toBe(20); expect(game.state.score).toBe(0); expect(frames[0].kind).toBe('shuffle');
  });
  it('remains consistent across complete autoplay sessions', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const game = new GameEngine('hard', seededRandom(seed)); game.start();
      for (let turn = 0; turn < 30 && game.state.status === 'playing'; turn++) {
        const pair = findMove(game.state.board)!; expect(pair).not.toBeNull();
        const beforeTurns = game.state.turns; game.move(...pair);
        expect(game.state.turns).toBe(beforeTurns - 1); expect(game.state.board.every(Boolean)).toBe(true);
        expect(new Set(game.state.board.map(t => t!.id)).size).toBe(56);
        expect(findMatches(game.state.board)).toHaveLength(0);
      }
      expect(['won', 'lost']).toContain(game.state.status);
    }
  });
});
