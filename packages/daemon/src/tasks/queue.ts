import type {Task} from '../types.js';

const byPriority = (a: Task, b: Task) => a.priority - b.priority || a.id - b.id;

export function activeTask(tasks: Task[]): Task | null {
  return tasks.filter(t => t.status === 'active').sort(byPriority)[0] ?? null;
}

export function promote(tasks: Task[], id: number): Task[] {
  const target = tasks.find(t => t.id === id);
  if (!target) return tasks;
  const rest = tasks.filter(t => t.status === 'active' && t.id !== id).sort(byPriority);
  const untouched = tasks.filter(t => t.status !== 'active' && t.id !== id);
  return [
    {...target, status: 'active', priority: 1},
    ...rest.map((t, i) => ({...t, priority: i + 2})),
    ...untouched,
  ];
}
