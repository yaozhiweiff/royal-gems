import { GameEngine, seededRandom, type Difficulty, type State } from './engine';
import type { CharacterId } from './skills';

export type CompletedRun = { runId: string; actions: [number, number][] };
/** Simulation runs synchronously on the player device; only a completed action log is uploaded. */
export class LocalRun {
  readonly game: GameEngine;
  private actions: [number, number][] = [];
  constructor(readonly runId: string, seed: number, mode: Difficulty, character: CharacterId) {
    this.game = new GameEngine(mode, seededRandom(seed), character); this.game.start();
  }
  move(a: number, b: number) {
    const before = this.game.state.moves, frames = this.game.move(a, b);
    if (this.game.state.moves > before) this.actions.push([a, b]);
    return { frames, state: this.game.snapshot() };
  }
  completion(): CompletedRun {
    if (!['won', 'completed'].includes(this.game.state.status)) throw Error('本局尚未完成有效成绩');
    return { runId: this.runId, actions: this.actions.map(pair => [...pair] as [number, number]) };
  }
  matches(state: State) { return JSON.stringify(this.game.snapshot()) === JSON.stringify(state); }
}
