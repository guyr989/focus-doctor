export type Verdict = 'on_task' | 'off_task' | 'unknown';

export interface Signal {
  app: string | null;
  title: string | null;
  host?: string | null;
  pageTitle?: string | null;
}

export type RuleEffect = 'allow' | 'deny';

export interface Rule {
  id?: number;
  taskId: number | null;
  pattern: string;
  effect: RuleEffect;
}

export type TaskStatus = 'active' | 'backlog' | 'done';

export interface Task {
  id: number;
  title: string;
  priority: number;
  status: TaskStatus;
}

export interface SignalSource {
  start(onSignal: (s: Signal) => void): Promise<void>;
  stop(): Promise<void>;
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
  | {action: 'dismiss' | 'ack' | 'defer' | 'promote' | 'settings'}
  | {action: 'snooze'; minutes: number}
  | {action: 'override'; kind: 'allow_app_today' | 'notify_only_today'};

export interface Notifier {
  flash(text: string): Promise<void>;
  ack(title: string, body: string): Promise<void>;
  overlay(payload: OverlayPayload): Promise<void>;
}

export interface ActionSource {
  onAction(cb: (a: OverlayAction) => void): void;
}

export interface Tab {
  host: string | null;
  pageTitle: string | null;
}

export interface TabSource {
  start(onTab: (t: Tab) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface IdleMonitor {
  idleMs(): Promise<number>;
}
