import {describe, expect, it} from 'vitest';
import {Escalator} from './escalator.js';

const s = (n: number) => n * 1000;
const make = () => new Escalator({thresholds: [120, 300, 600], cooldownSeconds: 300});

describe('Escalator', () => {
  it('stays quiet below the first threshold', () => {
    expect(make().evaluate(119, s(0))).toBeNull();
  });

  it('fires each level once as drift crosses its threshold', () => {
    const e = make();
    expect(e.evaluate(120, s(0))).toBe(1);
    expect(e.evaluate(200, s(30))).toBeNull();
    expect(e.evaluate(300, s(60))).toBe(2);
    expect(e.evaluate(650, s(90))).toBe(3);
  });

  it('re-fires the same level only after the cooldown', () => {
    const e = make();
    e.evaluate(700, s(0));
    expect(e.evaluate(800, s(100))).toBeNull();
    expect(e.evaluate(900, s(300))).toBe(3);
  });

  it('is silent while snoozed', () => {
    const e = make();
    e.snooze(s(900));
    expect(e.evaluate(700, s(10))).toBeNull();
    expect(e.evaluate(700, s(901))).toBe(3);
  });

  it('starts a fresh episode when drift returns to zero', () => {
    const e = make();
    e.evaluate(150, s(0));
    e.evaluate(0, s(60));
    expect(e.evaluate(150, s(120))).toBe(1);
  });
});
