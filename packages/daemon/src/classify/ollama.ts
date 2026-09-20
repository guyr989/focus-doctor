import {signalText} from './rules.js';
import type {Signal, Task} from '../types.js';

/** pOff = probability the screen is off task; null = the model could not decide (fail open). */
export interface LlmDecision {
  pOff: number | null;
  reason: string;
}

export interface OllamaOptions {
  url: string;
  model: string;
  timeoutMs: number;
  keepAlive?: string;
}

const SYSTEM = 'Apply the supplied criterion to the supplied evidence. Choose exactly one listed option. Respond with only its uppercase letter, with no explanation.';
const OPTIONS = [
  {letter: 'A', description: 'on task — plausibly part of doing the task (its tools, docs, research, or communication for it)'},
  {letter: 'B', description: 'off task — leisure, entertainment, or a different project'},
];
const HARD_VOTE = {A: 0.15, B: 0.85} as const;

interface TokenLogprob {
  token: string;
  logprob: number;
}
interface ChatResponse {
  message?: {content?: string};
  logprobs?: {token: string; logprob: number; top_logprobs?: TokenLogprob[]}[];
}

export function decide(data: ChatResponse): LlmDecision {
  const top = data.logprobs?.[0]?.top_logprobs ?? [];
  const lp = (letter: string) => top.find(t => t.token.trim() === letter)?.logprob;
  const a = lp('A');
  const b = lp('B');
  if (a !== undefined && b !== undefined) {
    const pOff = 1 / (1 + Math.exp(a - b));
    return {pOff, reason: `off ${pOff.toFixed(2)}`};
  }
  const letter = data.message?.content?.trim().toUpperCase();
  if (letter === 'A' || letter === 'B') return {pOff: HARD_VOTE[letter], reason: `off ${HARD_VOTE[letter]} (vote)`};
  return {pOff: null, reason: 'no decision'};
}

export class OllamaClassifier {
  constructor(public opts: OllamaOptions) {}

  async classify(signal: Signal, task: Task): Promise<LlmDecision> {
    try {
      const res = await fetch(`${this.opts.url}/api/chat`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        body: JSON.stringify({
          model: this.opts.model,
          stream: false,
          logprobs: true,
          top_logprobs: 10,
          keep_alive: this.opts.keepAlive ?? '10m',
          options: {temperature: 0, num_predict: 1},
          messages: [
            {role: 'system', content: SYSTEM},
            {
              role: 'user',
              content: JSON.stringify({
                evidence: `Task: ${task.title}\nOn screen: ${signalText(signal)}`,
                criterion: 'What is on screen is unrelated to the task',
                options: OPTIONS,
              }),
            },
          ],
        }),
      });
      if (!res.ok) return {pOff: null, reason: `http ${res.status}`};
      return decide((await res.json()) as ChatResponse);
    } catch (err) {
      return {pOff: null, reason: (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message};
    }
  }

  async available(): Promise<{ok: boolean; models: string[]}> {
    try {
      const res = await fetch(`${this.opts.url}/api/tags`, {signal: AbortSignal.timeout(2000)});
      const data = (await res.json()) as {models?: {name: string}[]};
      return {ok: res.ok, models: (data.models ?? []).map(m => m.name)};
    } catch {
      return {ok: false, models: []};
    }
  }
}
