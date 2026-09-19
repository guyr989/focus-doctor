import type {Rule, Signal, Verdict} from '../types.js';

export function signalText(s: Signal): string {
  return [s.app, s.title, s.host, s.pageTitle].filter(Boolean).join(' | ').toLowerCase();
}

function matches(pattern: string, text: string): boolean {
  if (pattern.length > 2 && pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      return new RegExp(pattern.slice(1, -1), 'i').test(text);
    } catch {
      return false;
    }
  }
  return text.includes(pattern.toLowerCase());
}

function decide(rules: Rule[], text: string): Verdict {
  const hits = rules.filter(r => matches(r.pattern, text));
  if (hits.some(r => r.effect === 'deny')) return 'off_task';
  if (hits.length > 0) return 'on_task';
  return 'unknown';
}

export function matchRules(signal: Signal, rules: Rule[], taskId: number): Verdict {
  const text = signalText(signal);
  const scoped = decide(rules.filter(r => r.taskId === taskId), text);
  if (scoped !== 'unknown') return scoped;
  return decide(rules.filter(r => r.taskId === null), text);
}
