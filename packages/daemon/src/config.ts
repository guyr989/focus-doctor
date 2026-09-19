import {homedir} from 'node:os';
import {join} from 'node:path';

export const config = {
  dbPath: process.env.FOCUS_DB ?? join(homedir(), '.local/share/focus-monitor/focus.db'),
  heartbeatSeconds: Number(process.env.FOCUS_HEARTBEAT ?? 30),
  resetAfterOnTaskSeconds: 60,
  thresholds: process.env.FOCUS_THRESHOLDS?.split(',').map(Number) ?? [120, 300, 600],
  cooldownSeconds: 300,
  idleAfterSeconds: 90,
  browserPort: 47113,
  llmEnabled: process.env.FOCUS_LLM !== '0',
  ollamaUrl: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
  ollamaModel: process.env.FOCUS_MODEL ?? 'qwen2.5:3b',
  ollamaTimeoutMs: 20_000,
  verdictTtlSeconds: 7 * 24 * 3600,
};

export type Config = typeof config;
