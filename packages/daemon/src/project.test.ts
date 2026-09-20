import {describe, expect, it} from 'vitest';
import {parseProject, syncProject} from './project.js';
import {Store} from './store/db.js';
import {activeTask} from './tasks/queue.js';

const FILE = `# notes are ignored
task: Build website
allow: code, localhost, figma.com
deny: youtube.com, kdenlive
Deny: netflix.com
`;

describe('FOCUS.md', () => {
  it('parses task, allow and deny lines and ignores everything else', () => {
    expect(parseProject(FILE)).toEqual({task: 'Build website', allow: ['code', 'localhost', 'figma.com'], deny: ['youtube.com', 'kdenlive', 'netflix.com']});
  });

  it('sync replaces file rules but keeps learned and manual rules', () => {
    const store = Store.memory();
    const first = syncProject(store, parseProject(FILE));
    store.addRule({taskId: first.taskId, pattern: 'whatsapp', effect: 'allow', source: 'learned'});
    store.addRule({taskId: null, pattern: 'tiktok', effect: 'deny'});
    syncProject(store, parseProject('task: Build website\ndeny: youtube.com'));
    const patterns = store.rules().map(r => `${r.taskId === null ? 'g' : 't'}:${r.effect}:${r.pattern}`).sort();
    expect(patterns).toEqual(['g:deny:tiktok', 't:allow:whatsapp', 't:deny:youtube.com']);
  });

  it('sync reuses a task with the same title and makes it active', () => {
    const store = Store.memory();
    store.addTask('Other thing');
    const a = syncProject(store, parseProject(FILE));
    const b = syncProject(store, parseProject(FILE));
    expect(b.taskId).toBe(a.taskId);
    expect(store.tasks().filter(t => t.status !== 'done')).toHaveLength(2);
    expect(activeTask(store.tasks())?.id).toBe(a.taskId);
  });

  it('global sync scopes rules to no task', () => {
    const store = Store.memory();
    syncProject(store, parseProject('deny: reddit.com'), {global: true});
    expect(store.rules()).toEqual([expect.objectContaining({taskId: null, pattern: 'reddit.com', effect: 'deny', source: 'file'})]);
  });
});
