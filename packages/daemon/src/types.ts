export type Verdict = 'on_task' | 'off_task' | 'unknown';

export interface Signal {
  app: string | null;
  title: string | null;
  host?: string | null;
  pageTitle?: string | null;
}

export type RuleEffect = 'allow' | 'deny';

export type RuleSource = 'manual' | 'file' | 'learned';

export interface Rule {
  id?: number;
  taskId: number | null;
  pattern: string;
  effect: RuleEffect;
  source?: RuleSource;
}

export type TaskStatus = 'active' | 'backlog' | 'done';

export interface Task {
  id: number;
  title: string;
  priority: number;
  status: TaskStatus;
}

export interface OverlayPayload {
  task: string;
  app: string | null;
  title: string | null;
  driftSeconds: number;
  snoozeMinutes: number;
  snoozePresets: number[];
}

export type OverlayAction =
  | {action: 'dismiss' | 'ack' | 'defer' | 'promote' | 'settings' | 'confirm_on_task'}
  | {action: 'snooze'; minutes: number}
  | {action: 'override'; kind: 'allow_app_today' | 'notify_only_today'};

export interface Tab {
  host: string | null;
  pageTitle: string | null;
}

/** Everything the desktop must provide. One file implements this per desktop (see adapters/). */
export interface Shell {
  start(onSignal: (s: Signal) => void): Promise<void>;
  stop(): Promise<void>;
  idleMs(): Promise<number>;
  onAction(cb: (a: OverlayAction) => void): void;
  flash(text: string): Promise<void>;
  ack(title: string, body: string): Promise<void>;
  overlay(payload: OverlayPayload): Promise<void>;
}
