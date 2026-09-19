import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import type {Rule, Task, TaskStatus, Verdict} from '../types.js';

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

export class Store {
  private constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
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

  rules(): Rule[] {
    return (this.db.prepare('SELECT id, task_id AS taskId, pattern, effect FROM rules').all() as unknown) as Rule[];
  }

  addRule(rule: Rule): void {
    this.db.prepare('INSERT INTO rules (task_id, pattern, effect) VALUES (?, ?, ?)').run(rule.taskId, rule.pattern, rule.effect);
  }

  recordSample(s: Sample): void {
    this.db
      .prepare('INSERT INTO samples (ts, app, title, host, verdict, task_id, drift_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(s.ts, s.app, s.title, s.host, s.verdict, s.taskId, Math.round(s.driftSeconds));
  }

  close(): void {
    this.db.close();
  }
}
