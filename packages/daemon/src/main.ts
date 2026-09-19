#!/usr/bin/env -S node --no-warnings
import {GnomeShell} from './adapters/gnome.js';
import {VerdictCache} from './classify/cache.js';
import {ClassifierChain} from './classify/chain.js';
import {OllamaClassifier} from './classify/ollama.js';
import {config} from './config.js';
import {Daemon} from './daemon.js';
import {makeRoutes} from './http/routes.js';
import {LocalServer} from './http/server.js';
import {Settings} from './settings.js';
import {GoogleTasks} from './sync/googleTasks.js';
import {Store} from './store/db.js';

const store = Store.open(config.dbPath);
const shell = new GnomeShell();
const settings = new Settings(store);
const llm = new OllamaClassifier({url: config.ollamaUrl, model: settings.get('ollama_model'), timeoutMs: config.ollamaTimeoutMs});
const classifier = new ClassifierChain(new VerdictCache(store, config.verdictTtlSeconds), llm, console.log, () => {
  llm.opts.model = settings.get('ollama_model');
  return settings.get('llm_enabled') === '1';
});
let onTab: Parameters<typeof makeRoutes>[2] = () => {};
const server = new LocalServer(config.port, makeRoutes(store, settings, t => onTab(t)));
const tabs = {
  start: async (cb: typeof onTab) => {
    onTab = cb;
    await server.start();
  },
  stop: () => server.stop(),
};
const google = new GoogleTasks(config.googleCredentialsPath, config.googleTokenPath);
const daemon = new Daemon({source: shell, notifier: shell, idle: shell, actions: shell, classifier, tabs, google, settings, store, config});

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
