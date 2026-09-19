import {signalText} from './rules.js';
import type {Signal, Task, Verdict} from '../types.js';

export interface LlmVerdict {
  verdict: Verdict;
  reason: string;
}

export interface OllamaOptions {
  url: string;
  model: string;
  timeoutMs: number;
  keepAlive?: string;
}

const SYSTEM = `You judge whether what a person has on screen serves the task they declared.
Answer only JSON: {"verdict":"on_task"|"off_task","reason":"<10 words"}.
on_task = plausibly part of doing the task (docs, tools, research for it).
off_task = clearly leisure or a different project. When unsure, answer on_task.`;

const SCHEMA = {
  type: 'object',
  properties: {verdict: {type: 'string', enum: ['on_task', 'off_task']}, reason: {type: 'string'}},
  required: ['verdict', 'reason'],
};

export class OllamaClassifier {
  constructor(private readonly opts: OllamaOptions) {}

  async classify(signal: Signal, task: Task): Promise<LlmVerdict> {
    try {
      const res = await fetch(`${this.opts.url}/api/chat`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        signal: AbortSignal.timeout(this.opts.timeoutMs),
        body: JSON.stringify({
          model: this.opts.model,
          stream: false,
          format: SCHEMA,
          keep_alive: this.opts.keepAlive ?? '10m',
          options: {temperature: 0},
          messages: [
            {role: 'system', content: SYSTEM},
            {role: 'user', content: `Task: ${task.title}\nOn screen: ${signalText(signal)}`},
          ],
        }),
      });
      if (!res.ok) return {verdict: 'unknown', reason: `http ${res.status}`};
      const data = (await res.json()) as {message?: {content?: string}};
      const parsed = JSON.parse(data.message?.content ?? '') as Partial<LlmVerdict>;
      if (parsed.verdict !== 'on_task' && parsed.verdict !== 'off_task') return {verdict: 'unknown', reason: 'bad verdict'};
      return {verdict: parsed.verdict, reason: String(parsed.reason ?? '')};
    } catch (err) {
      return {verdict: 'unknown', reason: (err as Error).name === 'TimeoutError' ? 'timeout' : (err as Error).message};
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
