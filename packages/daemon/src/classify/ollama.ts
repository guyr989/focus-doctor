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

/** Unlike rules.signalText this keeps case: "Steam" and "ESPN" are brand cues the model needs. */
const screenText = (s: Signal) => [s.app, s.title, s.host, s.pageTitle].filter(Boolean).join(' | ');

const SYSTEM = 'Answer with exactly one word, either work or fun. Nothing else.';
const ON_WORD = 'work';
const OFF_WORD = 'fun';
const HARD_VOTE = {work: 0.15, fun: 0.85} as const;

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
  /** A word can be tokenised several ways ("fun", " Fun", "FUN"); sum the mass of every spelling. */
  const mass = (word: string) => top.reduce((m, t) => (t.token.trim().toLowerCase() === word ? m + Math.exp(t.logprob) : m), 0);
  const on = mass(ON_WORD);
  const off = mass(OFF_WORD);
  if (on + off > 0) {
    const pOff = off / (on + off);
    return {pOff, reason: `off ${pOff.toFixed(2)}`};
  }
  const word = data.message?.content?.trim().toLowerCase();
  if (word === ON_WORD || word === OFF_WORD) return {pOff: HARD_VOTE[word], reason: `off ${HARD_VOTE[word]} (vote)`};
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
              content:
                `Someone should be working on: ${task.title}\n\n` +
                `Their screen shows: ${screenText(signal)}\n\n` +
                'Is this screen work (related to that task) or fun (leisure, entertainment, shopping, or an unrelated project)? Answer work or fun.',
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
