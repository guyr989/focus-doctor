import {homedir} from 'node:os';
import {join} from 'node:path';

export const config = {
  dbPath: process.env.FOCUS_DB ?? join(homedir(), '.local/share/focus-monitor/focus.db'),
  heartbeatSeconds: Number(process.env.FOCUS_HEARTBEAT ?? 30),
  resetAfterOnTaskSeconds: 60,
  thresholds: process.env.FOCUS_THRESHOLDS?.split(',').map(Number) ?? [120, 300, 600],
  cooldownSeconds: 300,
};

export type Config = typeof config;
