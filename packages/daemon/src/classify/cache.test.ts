import {describe, expect, it} from 'vitest';
import {cacheKey, VerdictCache} from './cache.js';
import {Store} from '../store/db.js';

const sig = {app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive'};
const T0 = 1_700_000_000_000;

describe('VerdictCache', () => {
  it('returns what was stored for the same task and signal', () => {
    const c = new VerdictCache(Store.memory(), 3600);
    c.set(cacheKey(1, sig), 1, 'off_task', 0.9, 'video editing', T0);
    expect(c.get(cacheKey(1, sig), T0 + 1000)).toEqual({verdict: 'off_task', probability: 0.9});
  });

  it('keys differ per task so a verdict never leaks across tasks', () => {
    const c = new VerdictCache(Store.memory(), 3600);
    c.set(cacheKey(1, sig), 1, 'off_task', null, '', T0);
    expect(c.get(cacheKey(2, sig), T0)).toBeNull();
  });

  it('expires after the ttl', () => {
    const c = new VerdictCache(Store.memory(), 60);
    c.set(cacheKey(1, sig), 1, 'on_task', null, '', T0);
    expect(c.get(cacheKey(1, sig), T0 + 61_000)).toBeNull();
  });
});
