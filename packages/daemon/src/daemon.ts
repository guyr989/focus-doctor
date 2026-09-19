import {matchRules} from './classify/rules.js';
import type {Config} from './config.js';
import {DriftEngine} from './drift/engine.js';
import {Escalator} from './drift/escalator.js';
import type {Store} from './store/db.js';
import {activeTask} from './tasks/queue.js';
import type {Notifier, Signal, SignalSource, Task} from './types.js';

export interface DaemonDeps {
  source: SignalSource;
  notifier: Notifier;
  store: Store;
  config: Config;
  now?: () => number;
  log?: (msg: string) => void;
}

export class Daemon {
  private readonly engine: DriftEngine;
  private readonly escalator: Escalator;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private signal: Signal | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DaemonDeps) {
    this.engine = new DriftEngine({resetAfterOnTaskSeconds: deps.config.resetAfterOnTaskSeconds});
    this.escalator = new Escalator({thresholds: deps.config.thresholds, cooldownSeconds: deps.config.cooldownSeconds});
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.log;
  }

  async start(): Promise<void> {
    await this.deps.source.start(s => this.onSignal(s));
    this.timer = setInterval(() => this.tick(), this.deps.config.heartbeatSeconds * 1000);
    this.log('focus-monitord started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.deps.source.stop();
  }

  private onSignal(s: Signal): void {
    this.signal = s;
    this.tick();
  }

  private tick(): void {
    const now = this.now();
    const task = activeTask(this.deps.store.tasks());
    if (!task || !this.signal) {
      this.engine.update('idle', now);
      return;
    }
    const verdict = matchRules(this.signal, this.deps.store.rules(), task.id);
    const drift = this.engine.update(verdict, now);
    this.deps.store.recordSample({
      ts: Math.floor(now / 1000),
      app: this.signal.app,
      title: this.signal.title,
      host: this.signal.host ?? null,
      verdict,
      taskId: task.id,
      driftSeconds: drift,
    });
    const level = this.escalator.evaluate(drift, now);
    if (level) void this.intervene(level, task, drift);
  }

  private async intervene(level: number, task: Task, drift: number): Promise<void> {
    const span = drift < 60 ? `${Math.round(drift)}s` : `${Math.round(drift / 60)} min`;
    this.log(`level ${level}: off task ${span} (task: ${task.title})`);
    await this.deps.notifier.flash(`Off task ${span} — back to: ${task.title}`);
  }
}
