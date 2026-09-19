import {applyAction} from './actions.js';
import type {ClassifierChain} from './classify/chain.js';
import type {Settings} from './settings.js';
import type {GoogleTasks} from './sync/googleTasks.js';
import {openInBrowser} from './sync/googleTasks.js';
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
  settings: Settings;
  classifier: ClassifierChain;
  google?: GoogleTasks;
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
  private ticking = false;

  constructor(private readonly deps: DaemonDeps) {
    this.engine = new DriftEngine({resetAfterOnTaskSeconds: 60});
    this.escalator = new Escalator({thresholds: [], cooldownSeconds: 0});
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.log;
  }

  async start(): Promise<void> {
    await this.deps.tabs?.start(t => {
      this.tab = t;
      void this.tick();
    });
    await this.deps.source.start(s => {
      this.window = s;
      void this.tick();
    });
    this.deps.actions?.onAction(a => this.onAction(a));
    this.schedule();
    this.log('focus-monitord started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.deps.tabs?.stop();
    await this.deps.source.stop();
  }

  private heartbeat = 0;

  private schedule(): void {
    const seconds = this.deps.settings.number('heartbeat_seconds');
    if (seconds === this.heartbeat) return;
    if (this.timer) clearInterval(this.timer);
    this.heartbeat = seconds;
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
  }

  private applySettings(): void {
    const s = this.deps.settings;
    this.engine.opts.resetAfterOnTaskSeconds = s.number('reset_after_on_task_seconds');
    this.escalator.opts = {thresholds: s.numbers('thresholds'), cooldownSeconds: s.number('cooldown_seconds')};
    this.schedule();
  }

  private currentSignal(): Signal | null {
    if (!this.window) return null;
    if (!isBrowser(this.window.app) || !this.tab) return this.window;
    return {...this.window, host: this.tab.host, pageTitle: this.tab.pageTitle};
  }

  private levelCap(now: number): number {
    const s = this.deps.settings;
    const until = s.number('max_level_until');
    return until === 0 || until > now ? s.number('max_level') : 3;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.evaluate();
    } finally {
      this.ticking = false;
    }
  }

  private async evaluate(): Promise<void> {
    const now = this.now();
    this.applySettings();
    await this.flushSync();
    const task = activeTask(this.deps.store.tasks());
    const signal = this.currentSignal();
    const idleMs = (await this.deps.idle?.idleMs()) ?? 0;
    if (!task || !signal || idleMs > this.deps.settings.number('idle_after_seconds') * 1000) {
      this.engine.update('idle', now);
      return;
    }
    if (task.id !== this.taskId) {
      this.taskId = task.id;
      this.engine.reset();
      this.escalator.reset();
    }
    const verdict = await this.deps.classifier.classify(signal, task, this.deps.store.rules(Math.floor(now / 1000)), now);
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
    this.escalator.snooze(this.deps.settings.number('snoozed_until'));
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
      snoozeMinutes: this.deps.settings.number('last_snooze_minutes'),
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
    if (effect.openSettings) openInBrowser(`http://127.0.0.1:${this.deps.config.port}/`);
    this.log(`action ${action.action}: ${effect.message}`);
  }

  private async flushSync(): Promise<void> {
    const g = this.deps.google;
    if (!g?.configured()) return;
    for (const item of this.deps.store.pendingSync()) {
      const task = this.deps.store.taskById(item.taskId);
      if (!task) {
        this.deps.store.syncDone(item.id);
        continue;
      }
      try {
        await g.push(task.title, 'Saved for later by Focus Monitor');
        this.deps.store.syncDone(item.id);
        this.log(`synced "${task.title}" to Google Tasks`);
      } catch (err) {
        this.deps.store.syncFailed(item.id, (err as Error).message);
        this.log(`google tasks sync failed (attempt ${item.attempts + 1}): ${(err as Error).message}`);
      }
    }
  }
}
