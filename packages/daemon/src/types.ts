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

export interface Notifier {
  flash(text: string): Promise<void>;
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
