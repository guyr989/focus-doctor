#!/usr/bin/env -S node --no-warnings
import {GnomeShell} from './adapters/gnome.js';
import {VerdictCache} from './classify/cache.js';
import {ClassifierChain} from './classify/chain.js';
import {OllamaClassifier} from './classify/ollama.js';
import {config} from './config.js';
import {Daemon} from './daemon.js';
import {BrowserIngest} from './ingest/browser.js';
import {Store} from './store/db.js';

const store = Store.open(config.dbPath);
const shell = new GnomeShell();
const llm = config.llmEnabled ? new OllamaClassifier({url: config.ollamaUrl, model: config.ollamaModel, timeoutMs: config.ollamaTimeoutMs}) : null;
const classifier = new ClassifierChain(new VerdictCache(store, config.verdictTtlSeconds), llm, console.log);
const daemon = new Daemon({source: shell, notifier: shell, idle: shell, actions: shell, classifier, tabs: new BrowserIngest(config.browserPort), store, config});

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
