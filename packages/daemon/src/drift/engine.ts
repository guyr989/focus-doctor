import type {Verdict} from '../types.js';

export type Observation = Verdict | 'idle';

export class DriftEngine {
  driftSeconds = 0;
  private onTaskSeconds = 0;
  private last: {obs: Observation; at: number} | null = null;

  constructor(private readonly opts: {resetAfterOnTaskSeconds: number}) {}

  update(obs: Observation, nowMs: number): number {
    if (this.last) this.attribute(this.last.obs, Math.max(0, (nowMs - this.last.at) / 1000));
    if (obs === 'off_task') this.onTaskSeconds = 0;
    this.last = {obs, at: nowMs};
    return this.driftSeconds;
  }

  private attribute(obs: Observation, elapsed: number): void {
    if (obs === 'idle') return;
    if (obs === 'off_task') {
      this.driftSeconds += elapsed;
      return;
    }
    this.onTaskSeconds += elapsed;
    if (this.onTaskSeconds >= this.opts.resetAfterOnTaskSeconds) {
      this.driftSeconds = 0;
      this.onTaskSeconds = 0;
    }
  }
}
