import { describe, it, expect } from 'vitest';
import { GameEngine, LEVELS, findMove, findMatches, seededRandom } from '../src/engine';
import { characterSkills } from '../src/skills';

describe('fixed-turn score challenge', () => {
  it('has no target and never finishes early on high scores', () => {
    expect(LEVELS.challenge).toEqual({ name: '挑战', turns: 30, target: null });
    const game = new GameEngine('challenge', seededRandom(42)); game.start(); game.state.score = 50000;
    game.move(...findMove(game.state.board)!);
    expect(game.state.status).toBe('playing'); expect(game.state.turns).toBe(29);
  });
  it('plays exactly 30 valid moves with every character and settles the final score', () => {
    for (const role of ['beth', 'lance', 'chris', 'ian'] as const) {
      const game = new GameEngine('challenge', seededRandom(681), role); game.start();
      for (let turn = 1; turn <= 30; turn++) {
        const frames = game.move(...findMove(game.state.board)!);
        expect(game.state.turns).toBe(30 - turn);
        expect(game.state.status).toBe(turn === 30 ? 'completed' : 'playing');
        expect(game.state.board.every(Boolean)).toBe(true); expect(findMatches(game.state.board)).toHaveLength(0);
        expect(frames.at(-1)!.state.score).toBe(game.state.score);
      }
      const final = game.snapshot(); expect(game.move(0, 1)).toEqual([]); expect(game.snapshot()).toEqual(final);
    }
  });
  it('replaces Ian’s extra turns with a bomb, including on the final turn', () => {
    const game = new GameEngine('challenge', seededRandom(42), 'ian');
    game.state.board = Array.from({ length: 56 }, (_, i) => game.tile((i % 8 + Math.floor(i / 8) * 2) % 5));
    [0, 1, 10].forEach(i => game.state.board[i] = game.tile(3)); game.state.board[2] = game.tile(1); game.state.board[3] = game.tile(4);
    game.state.turns = 1; game.state.energy = 250; game.start();
    const frames = game.move(2, 10), skill = frames.find(f => f.kind === 'skill' && f.skill === 1)!;
    expect(skill.spawns).toHaveLength(1); expect(skill.state.board[skill.spawns![0]]!.special).toBe('bomb');
    expect(game.state.turns).toBe(0); expect(game.state.status).toBe('completed');
    expect(characterSkills('ian', 'challenge').skills[0].description).toContain('爆炸');
    expect(characterSkills('ian', 'hard').skills[0].description).toContain('增加 2 个回合');
  });
});
