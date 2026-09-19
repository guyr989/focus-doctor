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

daemon.start().catch(err => {
  console.error(`cannot start: ${err.message ?? err}. Is the GNOME extension enabled?`);
  process.exit(1);
});
