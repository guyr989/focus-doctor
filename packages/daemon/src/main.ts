#!/usr/bin/env -S node --no-warnings
import {GnomeShell} from './adapters/gnome.js';
import {config} from './config.js';
import {Daemon} from './daemon.js';
import {Store} from './store/db.js';

const store = Store.open(config.dbPath);
const shell = new GnomeShell();
const daemon = new Daemon({source: shell, notifier: shell, store, config});

const shutdown = async () => {
  await daemon.stop();
  store.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const RETRY_SECONDS = 30;
async function startWithRetry(): Promise<void> {
  for (;;) {
    try {
      await daemon.start();
      return;
    } catch (err) {
      console.error(`extension not reachable (${(err as Error).message}); retrying in ${RETRY_SECONDS}s`);
      await new Promise(r => setTimeout(r, RETRY_SECONDS * 1000));
    }
  }
}
void startWithRetry();
