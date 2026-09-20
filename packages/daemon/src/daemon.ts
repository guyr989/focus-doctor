import {applyAction} from './actions.js';
import type {ClassifierChain} from './classify/chain.js';
import type {Settings} from './settings.js';
import type {GoogleTasks} from './sync/googleTasks.js';
import {DriftEngine} from './drift/engine.js';
import {Escalator} from './drift/escalator.js';
import type {Store} from './store/db.js';
import {activeTask} from './tasks/queue.js';
import type {LocalServer} from './http/server.js';
import type {OverlayAction, Shell, Signal, Tab, Task} from './types.js';

const BROWSERS = ['chrome', 'chromium', 'brave', 'firefox', 'edge'];
const isBrowser = (app: string | null) => !!app && BROWSERS.some(b => app.toLowerCase().includes(b));
const SNOOZE_PRESETS = [5, 10, 15, 30, 60];

export interface DaemonDeps {
  shell: Shell;
  store: Store;
  settings: Settings;
  classifier: ClassifierChain;
  server?: LocalServer;
  google?: GoogleTasks;
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

  onTab(t: Tab): void {
    this.tab = t;
    void this.tick();
  }

  async start(): Promise<void> {
    await this.deps.server?.start();
    await this.deps.shell.start(s => {
      this.window = s;
      void this.tick();
    });
    this.deps.shell.onAction(a => this.onAction(a));
    this.timer = setInterval(() => void this.tick(), this.deps.settings.number('heartbeat_seconds') * 1000);
    this.log('focus-doctord started');
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.deps.server?.stop();
    await this.deps.shell.stop();
  }

  private applySettings(): void {
    const s = this.deps.settings;
    this.engine.opts.resetAfterOnTaskSeconds = s.number('reset_after_on_task_seconds');
    this.escalator.opts = {thresholds: s.get('thresholds').split(',').map(Number), cooldownSeconds: s.number('cooldown_seconds')};
  }

  private currentSignal(): Signal | null {
    if (!this.window) return null;
    if (!isBrowser(this.window.app) || !this.tab) return this.window;
    return {...this.window, host: this.tab.host, pageTitle: this.tab.pageTitle};
  }

  private levelCap(now: number): number {
    return this.deps.settings.number('notify_only_until') > now ? 2 : 3;
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
    const idleMs = await this.deps.shell.idleMs();
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
    const n = this.deps.shell;
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
        await g.push(task.title, 'Saved for later by Focus Doctor');
        this.deps.store.syncDone(item.id);
        this.log(`synced "${task.title}" to Google Tasks`);
      } catch (err) {
        this.deps.store.syncFailed(item.id, (err as Error).message);
        this.log(`google tasks sync failed (attempt ${item.attempts + 1}): ${(err as Error).message}`);
      }
    }
  }
}
