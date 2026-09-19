import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {Reply, Route} from './server.js';
import {DESCRIPTIONS, type Settings} from '../settings.js';
import type {Store} from '../store/db.js';
import {activeTask, promote} from '../tasks/queue.js';
import type {Rule, Tab} from '../types.js';

const PAGE = readFileSync(join(import.meta.dirname, 'settings.html'), 'utf8');
const ok = (json?: unknown): Reply => ({status: json === undefined ? 204 : 200, json});

export function makeRoutes(store: Store, settings: Settings, onTab: (t: Tab) => void): Route {
  return (method, path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === 'POST' && path === '/tab') {
      onTab({host: (b.host as string) ?? null, pageTitle: (b.pageTitle as string) ?? null});
      return ok();
    }
    if (method === 'GET' && path === '/') return {status: 200, html: PAGE};
    if (method === 'GET' && path === '/api/state')
      return ok({tasks: store.tasks(), active: activeTask(store.tasks())?.id ?? null, rules: store.rules(), settings: settings.all(), descriptions: DESCRIPTIONS});
    if (method === 'POST' && path === '/api/tasks') return ok(store.addTask(String(b.title)));
    const task = path.match(/^\/api\/tasks\/(\d+)\/(promote|done|activate)$/);
    if (method === 'POST' && task) {
      const id = Number(task[1]);
      if (task[2] === 'done') store.setTaskStatus(id, 'done');
      else if (task[2] === 'activate') store.setTaskStatus(id, 'active');
      else store.saveTasks(promote(store.tasks(), id));
      return ok();
    }
    if (method === 'POST' && path === '/api/rules') {
      store.addRule({taskId: b.taskId ? Number(b.taskId) : null, pattern: String(b.pattern), effect: b.effect as Rule['effect']});
      return ok();
    }
    const rule = path.match(/^\/api\/rules\/(\d+)$/);
    if (method === 'DELETE' && rule) {
      store.deleteRule(Number(rule[1]));
      return ok();
    }
    if (method === 'POST' && path === '/api/settings') {
      for (const [k, v] of Object.entries(b)) settings.set(k, String(v));
      return ok();
    }
    return {status: 404};
  };
}
