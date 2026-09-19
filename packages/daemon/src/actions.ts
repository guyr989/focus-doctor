import {config} from './config.js';
import type {Store} from './store/db.js';
import {openInBrowser} from './sync/googleTasks.js';
import {promote} from './tasks/queue.js';
import type {OverlayAction, Signal, Task} from './types.js';

export interface ActionContext {
  task: Task;
  signal: Signal;
  nowMs: number;
}

export interface ActionEffect {
  resetDrift?: boolean;
  message: string;
}

export function describeSignal(s: Signal): string {
  if (s.host) return `${s.host}: ${s.pageTitle ?? ''}`.trim();
  return s.title ?? s.app ?? 'untitled';
}

function endOfDayMs(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function applyAction(store: Store, action: OverlayAction, ctx: ActionContext): ActionEffect {
  switch (action.action) {
    case 'snooze': {
      const until = ctx.nowMs + action.minutes * 60_000;
      store.setSetting('snoozed_until', until);
      store.setSetting('last_snooze_minutes', action.minutes);
      return {message: `snoozed ${action.minutes} min`};
    }
    case 'promote': {
      const t = store.addTask(describeSignal(ctx.signal), 'active', 'promoted');
      store.saveTasks(promote(store.tasks(), t.id));
      store.addRule({taskId: t.id, pattern: ctx.signal.host ?? ctx.signal.app ?? t.title, effect: 'allow'});
      return {resetDrift: true, message: `new top task #${t.id}: ${t.title}`};
    }
    case 'defer': {
      const t = store.addTask(describeSignal(ctx.signal), 'backlog', 'deferred');
      store.enqueueSync(t.id);
      return {message: `saved for later as #${t.id}: ${t.title}`};
    }
    case 'override': {
      const until = endOfDayMs(ctx.nowMs);
      if (action.kind === 'allow_app_today') {
        const pattern = ctx.signal.host ?? ctx.signal.app ?? '';
        store.addRule({taskId: ctx.task.id, pattern, effect: 'allow'}, Math.floor(until / 1000));
        return {resetDrift: true, message: `allowing "${pattern}" for today`};
      }
      store.setSetting('notify_only_until', until);
      return {message: 'notifications only for the rest of today'};
    }
    case 'settings':
      openInBrowser(`http://127.0.0.1:${config.port}/`);
      return {message: 'opening settings page'};
    default:
      return {message: action.action};
  }
}
