import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Rule, RuleSource, Task, TaskStatus, Verdict} from '../types.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, priority INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', source TEXT NOT NULL DEFAULT 'manual',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS rules (
  id INTEGER PRIMARY KEY, task_id INTEGER, pattern TEXT NOT NULL, effect TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS samples (
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, app TEXT, title TEXT, host TEXT,
  verdict TEXT NOT NULL, task_id INTEGER, drift_seconds INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT);
CREATE TABLE IF NOT EXISTS verdicts (
  key TEXT PRIMARY KEY, task_id INTEGER NOT NULL, verdict TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
`;

export interface Sample {
  ts: number;
  app: string | null;
  title: string | null;
  host: string | null;
  verdict: Verdict;
  taskId: number;
  driftSeconds: number;
}

export interface VerdictRow {
  key: string;
  taskId: number;
  verdict: Verdict;
  probability: number | null;
  reason: string;
  createdAt: number;
}

export class Store {
  private constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
    for (const sql of ['ALTER TABLE rules ADD COLUMN expires_at INTEGER', 'ALTER TABLE verdicts ADD COLUMN probability REAL', "ALTER TABLE rules ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'"]) {
      try {
        db.exec(sql);
      } catch {}
    }
  }

  static open(path: string): Store {
    mkdirSync(dirname(path), {recursive: true});
    return new Store(new DatabaseSync(path));
  }

  static memory(): Store {
    return new Store(new DatabaseSync(':memory:'));
  }

  tasks(): Task[] {
    return this.db.prepare('SELECT id, title, priority, status FROM tasks').all() as unknown as Task[];
  }

  addTask(title: string, status: TaskStatus = 'active', source = 'manual'): Task {
    const {next} = this.db.prepare('SELECT COALESCE(MAX(priority), 0) + 1 AS next FROM tasks').get() as {next: number};
    const r = this.db
      .prepare('INSERT INTO tasks (title, priority, status, source) VALUES (?, ?, ?, ?)')
      .run(title, next, status, source);
    return {id: Number(r.lastInsertRowid), title, priority: next, status};
  }

  saveTasks(tasks: Task[]): void {
    const stmt = this.db.prepare('UPDATE tasks SET priority = ?, status = ? WHERE id = ?');
    for (const t of tasks) stmt.run(t.priority, t.status, t.id);
  }

  setTaskStatus(id: number, status: TaskStatus): void {
    this.db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, id);
  }

  rules(nowSeconds = Math.floor(Date.now() / 1000)): Rule[] {
    return (this.db
      .prepare('SELECT id, task_id AS taskId, pattern, effect, source FROM rules WHERE expires_at IS NULL OR expires_at > ?')
      .all(nowSeconds) as unknown) as Rule[];
  }

  addRule(rule: Rule, expiresAtSeconds: number | null = null): void {
    this.db
      .prepare('INSERT INTO rules (task_id, pattern, effect, expires_at, source) VALUES (?, ?, ?, ?, ?)')
      .run(rule.taskId, rule.pattern, rule.effect, expiresAtSeconds, rule.source ?? 'manual');
  }

  deleteRule(id: number): number {
    return Number(this.db.prepare('DELETE FROM rules WHERE id = ?').run(id).changes);
  }

  deleteRulesByPattern(pattern: string): number {
    return Number(this.db.prepare('DELETE FROM rules WHERE lower(pattern) = lower(?)').run(pattern).changes);
  }

  deleteRulesBySource(taskId: number | null, source: RuleSource): void {
    this.db.prepare('DELETE FROM rules WHERE task_id IS ? AND source = ?').run(taskId, source);
  }

  taskByTitle(title: string): Task | null {
    return (this.db
      .prepare("SELECT id, title, priority, status FROM tasks WHERE lower(title) = lower(?) AND status != 'done' ORDER BY id LIMIT 1")
      .get(title) as unknown as Task | undefined) ?? null;
  }

  taskById(id: number): Task | null {
    return (this.db.prepare('SELECT id, title, priority, status FROM tasks WHERE id = ?').get(id) as unknown as Task | undefined) ?? null;
  }

  enqueueSync(taskId: number): void {
    this.db.prepare('INSERT INTO sync_outbox (task_id) VALUES (?)').run(taskId);
  }

  pendingSync(maxAttempts = 5): {id: number; taskId: number; attempts: number}[] {
    return this.db
      .prepare('SELECT id, task_id AS taskId, attempts FROM sync_outbox WHERE attempts < ? ORDER BY id LIMIT 10')
      .all(maxAttempts) as unknown as {id: number; taskId: number; attempts: number}[];
  }

  syncDone(id: number): void {
    this.db.prepare('DELETE FROM sync_outbox WHERE id = ?').run(id);
  }

  syncFailed(id: number, error: string): void {
    this.db.prepare('UPDATE sync_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(error, id);
  }

  getSetting(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as {value: string} | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string | number): void {
    this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
  }

  recordSample(s: Sample): void {
    this.db
      .prepare('INSERT INTO samples (ts, app, title, host, verdict, task_id, drift_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.ts, s.app, s.title, s.host, s.verdict, s.taskId, Math.round(s.driftSeconds));
  }

  /** unix seconds of the last sample that carried a site, i.e. the last time a browser reported a tab. */
  lastTabAt(): number | null {
    const row = this.db.prepare('SELECT MAX(ts) AS ts FROM samples WHERE host IS NOT NULL').get() as {ts: number | null};
    return row.ts ?? null;
  }

  getVerdict(key: string): VerdictRow | null {
    const row = this.db
      .prepare('SELECT key, task_id AS taskId, verdict, probability, reason, created_at AS createdAt FROM verdicts WHERE key = ?')
      .get(key) as unknown as VerdictRow | undefined;
    return row ?? null;
  }

  putVerdict(v: VerdictRow): void {
    this.db
      .prepare('INSERT OR REPLACE INTO verdicts (key, task_id, verdict, probability, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(v.key, v.taskId, v.verdict, v.probability, v.reason, v.createdAt);
  }

  clearVerdicts(): number {
    return Number(this.db.prepare('DELETE FROM verdicts').run().changes);
  }

  close(): void {
    this.db.close();
  }
}
