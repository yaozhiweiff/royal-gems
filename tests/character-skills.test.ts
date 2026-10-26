import { describe, expect, it } from 'vitest';
import { COLS, ROWS, GameEngine, findMatches, findMove, seededRandom, type Frame, type Special } from '../src/engine';
import { SKILLS, type CharacterId } from '../src/skills';

const characters: CharacterId[] = ['beth', 'lance', 'chris', 'ian'];

function fixture(character: CharacterId, seed = 42) {
  const game = new GameEngine('easy', seededRandom(seed), character);
  game.state.board = Array.from({ length: ROWS * COLS }, (_, i) => game.tile((i % COLS + Math.floor(i / COLS) * 2) % 5));
  game.start();
  return game;
}

function basicMove(game: GameEngine) {
  [0, 1, 10].forEach(i => game.state.board[i] = game.tile(3));
  game.state.board[2] = game.tile(1);
  game.state.board[3] = game.tile(4);
  return game.move(2, 10);
}

function trigger(game: GameEngine, skill: 1 | 2) {
  game.state.energy = skill === 1 ? 250 : 500;
  game.state.firstFired = skill === 2;
  const frames = basicMove(game);
  const index = frames.findIndex(frame => frame.kind === 'skill' && frame.skill === skill);
  expect(index).toBeGreaterThan(0);
  return { frames, index, skill: frames[index], prior: frames[index - 1].state };
}

describe('distinct character skill contracts', () => {
  it('keeps Beth as the default and identifies the character on every playback frame', () => {
    expect(new GameEngine().state.character).toBe('beth');
    for (const character of characters) {
      const game = fixture(character);
      const { frames, skill } = trigger(game, 1);
      expect(frames.every(frame => frame.state.character === character)).toBe(true);
      expect(skill.skillCharacter).toBe(character);
      expect(skill.skillName).toBe(SKILLS[character].skills[0].name);
      expect(skill.state.firstFired).toBe(true);
      expect(skill.state.energy).toBeGreaterThanOrEqual(300);
    }
    expect(new Set(characters.map(character => SKILLS[character].style)).size).toBe(4);
  });

  it('Beth creates a same-color straight five, followed by a scored clear', () => {
    const { frames, index, skill } = trigger(fixture('beth'), 1);
    expect(skill.cells).toHaveLength(5);
    const rows = new Set(skill.cells!.map(i => Math.floor(i / COLS)));
    const columns = new Set(skill.cells!.map(i => i % COLS));
    expect(rows.size === 1 || columns.size === 1).toBe(true);
    expect(new Set(skill.cells!.map(i => skill.state.board[i]!.color)).size).toBe(1);
    expect(frames[index + 1].kind).toBe('clear');
    expect(frames[index + 1].points).toBeGreaterThanOrEqual(40);
  });

  it('Beth recolors the most and least common colors to the third-ranked color', () => {
    const { prior, skill } = trigger(fixture('beth'), 2);
    const counts = [0, 0, 0, 0, 0];
    prior.board.forEach(tile => { if (tile && tile.special !== 'ultimate') counts[tile.color]++; });
    const ranks = [0, 1, 2, 3, 4].sort((a, b) => counts[b] - counts[a] || a - b);
    const affected = prior.board.flatMap((tile, index) => tile && tile.special !== 'ultimate' && [ranks[0], ranks[4]].includes(tile.color) ? [index] : []);
    expect(skill.cells).toEqual(affected);
    affected.forEach(index => expect(skill.state.board[index]!.color).toBe(ranks[2]));
    expect(skill.state.energy).toBe(0);
  });

  it.each([
    ['lance', 'cross', 2, 1],
    ['chris', 'bomb', 2, 1],
    ['ian', 'ultimate', 1, 2],
  ] as const)('%s creates %s gems without replacing existing specials', (character, special, count, skillNumber) => {
    const game = fixture(character);
    game.state.board[48] = game.tile(2, 'bomb');
    game.state.board[50] = game.tile(4, 'cross');
    game.state.board[55] = game.tile(1, 'ultimate');
    const { prior, skill } = trigger(game, skillNumber);
    expect(skill.cells).toHaveLength(count);
    expect(skill.spawns).toEqual(skill.cells);
    expect(new Set(skill.cells).size).toBe(count);
    skill.cells!.forEach(index => {
      expect(prior.board[index]!.special).toBe('normal');
      expect(skill.state.board[index]!.special).toBe(special);
      expect(skill.state.board[index]!.color).toBe(prior.board[index]!.color);
    });
    prior.board.forEach((tile, index) => {
      if (tile && tile.special !== 'normal') expect(skill.state.board[index]).toEqual(tile);
    });
  });

  it('Lance clears two adjacent full rows through clear/drop frames and earns score and new-cycle energy', () => {
    const { frames, index, skill } = trigger(fixture('lance'), 2);
    const rows = [...new Set(skill.cells!.map(i => Math.floor(i / COLS)))].sort((a, b) => a - b);
    expect(skill.cells).toHaveLength(COLS * 2);
    expect(rows).toHaveLength(2);
    expect(rows[1] - rows[0]).toBe(1);
    expect(skill.state.energy).toBe(0);
    expect(skill.state.firstFired).toBe(false);
    expect(skill.cells!.every(i => skill.state.board[i] !== null)).toBe(true);
    const clear = frames[index + 1];
    expect(clear.kind).toBe('clear');
    expect(clear.cells).toEqual(skill.cells);
    expect(clear.points).toBe(160);
    expect(clear.state.score - skill.state.score).toBe(160);
    expect(clear.state.energy).toBe(32);
    expect(frames[index + 2].kind).toBe('drop');
  });

  it('Chris always clears a full 5×5 in-bounds square and activates special gems hit by it', () => {
    const game = fixture('chris');
    // Every possible 5×5 square contains this row-3, column-3 cross.
    game.state.board[3 * COLS + 3] = game.tile(4, 'cross');
    const { frames, index, skill } = trigger(game, 2);
    const rows = new Set(skill.cells!.map(i => Math.floor(i / COLS)));
    const columns = new Set(skill.cells!.map(i => i % COLS));
    expect(skill.cells).toHaveLength(25);
    expect(rows.size).toBe(5);
    expect(columns.size).toBe(5);
    expect(skill.cells!.every(i => i >= 0 && i < ROWS * COLS)).toBe(true);
    expect(skill.state.energy).toBe(0);
    const clear = frames[index + 1];
    expect(clear.kind).toBe('clear');
    expect(clear.special).toContain('cross');
    expect(clear.cells!.length).toBeGreaterThan(25);
    expect(new Set(clear.cells).size).toBe(clear.cells!.length);
    expect(clear.points).toBe(clear.cells!.length * 10);
    expect(clear.state.energy).toBe(clear.cells!.length * 2);
    expect(game.state.score).toBe(frames.filter(frame => frame.kind === 'clear').reduce((sum, frame) => sum + frame.points!, 0));
  });

  it('Ian gains two turns and can continue after the otherwise-final move', () => {
    const game = fixture('ian');
    game.state.turns = 1;
    const { prior, skill } = trigger(game, 1);
    expect(prior.turns).toBe(0);
    expect(skill.state.turns).toBe(2);
    expect(skill.cells).toEqual([]);
    expect(skill.state.board).toEqual(prior.board);
    expect(game.state.status).toBe('playing');
    expect(game.state.turns).toBe(2);
  });

  it('a 550-energy cast re-arms the 300-energy skill, which fires only once per cycle', () => {
    const game = fixture('ian');
    const first = trigger(game, 1);
    expect(first.frames.filter(frame => frame.kind === 'skill')).toHaveLength(1);
    const second = trigger(game, 2);
    expect(second.skill.state.energy).toBe(0);
    expect(second.skill.state.firstFired).toBe(false);
    expect(second.skill.skillName).toBe(SKILLS.ian.skills[1].name);
    const third = trigger(game, 1);
    expect(third.frames.filter(frame => frame.kind === 'skill')).toHaveLength(1);
    expect(third.skill.state.turns - third.prior.turns).toBe(2);
  });

  it('special creation handles zero or one eligible ordinary gem without overwriting a special', () => {
    // Reach the effect boundary directly to cover an all-special board, which a
    // normal scored move would refill before the automatic skill check.
    for (const [character, special, skillNumber] of [
      ['lance', 'cross', 1], ['chris', 'bomb', 1], ['ian', 'ultimate', 2],
    ] as const) {
      for (const ordinaryCount of [0, 1]) {
        const game = fixture(character);
        game.state.board = Array.from({ length: ROWS * COLS }, (_, i) => game.tile(i % 5, 'ultimate'));
        if (ordinaryCount) game.state.board[9] = game.tile(4);
        const before = game.snapshot();
        const frames: Frame[] = [];
        (game as unknown as { cast(skill: 1 | 2, frames: Frame[]): void }).cast(skillNumber, frames);
        expect(frames).toHaveLength(1);
        expect(frames[0].cells).toHaveLength(ordinaryCount);
        before.board.forEach((tile, index) => {
          if (tile!.special !== 'normal') expect(game.state.board[index]).toEqual(tile);
          else expect(game.state.board[index]!.special).toBe(special as Special);
        });
      }
    }
  });

  it('all four characters complete seeded games with settled boards and accurate cumulative score', () => {
    for (const character of characters) {
      for (let seed = 1; seed <= 8; seed++) {
        const game = new GameEngine('hard', seededRandom(seed), character);
        game.start();
        let scored = 0;
        for (let moves = 0; moves < 100 && game.state.status === 'playing'; moves++) {
          const pair = findMove(game.state.board);
          expect(pair).not.toBeNull();
          const frames = game.move(...pair!);
          scored += frames.filter(frame => frame.kind === 'clear').reduce((sum, frame) => sum + frame.points!, 0);
          expect(game.state.score).toBe(scored);
          expect(game.state.board.every(Boolean)).toBe(true);
          expect(new Set(game.state.board.map(tile => tile!.id)).size).toBe(ROWS * COLS);
          expect(findMatches(game.state.board)).toHaveLength(0);
        }
        expect(['won', 'lost']).toContain(game.state.status);
      }
    }
  });
});
