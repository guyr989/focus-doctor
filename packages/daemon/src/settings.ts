import type {Store} from './store/db.js';

export const DEFAULTS = {
  thresholds: '120,300,600',
  cooldown_seconds: '300',
  reset_after_on_task_seconds: '60',
  idle_after_seconds: '90',
  heartbeat_seconds: '30',
  llm_enabled: '1',
  ollama_model: 'qwen2.5:3b',
  max_level: '3',
  max_level_until: '0',
  snoozed_until: '0',
  last_snooze_minutes: '5',
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export const DESCRIPTIONS: Record<SettingKey, string> = {
  thresholds: 'seconds of drift before level 1, 2, 3 (comma separated)',
  cooldown_seconds: 'seconds before the same level can fire again',
  reset_after_on_task_seconds: 'seconds back on task before drift is forgiven',
  idle_after_seconds: 'seconds without input before you count as away',
  heartbeat_seconds: 'how often the daemon re-evaluates',
  llm_enabled: '1 to ask the local AI about unknown windows, 0 for rules only',
  ollama_model: 'Ollama model name',
  max_level: 'highest intervention level allowed (1–3)',
  max_level_until: 'unix ms until which max_level applies (0 = always)',
  snoozed_until: 'unix ms until which interventions are paused',
  last_snooze_minutes: 'default snooze shown in the overlay',
};

export class Settings {
  constructor(private readonly store: Store) {}

  get(key: SettingKey): string {
    return process.env[`FOCUS_${key.toUpperCase()}`] ?? this.store.getSetting(key) ?? DEFAULTS[key];
  }

  number(key: SettingKey): number {
    return Number(this.get(key));
  }

  numbers(key: SettingKey): number[] {
    return this.get(key).split(',').map(Number).filter(n => !Number.isNaN(n));
  }

  set(key: string, value: string | number): void {
    if (!(key in DEFAULTS)) throw new Error(`unknown setting "${key}"; known: ${Object.keys(DEFAULTS).join(', ')}`);
    this.store.setSetting(key, value);
  }

  all(): Record<SettingKey, string> {
    return Object.fromEntries((Object.keys(DEFAULTS) as SettingKey[]).map(k => [k, this.get(k)])) as Record<SettingKey, string>;
  }
}
