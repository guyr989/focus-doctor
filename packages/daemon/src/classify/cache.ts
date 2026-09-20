import {createHash} from 'node:crypto';
import {signalText} from './rules.js';
import type {Store} from '../store/db.js';
import type {Signal, Verdict} from '../types.js';

export function cacheKey(taskId: number, signal: Signal): string {
  return createHash('sha256').update(`${taskId}:${signalText(signal)}`).digest('hex');
}

export interface CachedVerdict {
  verdict: Verdict;
  probability: number | null;
}

export class VerdictCache {
  constructor(private readonly store: Store, private readonly ttlSeconds: number) {}

  get(key: string, nowMs: number): CachedVerdict | null {
    const row = this.store.getVerdict(key);
    if (!row || row.createdAt + this.ttlSeconds < Math.floor(nowMs / 1000)) return null;
    return {verdict: row.verdict, probability: row.probability};
  }

  set(key: string, taskId: number, verdict: Verdict, probability: number | null, reason: string, nowMs: number): void {
    this.store.putVerdict({key, taskId, verdict, probability, reason, createdAt: Math.floor(nowMs / 1000)});
  }
}
