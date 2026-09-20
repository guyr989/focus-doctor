import {cacheKey, type VerdictCache} from './cache.js';
import type {OllamaClassifier} from './ollama.js';
import {matchRules} from './rules.js';
import type {Rule, Signal, Task, Verdict} from '../types.js';

const UNAVAILABLE_LOG_INTERVAL_MS = 10 * 60 * 1000;

export class ClassifierChain {
  private inFlight = new Map<string, Promise<Verdict>>();
  private unavailableLoggedAt = 0;

  constructor(
    private readonly cache: VerdictCache,
    private readonly llm: OllamaClassifier | null,
    private readonly log: (msg: string) => void,
    private readonly enabled: () => boolean = () => true,
    private readonly threshold: () => number = () => 0.7,
  ) {}

  async classify(signal: Signal, task: Task, rules: Rule[], nowMs: number): Promise<Verdict> {
    const byRule = matchRules(signal, rules, task.id);
    if (byRule !== 'unknown' || !this.llm || !this.enabled()) return byRule;
    const key = cacheKey(task.id, signal);
    const cached = this.cache.get(key, nowMs);
    if (cached) return cached.probability === null ? cached.verdict : this.fromProbability(cached.probability);
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

  private async ask(key: string, signal: Signal, task: Task, nowMs: number): Promise<Verdict> {
    const started = Date.now();
    const {pOff, reason} = await this.llm!.classify(signal, task);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (pOff === null) {
      if (nowMs - this.unavailableLoggedAt >= UNAVAILABLE_LOG_INTERVAL_MS) {
        this.unavailableLoggedAt = nowMs;
        this.log(`llm unavailable (${reason}) — treating as on task`);
      }
      return 'unknown';
    }
    const verdict = this.fromProbability(pOff);
    this.cache.set(key, task.id, verdict, pOff, reason, nowMs);
    this.log(`llm ${verdict} (${reason}) in ${secs}s: "${signal.title ?? signal.app}"`);
    return verdict;
  }
}
