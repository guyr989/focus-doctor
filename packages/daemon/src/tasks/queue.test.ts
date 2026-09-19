import {describe, expect, it} from 'vitest';
import {activeTask, promote} from './queue.js';
import type {Task} from '../types.js';

const tasks: Task[] = [
  {id: 1, title: 'client invoice', priority: 2, status: 'active'},
  {id: 2, title: 'ship mockup', priority: 1, status: 'active'},
  {id: 3, title: 'old thing', priority: 0, status: 'done'},
  {id: 4, title: 'someday', priority: 0, status: 'backlog'},
];

describe('task queue', () => {
  it('picks the active task with the smallest priority number', () => {
    expect(activeTask(tasks)?.id).toBe(2);
  });

  it('ignores done and backlog tasks', () => {
    expect(activeTask(tasks.filter(t => t.id !== 2))?.id).toBe(1);
    expect(activeTask(tasks.filter(t => t.status !== 'active'))).toBeNull();
  });

  it('promote moves a task to the top and keeps the others in order', () => {
    const out = promote(tasks, 1).filter(t => t.status === 'active').sort((a, b) => a.priority - b.priority);
    expect(out.map(t => t.id)).toEqual([1, 2]);
    expect(out[0].priority).toBe(1);
    expect(out[1].priority).toBe(2);
  });
});
