import {existsSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';
import type {Store} from './store/db.js';
import {promote} from './tasks/queue.js';

export const PROJECT_FILE = 'FOCUS.md';
export const GLOBAL_FILE = join(homedir(), '.config/focus-doctor', PROJECT_FILE);

export interface Project {
  task: string | null;
  allow: string[];
  deny: string[];
}

const splitList = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean);

export function parseProject(text: string): Project {
  const p: Project = {task: null, allow: [], deny: []};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(task|allow|deny)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, key, value] = [m[0], m[1].toLowerCase(), m[2].trim()];
    if (key === 'task') p.task = value || null;
    else if (key === 'allow') p.allow.push(...splitList(value));
    else p.deny.push(...splitList(value));
  }
  return p;
}

export function formatProject(p: Project, global = false): string {
  const head = global
    ? '# Focus Doctor — global rules (apply to every project)\n# Edit freely, then run `focus use` anywhere to reload.\n'
    : '# Focus Doctor project file\n# Edit freely, then run `focus use` in this folder to reload.\n# Patterns match app name, window title, site or page title (case-insensitive); /regex/ allowed.\n';
  return [head, p.task && !global ? `task: ${p.task}` : null, `allow: ${p.allow.join(', ')}`, `deny: ${p.deny.join(', ')}`, '']
    .filter(l => l !== null)
    .join('\n');
}

export function findProjectFile(startDir: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, PROJECT_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readProject(path: string): Project | null {
  return existsSync(path) ? parseProject(readFileSync(path, 'utf8')) : null;
}

/** Loads a FOCUS.md into the daemon's database. Only rules that came from a file are replaced; manual and learned ones stay. */
export function syncProject(store: Store, p: Project, opts: {global?: boolean; activate?: boolean} = {}): {taskId: number | null; rules: number} {
  let taskId: number | null = null;
  if (!opts.global) {
    if (!p.task) throw new Error(`${PROJECT_FILE} has no "task:" line`);
    const existing = store.taskByTitle(p.task);
    taskId = existing?.id ?? store.addTask(p.task, 'active', 'project').id;
    if (existing && existing.status !== 'active') store.setTaskStatus(existing.id, 'active');
    if (opts.activate !== false) store.saveTasks(promote(store.tasks(), taskId));
  }
  store.deleteRulesBySource(taskId, 'file');
  for (const pattern of p.allow) store.addRule({taskId, pattern, effect: 'allow', source: 'file'});
  for (const pattern of p.deny) store.addRule({taskId, pattern, effect: 'deny', source: 'file'});
  return {taskId, rules: p.allow.length + p.deny.length};
}
