#!/usr/bin/env -S node --no-warnings
import {spawnSync} from 'node:child_process';
import {DESCRIPTIONS, Settings} from './settings.js';
import {GoogleTasks, openInBrowser} from './sync/googleTasks.js';
import {VerdictCache} from './classify/cache.js';
import {ClassifierChain} from './classify/chain.js';
import {OllamaClassifier} from './classify/ollama.js';
import {config} from './config.js';
import {Store} from './store/db.js';
import {activeTask, promote} from './tasks/queue.js';
import type {RuleEffect} from './types.js';

const USAGE = `focus — command line for focus-doctor

  focus task add <title>          add a task (goes to the bottom of the queue)
  focus task list                 show the queue; * marks the active task
  focus task promote <id>         move a task to the top
  focus task done <id>            mark a task finished
  focus rule add [--task <id>] allow|deny <pattern>
                                  pattern is matched case-insensitively against
                                  "app | window title"; wrap in /.../ for a regex
  focus rule list
  focus snooze <minutes>          pause interventions (0 to cancel)
  focus simulate 1|2|3            show that intervention level right now
  focus flash <text>              show a level-1 flash now (tests the extension)
  focus settings                  open the settings page in your browser
  focus config list|get <key>|set <key> <value>
  focus google login              connect Google Tasks (needs ~/.config/focus-doctor/google.json)
  focus llm test <window title>   ask the AI how it would judge a title for the active task
  focus cache clear               forget all AI verdicts (after changing a task's wording)
  focus doctor                    check every moving part`;

const DBUS = ['--user', 'call', 'org.guyr.FocusDoctor', '/org/guyr/FocusDoctor', 'org.guyr.FocusDoctor'];
const SAMPLE = {task: 'Client invoice PDF', app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive', driftSeconds: 600, snoozeMinutes: 5, snoozePresets: [5, 10, 15, 30, 60]};

const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, {encoding: 'utf8'});
const ok = (label: string, pass: boolean, hint = '') =>
  console.log(`${pass ? '✔' : '✘'} ${label}${pass || !hint ? '' : `  → ${hint}`}`);

async function doctor(): Promise<void> {
  const ext = sh('gnome-extensions', ['info', 'focus-doctor@guyr989']).stdout;
  ok('GNOME extension active', /State: ACTIVE/.test(ext), 'gnome-extensions enable focus-doctor@guyr989, then log out and in');
  ok('extension reachable on D-Bus', /org\.guyr\.FocusDoctor/.test(sh('busctl', ['--user', 'list']).stdout), 'extension not exporting its D-Bus name');
  ok('daemon service running', sh('systemctl', ['--user', 'is-active', 'focus-doctord']).stdout.trim() === 'active', 'systemctl --user start focus-doctord');
  try {
    const store = Store.open(config.dbPath);
    ok(`database writable (${config.dbPath})`, true);
    ok('an active task exists', activeTask(store.tasks()) !== null, 'focus task add "what you should be doing"');
    ok('at least one rule exists', store.rules().length > 0, 'focus rule add deny kdenlive');
    store.close();
    const model = new Settings(Store.open(config.dbPath)).get('ollama_model');
    const llm = await new OllamaClassifier({url: config.ollamaUrl, model, timeoutMs: 2000}).available();
    ok(`ollama reachable at ${config.ollamaUrl}`, llm.ok, 'curl -fsSL https://ollama.com/install.sh | sh   (needs sudo)');
    ok(`model ${model} pulled`, llm.models.some(m => m.startsWith(model)), `ollama pull ${model}`);
    ok('settings page reachable', await fetch(`http://127.0.0.1:${config.port}/api/state`).then(r => r.ok).catch(() => false), 'daemon not running');
  } catch (e) {
    ok('database writable', false, String(e));
  }
}

async function main(argv: string[]): Promise<void> {
  const [group, cmd, ...rest] = argv;
  if (group === 'doctor') return doctor();
  if (group === 'settings') return openInBrowser(`http://127.0.0.1:${config.port}/`);
  if (group === 'google' && cmd === 'login') return new GoogleTasks(config.googleCredentialsPath, config.googleTokenPath).login();
  if (group === 'llm' && cmd === 'test') {
    const store = Store.open(config.dbPath);
    const task = activeTask(store.tasks());
    if (!task) return console.log('no active task');
    const llm = new OllamaClassifier({url: config.ollamaUrl, model: new Settings(store).get('ollama_model'), timeoutMs: config.ollamaTimeoutMs});
    const chain = new ClassifierChain(new VerdictCache(store, 0), llm, console.log);
    const verdict = await chain.classify({app: null, title: rest.join(' ')}, task, [], Date.now());
    console.log(`verdict for task "${task.title}": ${verdict}`);
    return store.close();
  }
  if (group === 'flash' || group === 'simulate') {
    const call =
      group === 'flash' ? ['ShowFlash', 's', [cmd, ...rest].join(' ')]
      : cmd === '1' ? ['ShowFlash', 's', `Off task 2 min — back to: ${SAMPLE.task}`]
      : cmd === '2' ? ['ShowAck', 's', JSON.stringify({title: 'Off task 5 min', body: `You should be on: ${SAMPLE.task}`})]
      : ['ShowOverlay', 's', JSON.stringify(SAMPLE)];
    const r = sh('busctl', [...DBUS, ...call]);
    if (r.status !== 0) console.error(r.stderr.trim() || 'extension not reachable');
    return;
  }
  const store = Store.open(config.dbPath);
  try {
    const settings = new Settings(store);
    if (group === 'config' && cmd === 'list') {
      for (const [k, v] of Object.entries(settings.all())) console.log(`${k.padEnd(28)} ${v.padEnd(14)} ${DESCRIPTIONS[k as keyof typeof DESCRIPTIONS]}`);
    } else if (group === 'config' && cmd === 'get') {
      console.log(settings.get(rest[0] as keyof typeof DESCRIPTIONS));
    } else if (group === 'config' && cmd === 'set') {
      settings.set(rest[0], rest.slice(1).join(' '));
      console.log(`${rest[0]} = ${settings.get(rest[0] as keyof typeof DESCRIPTIONS)}`);
    } else if (group === 'cache' && cmd === 'clear') {
      console.log(`forgot ${store.clearVerdicts()} verdicts`);
    } else if (group === 'snooze') {
      const minutes = Number(cmd);
      store.setSetting('snoozed_until', minutes > 0 ? Date.now() + minutes * 60_000 : 0);
      console.log(minutes > 0 ? `snoozed for ${minutes} min` : 'snooze cancelled');
    } else if (group === 'task' && cmd === 'add') {
      const t = store.addTask(rest.join(' '));
      console.log(`added #${t.id} "${t.title}" at priority ${t.priority}`);
    } else if (group === 'task' && cmd === 'list') {
      const tasks = store.tasks();
      const active = activeTask(tasks);
      for (const t of tasks.sort((a, b) => a.priority - b.priority))
        console.log(`${t.id === active?.id ? '*' : ' '} #${t.id}  p${t.priority}  [${t.status}]  ${t.title}`);
    } else if (group === 'task' && cmd === 'promote') {
      store.saveTasks(promote(store.tasks(), Number(rest[0])));
      console.log(`#${rest[0]} is now the active task`);
    } else if (group === 'task' && cmd === 'done') {
      store.setTaskStatus(Number(rest[0]), 'done');
      console.log(`#${rest[0]} done`);
    } else if (group === 'rule' && cmd === 'add') {
      let taskId: number | null = null;
      if (rest[0] === '--task') taskId = Number(rest.splice(0, 2)[1]);
      const [effect, ...pattern] = rest;
      if (effect !== 'allow' && effect !== 'deny') throw new Error(USAGE);
      store.addRule({taskId, effect: effect as RuleEffect, pattern: pattern.join(' ')});
      console.log(`rule added: ${effect} "${pattern.join(' ')}"${taskId ? ` for task #${taskId}` : ' (global)'}`);
    } else if (group === 'rule' && cmd === 'list') {
      for (const r of store.rules()) console.log(`#${r.id}  ${r.taskId === null ? 'global ' : `task ${r.taskId}`}  ${r.effect}  ${r.pattern}`);
    } else {
      console.log(USAGE);
    }
  } finally {
    store.close();
  }
}

void main(process.argv.slice(2));
