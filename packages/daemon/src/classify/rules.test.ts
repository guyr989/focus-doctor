import {describe, expect, it} from 'vitest';
import {matchRules} from './rules.js';
import type {Rule, Signal} from '../types.js';

const kdenlive: Signal = {app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive'};
const code: Signal = {app: 'Code', title: 'invoice.ts - client-app - Visual Studio Code'};

describe('matchRules', () => {
  it('deny pattern marks the signal off task', () => {
    const rules: Rule[] = [{taskId: null, pattern: 'kdenlive', effect: 'deny'}];
    expect(matchRules(kdenlive, rules, 1)).toBe('off_task');
  });

  it('allow pattern marks the signal on task', () => {
    const rules: Rule[] = [{taskId: 1, pattern: 'client-app', effect: 'allow'}];
    expect(matchRules(code, rules, 1)).toBe('on_task');
  });

  it('no matching rule yields unknown', () => {
    expect(matchRules(code, [{taskId: null, pattern: 'youtube', effect: 'deny'}], 1)).toBe('unknown');
  });

  it('task-scoped rule overrides a conflicting global rule', () => {
    const rules: Rule[] = [
      {taskId: null, pattern: 'kdenlive', effect: 'deny'},
      {taskId: 2, pattern: 'kdenlive', effect: 'allow'},
    ];
    expect(matchRules(kdenlive, rules, 2)).toBe('on_task');
    expect(matchRules(kdenlive, rules, 1)).toBe('off_task');
  });

  it('deny wins over allow at the same scope, and regex patterns work', () => {
    const rules: Rule[] = [
      {taskId: null, pattern: '/\\.mp4/', effect: 'deny'},
      {taskId: null, pattern: 'mockup', effect: 'allow'},
    ];
    expect(matchRules(kdenlive, rules, 1)).toBe('off_task');
  });
});
