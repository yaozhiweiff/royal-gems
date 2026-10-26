import { describe, it, expect } from 'vitest';
import { GameEngine, LEVELS, findMove, findMatches, seededRandom, type Special } from '../src/engine';

function fixture(a: Special, b: Special, pair: [number, number] = [26, 27]) {
  const game = new GameEngine('hard', seededRandom(681), 'ian');
  game.state.board = Array.from({ length: 56 }, (_, i) => game.tile((i % 8 + Math.floor(i / 8) * 2) % 5));
  game.state.board[pair[0]] = game.tile(0, a);
  game.state.board[pair[1]] = game.tile(1, b);
  game.state.firstFired = true; game.start();
  return game;
}
const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

describe('special swap combinations', () => {
  it.each([
    ['bomb', 'bomb', 'bomb-bomb', 25],
    ['bomb', 'cross', 'bomb-cross', 36],
    ['cross', 'bomb', 'bomb-cross', 36],
    ['cross', 'cross', 'cross-cross', 26],
  ] as const)('%s + %s clears its exact combined shape without a color match', (a, b, kind, count) => {
    const game = fixture(a, b), frames = game.move(26, 27);
    const clear = frames.find(f => f.kind === 'clear')!;
    expect(clear.combination?.kind).toBe(kind); expect(clear.combination?.origin).toBe(27);
    expect(clear.cells).toHaveLength(count);
    expect(clear.points).toBe(count * 10); expect(clear.state.energy).toBe(50 + count * 2);
    expect(clear.state.turns).toBe(29); expect(clear.spawns).toEqual([]);
    for (let i = 0; i < 56; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const expected = kind === 'bomb-bomb' ? row >= 1 && row <= 5 && col >= 1 && col <= 5 : kind === 'bomb-cross' ? [2, 3, 4].includes(row) || [2, 3, 4].includes(col) : row === 3 || col === 3 || row === col || row + col === 6;
      expect(clear.cells!.includes(i), `cell ${i}`).toBe(expected);
    }
    expect(game.state.turns).toBe(29); expect(game.state.board.every(Boolean)).toBe(true);
    expect(findMatches(game.state.board)).toHaveLength(0);
  });

  it.each([
    ['bomb', 'bomb', 9], ['bomb', 'cross', 26], ['cross', 'cross', 20],
  ] as const)('clips %s + %s at a corner, consuming each source once', (a, b, count) => {
    const game = fixture(a, b, [1, 0]);
    const clear = game.move(1, 0).find(f => f.kind === 'clear')!;
    expect(clear.cells).toHaveLength(count); expect(new Set(clear.cells).size).toBe(count);
    expect(clear.cells!.every(i => i >= 0 && i < 56)).toBe(true);
    expect(clear.cells).toEqual(expect.arrayContaining([0, 1]));
  });

  it('continues activating other special gems hit by a combined blast', () => {
    const game = fixture('cross', 'cross');
    game.state.board[18] = game.tile(4, 'bomb');
    const clear = game.move(26, 27).find(f => f.kind === 'clear')!;
    expect(clear.cells).toContain(10); // Outside the eight source rays; reached by the hit bomb.
    expect(clear.special).toContain('bomb');
    expect(clear.points).toBe(new Set(clear.cells).size * 10);
  });

  it.each(['bomb', 'cross'] as const)('ultimate + %s converts the whole color before firing it, in either swap direction', special => {
    for (const pair of [[26, 27], [27, 26]] as [number, number][]) {
      const game = fixture('ultimate', special, pair);
      game.state.board[40] = game.tile(1, special === 'bomb' ? 'cross' : 'bomb');
      game.state.board[55] = game.tile(1, 'ultimate');
      const frames = game.move(...pair), swap = frames[0], conversion = frames.find(f => f.kind === 'combine')!;
      const converted = swap.state.board.flatMap((t, i) => t && t.special !== 'ultimate' && t.color === 1 ? [i] : []);
      expect(sorted(conversion.cells!)).toEqual(sorted(converted));
      expect(conversion.spawns).toEqual(conversion.cells);
      expect(conversion.state.score).toBe(0); expect(conversion.state.energy).toBe(50);
      conversion.cells!.forEach(i => {
        expect(conversion.state.board[i]!.special).toBe(special);
        expect(conversion.state.board[i]!.id).not.toBe(swap.state.board[i]!.id);
      });
      expect(conversion.state.board[55]).toEqual(swap.state.board[55]);
      const index = frames.indexOf(conversion), clear = frames[index + 1];
      expect(clear.kind).toBe('clear');
      expect(clear.cells).toEqual(expect.arrayContaining([...converted, ...pair]));
      expect(clear.points).toBe(new Set(clear.cells).size * 10);
      expect(clear.state.energy).toBe(50 + clear.cells!.length * 2);
      expect(game.state.turns).toBe(29);
      expect(findMatches(game.state.board)).toHaveLength(0);
    }
  });

  it('exposes special-only swaps as hints without mutating the board', () => {
    const game = fixture('bomb', 'cross', [0, 1]);
    const before = game.snapshot();
    expect(findMove(game.state.board)).toEqual([0, 1]);
    expect(game.snapshot()).toEqual(before);
  });

  it('keeps double-ultimate clearing and ordinary invalid swaps intact', () => {
    const game = fixture('ultimate', 'ultimate');
    expect(game.move(26, 27).find(f => f.kind === 'clear')!.cells).toHaveLength(56);
    const ordinary = fixture('normal', 'normal'), before = ordinary.snapshot();
    expect(ordinary.move(6, 7).map(f => f.kind)).toEqual(['swap', 'invalid']);
    expect(ordinary.snapshot()).toEqual(before);
  });

  it('requires 10000 points in hard mode and resolves victory after the last move', () => {
    expect(LEVELS.hard).toEqual({ name: '困难', turns: 30, target: 10000 });
    const win = fixture('bomb', 'bomb'); win.state.turns = 1; win.state.score = 9990;
    win.move(26, 27); expect(win.state.status).toBe('won');
    const loss = fixture('bomb', 'bomb'); loss.state.turns = 1;
    loss.move(26, 27); expect(loss.state.status).toBe('lost');
  });
});
