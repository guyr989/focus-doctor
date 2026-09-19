import {describe, expect, it} from 'vitest';
import {DriftEngine} from './engine.js';

const s = (n: number) => n * 1000;

describe('DriftEngine', () => {
  it('accrues drift seconds while off task', () => {
    const e = new DriftEngine({resetAfterOnTaskSeconds: 60});
    e.update('off_task', s(0));
    e.update('off_task', s(30));
    expect(e.update('off_task', s(75))).toBe(75);
  });

  it('clears drift after a sustained on-task stretch', () => {
    const e = new DriftEngine({resetAfterOnTaskSeconds: 60});
    e.update('off_task', s(0));
    e.update('on_task', s(100));
    expect(e.driftSeconds).toBe(100);
    expect(e.update('on_task', s(160))).toBe(0);
  });

  it('keeps drift through a brief on-task blip', () => {
    const e = new DriftEngine({resetAfterOnTaskSeconds: 60});
    e.update('off_task', s(0));
    e.update('on_task', s(100));
    e.update('off_task', s(120));
    expect(e.update('off_task', s(150))).toBe(130);
  });

  it('treats unknown as on task (fail open)', () => {
    const e = new DriftEngine({resetAfterOnTaskSeconds: 60});
    e.update('unknown', s(0));
    expect(e.update('unknown', s(300))).toBe(0);
  });

  it('accrues nothing while idle', () => {
    const e = new DriftEngine({resetAfterOnTaskSeconds: 60});
    e.update('off_task', s(0));
    e.update('idle', s(30));
    expect(e.update('off_task', s(600))).toBe(30);
  });
});
