import {homedir} from 'node:os';
import {join} from 'node:path';

const configDir = join(homedir(), '.config/focus-monitor');

export const config = {
  dbPath: process.env.FOCUS_DB ?? join(homedir(), '.local/share/focus-monitor/focus.db'),
  port: Number(process.env.FOCUS_PORT ?? 47113),
  googleCredentialsPath: join(configDir, 'google.json'),
  googleTokenPath: join(configDir, 'google-token.json'),
  ollamaUrl: process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434',
  ollamaTimeoutMs: 20_000,
  verdictTtlSeconds: 7 * 24 * 3600,
};

export type Config = typeof config;
