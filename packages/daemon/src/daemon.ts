import {applyAction, SETTING} from './actions.js';
import {matchRules} from './classify/rules.js';
import type {Config} from './config.js';
import {DriftEngine} from './drift/engine.js';
import {Escalator} from './drift/escalator.js';
import type {Store} from './store/db.js';
import {activeTask} from './tasks/queue.js';
import type {ActionSource, IdleMonitor, Notifier, OverlayAction, Signal, SignalSource, Tab, TabSource, Task} from './types.js';

const BROWSERS = ['chrome', 'chromium', 'brave', 'firefox', 'edge'];
const isBrowser = (app: string | null) => !!app && BROWSERS.some(b => app.toLowerCase().includes(b));
const SNOOZE_PRESETS = [5, 10, 15, 30, 60];

export interface DaemonDeps {
  source: SignalSource;
  notifier: Notifier;
  store: Store;
  config: Config;
  actions?: ActionSource;
  tabs?: TabSource;
  idle?: IdleMonitor;
  now?: () => number;
  log?: (msg: string) => void;
}

export class Daemon {
  private readonly engine: DriftEngine;
  private readonly escalator: Escalator;
  private readonly now: () => number;
  private readonly log: (msg: string) => void;
  private window: Signal | null = null;
  private tab: Tab | null = null;
  private taskId: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: DaemonDeps) {
    this.engine = new DriftEngine({resetAfterOnTaskSeconds: deps.config.resetAfterOnTaskSeconds});
    this.escalator = new Escalator({thresholds: deps.config.thresholds, cooldownSeconds: deps.config.cooldownSeconds});
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.log;
  }

  async start(): Promise<void> {
    await this.deps.source.start(s => {
      this.window = s;
      void this.tick();
    });
    this.deps.actions?.onAction(a => this.onAction(a));
    await this.deps.tabs?.start(t => {
      this.tab = t;
      void this.tick();
    });
    this.timer = setInterval(() => void this.tick(), this.deps.config.heartbeatSeconds * 1000);
    this.log('focus-monitord started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.deps.tabs?.stop();
    await this.deps.source.stop();
  }

  private currentSignal(): Signal | null {
    if (!this.window) return null;
    if (!isBrowser(this.window.app) || !this.tab) return this.window;
    return {...this.window, host: this.tab.host, pageTitle: this.tab.pageTitle};
  }

  private setting(key: string, fallback: number): number {
    const v = this.deps.store.getSetting(key);
    return v === null ? fallback : Number(v);
  }

  private levelCap(now: number): number {
    return this.setting(SETTING.maxLevelUntil, 0) > now ? this.setting(SETTING.maxLevel, 3) : 3;
  }

  private async tick(): Promise<void> {
    const now = this.now();
    const task = activeTask(this.deps.store.tasks());
    const signal = this.currentSignal();
    const idleMs = (await this.deps.idle?.idleMs()) ?? 0;
    if (!task || !signal || idleMs > this.deps.config.idleAfterSeconds * 1000) {
      this.engine.update('idle', now);
      return;
    }
    if (task.id !== this.taskId) {
      this.taskId = task.id;
      this.engine.reset();
      this.escalator.reset();
    }
    const verdict = matchRules(signal, this.deps.store.rules(Math.floor(now / 1000)), task.id);
    const drift = this.engine.update(verdict, now);
    this.deps.store.recordSample({
      ts: Math.floor(now / 1000),
      app: signal.app,
      title: signal.title,
      host: signal.host ?? null,
      verdict,
      taskId: task.id,
      driftSeconds: drift,
    });
    this.escalator.snooze(this.setting(SETTING.snoozedUntil, 0));
    const level = this.escalator.evaluate(drift, now);
    if (level) await this.intervene(Math.min(level, this.levelCap(now)), task, signal, drift);
  }

  private async intervene(level: number, task: Task, signal: Signal, drift: number): Promise<void> {
    const span = drift < 60 ? `${Math.round(drift)}s` : `${Math.round(drift / 60)} min`;
    this.log(`level ${level}: off task ${span} (task: ${task.title})`);
    const n = this.deps.notifier;
    if (level === 1) return n.flash(`Off task ${span} — back to: ${task.title}`);
    if (level === 2) return n.ack(`Off task ${span}`, `You should be on: ${task.title}`);
    return n.overlay({
      task: task.title,
      app: signal.app,
      title: signal.pageTitle ?? signal.title,
      driftSeconds: drift,
      snoozeMinutes: this.setting(SETTING.lastSnoozeMinutes, SNOOZE_PRESETS[0]),
      snoozePresets: SNOOZE_PRESETS,
    });
  }

  private onAction(action: OverlayAction): void {
    const task = activeTask(this.deps.store.tasks());
    const signal = this.currentSignal();
    if (!task || !signal) return;
    const effect = applyAction(this.deps.store, action, {task, signal, nowMs: this.now()});
    if (effect.resetDrift) {
      this.engine.reset();
      this.escalator.reset();
    }
    this.log(`action ${action.action}: ${effect.message}`);
  }
}
