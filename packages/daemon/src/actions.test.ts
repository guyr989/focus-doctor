import {describe, expect, it} from 'vitest';
import {applyAction} from './actions.js';
import {Store} from './store/db.js';
import {activeTask} from './tasks/queue.js';
import type {Signal} from './types.js';

const kdenlive: Signal = {app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive'};

function setup() {
  const store = Store.memory();
  const task = store.addTask('client invoice');
  store.addRule({taskId: null, pattern: 'kdenlive', effect: 'deny'});
  return {store, ctx: {task, signal: kdenlive, nowMs: 1_700_000_000_000}};
}

describe('overlay actions', () => {
  it('promote makes the distraction the top task and allows its app', () => {
    const {store, ctx} = setup();
    applyAction(store, {action: 'promote'}, ctx);
    const top = activeTask(store.tasks());
    expect(top?.title).toBe('mockup_bg.mp4 - Kdenlive');
    expect(store.rules().some(r => r.taskId === top?.id && r.effect === 'allow' && r.pattern === 'kdenlive')).toBe(true);
  });

  it('defer saves a backlog task and leaves the active task alone', () => {
    const {store, ctx} = setup();
    applyAction(store, {action: 'defer'}, ctx);
    expect(activeTask(store.tasks())?.id).toBe(ctx.task.id);
    expect(store.tasks().filter(t => t.status === 'backlog')).toHaveLength(1);
  });

  it('snooze persists the deadline and remembers the choice', () => {
    const {store, ctx} = setup();
    applyAction(store, {action: 'snooze', minutes: 15}, ctx);
    expect(Number(store.getSetting('snoozed_until'))).toBe(ctx.nowMs + 15 * 60_000);
    expect(store.getSetting('last_snooze_minutes')).toBe('15');
  });

  it('confirm-on-task learns a permanent allow rule scoped to the active task', () => {
    const {store, ctx} = setup();
    applyAction(store, {action: 'confirm_on_task'}, ctx);
    const tenYears = Math.floor(ctx.nowMs / 1000) + 10 * 365 * 86_400;
    const rule = store.rules(tenYears).find(r => r.effect === 'allow');
    expect(rule?.taskId).toBe(ctx.task.id);
    expect(rule?.pattern).toBe('kdenlive');
  });

  it('allow-app-today rule expires at midnight', () => {
    const {store, ctx} = setup();
    applyAction(store, {action: 'override', kind: 'allow_app_today'}, ctx);
    const nowSec = Math.floor(ctx.nowMs / 1000);
    expect(store.rules(nowSec).some(r => r.effect === 'allow' && r.taskId === ctx.task.id)).toBe(true);
    expect(store.rules(nowSec + 86_400).some(r => r.effect === 'allow')).toBe(false);
  });
});
