import {cacheKey, type VerdictCache} from './cache.js';
import type {OllamaClassifier} from './ollama.js';
import {matchRules} from './rules.js';
import type {Rule, Signal, Task, Verdict} from '../types.js';

export class ClassifierChain {
  private inFlight = new Map<string, Promise<Verdict>>();

  constructor(
    private readonly cache: VerdictCache,
    private readonly llm: OllamaClassifier | null,
    private readonly log: (msg: string) => void,
  ) {}

  async classify(signal: Signal, task: Task, rules: Rule[], nowMs: number): Promise<Verdict> {
    const byRule = matchRules(signal, rules, task.id);
    if (byRule !== 'unknown' || !this.llm) return byRule;
    const key = cacheKey(task.id, signal);
    const cached = this.cache.get(key, nowMs);
    if (cached) return cached;
    let pending = this.inFlight.get(key);
    if (!pending) {
      pending = this.ask(key, signal, task, nowMs).finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    return pending;
  }

  private async ask(key: string, signal: Signal, task: Task, nowMs: number): Promise<Verdict> {
    const started = Date.now();
    const {verdict, reason} = await this.llm!.classify(signal, task);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (verdict === 'unknown') {
      this.log(`llm unavailable (${reason}) — treating as on task`);
      return 'unknown';
    }
    this.cache.set(key, task.id, verdict, reason, nowMs);
    this.log(`llm ${verdict} in ${secs}s: "${signal.title ?? signal.app}" — ${reason}`);
    return verdict;
  }
}
