import {cacheKey, type VerdictCache} from './cache.js';
import type {OllamaClassifier} from './ollama.js';
import {matchRules} from './rules.js';
import type {Rule, Signal, Task, Verdict} from '../types.js';

const UNAVAILABLE_LOG_INTERVAL_MS = 10 * 60 * 1000;

/** A verdict and, in a few words, where it came from — so an `unknown` is never silent. */
export interface Judgment {
  verdict: Verdict;
  reason: string;
}

export class ClassifierChain {
  private inFlight = new Map<string, Promise<Judgment>>();
  private unavailableLoggedAt = 0;

  constructor(
    private readonly cache: VerdictCache,
    private readonly llm: OllamaClassifier | null,
    private readonly log: (msg: string) => void,
    private readonly enabled: () => boolean = () => true,
    private readonly threshold: () => number = () => 0.6,
  ) {}

  async classify(signal: Signal, task: Task, rules: Rule[], nowMs: number): Promise<Judgment> {
    const byRule = matchRules(signal, rules, task.id);
    if (byRule !== 'unknown') return {verdict: byRule, reason: 'rule'};
    if (!this.llm) return {verdict: 'unknown', reason: 'no llm configured'};
    if (!this.enabled()) return {verdict: 'unknown', reason: 'llm disabled'};
    const key = cacheKey(task.id, signal);
    const cached = this.cache.get(key, nowMs);
    if (cached) {
      if (cached.probability === null) return {verdict: cached.verdict, reason: 'cache'};
      return {verdict: this.fromProbability(cached.probability), reason: `off ${cached.probability.toFixed(2)} (cache)`};
    }
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.ask(key, signal, task, nowMs).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  private fromProbability(pOff: number): Verdict {
    return pOff >= this.threshold() ? 'off_task' : 'on_task';
  }

  private async ask(key: string, signal: Signal, task: Task, nowMs: number): Promise<Judgment> {
    const started = Date.now();
    const {pOff, reason} = await this.llm!.classify(signal, task);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (pOff === null) {
      if (nowMs - this.unavailableLoggedAt >= UNAVAILABLE_LOG_INTERVAL_MS) {
        this.unavailableLoggedAt = nowMs;
        this.log(`llm unavailable (${reason}) — treating as on task`);
      }
      return {verdict: 'unknown', reason};
    }
    const verdict = this.fromProbability(pOff);
    this.cache.set(key, task.id, verdict, pOff, reason, nowMs);
    this.log(`llm ${verdict} (${reason}) in ${secs}s: "${signal.title ?? signal.app}"`);
    return {verdict, reason};
  }
}
