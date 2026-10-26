import { it, expect } from 'vitest';
import { LocalRun } from '../src/local-run';
import { GameEngine, seededRandom, findMove } from '../src/engine';

it('keeps local play identical to a seed replay for every character and mode', () => {
  for (const character of ['beth', 'lance', 'chris', 'ian'] as const) for (const mode of ['easy', 'hard', 'challenge'] as const) {
    const local = new LocalRun('test', 12345, mode, character), server = new GameEngine(mode, seededRandom(12345), character); server.start();
    for (let i = 0; i < 12 && server.state.status === 'playing'; i++) {
      const pair = findMove(server.state.board)!;
      expect(local.move(...pair).frames).toEqual(server.move(...pair));
      expect(local.matches(server.snapshot())).toBe(true);
    }
  }
});
it('records valid moves only and returns an immutable completed report', () => {
  const run = new LocalRun('test', 6, 'challenge', 'beth');
  expect(run.move(0, 55).frames).toEqual([]); expect(() => run.completion()).toThrow();
  while (run.game.state.status === 'playing') run.move(...findMove(run.game.state.board)!);
  const report = run.completion(); expect(report.actions).toHaveLength(30);
  report.actions[0][0] = -1; expect(run.completion().actions[0][0]).toBeGreaterThanOrEqual(0);
});
