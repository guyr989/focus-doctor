#!/usr/bin/env -S node --no-warnings
import {spawnSync} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {createInterface} from 'node:readline/promises';
import {stdin, stdout} from 'node:process';
import {DESCRIPTIONS, Settings} from './settings.js';
import {GoogleTasks, openInBrowser} from './sync/googleTasks.js';
import {OllamaClassifier} from './classify/ollama.js';
import {config} from './config.js';
import {findProjectFile, formatProject, GLOBAL_FILE, PROJECT_FILE, readProject, syncProject, type Project} from './project.js';
import {Store} from './store/db.js';
import {activeTask, promote} from './tasks/queue.js';
import type {RuleEffect} from './types.js';

const USAGE = `focus — command line for Focus Doctor

Getting started
  focus init                      guided setup for this project folder → writes ${PROJECT_FILE}
  focus init --global             guided setup of rules that apply to every project
  focus use [folder]              load the ${PROJECT_FILE} of a folder (default: here) and make its task active
  focus doctor                    check every moving part

Tasks
  focus task add <title>          add a task (goes to the bottom of the queue)
  focus task list                 show the queue; * marks the active task
  focus task promote <id>         move a task to the top
  focus task done <id>            mark a task finished

Rules  (patterns match "app | window title | site | page title", case-insensitive; /regex/ allowed)
  focus rule add [--task <id>] [allow|deny] <pattern>     default is deny, global unless --task
  focus rule remove <id|pattern>
  focus rule list

Interventions
  focus snooze <minutes>          pause interventions (0 to cancel)
  focus simulate 1|2|3            show that intervention level right now
  focus flash <text>              show a level-1 flash now

Settings & extras
  focus settings                  open the settings page in your browser
  focus config list|get <key>|set <key> <value>
  focus llm test <window title>   ask the AI how it would judge a title for the active task
  focus cache clear               forget all AI verdicts (after changing a task's wording)
  focus google login              connect Google Tasks (needs ~/.config/focus-doctor/google.json)`;

const DBUS = ['--user', 'call', 'org.guyr.FocusDoctor', '/org/guyr/FocusDoctor', 'org.guyr.FocusDoctor'];
const SAMPLE = {task: 'Client invoice PDF', app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive', driftSeconds: 600, snoozeMinutes: 5, snoozePresets: [5, 10, 15, 30, 60]};

class UsageError extends Error {}
const fail = (msg: string): never => {
  throw new UsageError(msg);
};
const sh = (cmd: string, args: string[]) => spawnSync(cmd, args, {encoding: 'utf8'});
const ok = (label: string, pass: boolean, hint = '') =>
  console.log(`${pass ? '✔' : '✘'} ${label}${pass || !hint ? '' : `  → ${hint}`}`);

async function doctor(): Promise<void> {
  const ext = sh('gnome-extensions', ['info', 'focus-doctor@guyr989']).stdout;
  ok('GNOME extension active', /State: ACTIVE/.test(ext), 'gnome-extensions enable focus-doctor@guyr989, then log out and in');
  ok('extension reachable on D-Bus', /org\.guyr\.FocusDoctor/.test(sh('busctl', ['--user', 'list']).stdout), 'extension not exporting its D-Bus name');
  ok('daemon service running', sh('systemctl', ['--user', 'is-active', 'focus-doctord']).stdout.trim() === 'active', 'systemctl --user start focus-doctord');
  const store = Store.open(config.dbPath);
  try {
    ok(`database writable (${config.dbPath})`, true);
    ok('an active task exists', activeTask(store.tasks()) !== null, 'focus init   (or: focus task add "what you should be doing")');
    ok('at least one rule exists', store.rules().length > 0, 'focus rule add youtube.com');
    const model = new Settings(store).get('ollama_model');
    const llm = await new OllamaClassifier({url: config.ollamaUrl, model, timeoutMs: 2000}).available();
    ok(`ollama reachable at ${config.ollamaUrl}`, llm.ok, 'curl -fsSL https://ollama.com/install.sh | sh   (needs sudo)');
    ok(`model ${model} pulled`, llm.models.some(m => m.startsWith(model)), `ollama pull ${model}`);
    ok('settings page reachable', await fetch(`http://127.0.0.1:${config.port}/api/state`).then(r => r.ok).catch(() => false), 'daemon not running');
  } finally {
    store.close();
  }
}

async function init(store: Store, global: boolean): Promise<void> {
  const rl = createInterface({input: stdin, output: stdout});
  const lines: string[] = [];
  let waiting: ((line: string) => void) | null = null;
  rl.on('line', line => (waiting ? (waiting = (waiting(line), null)) : lines.push(line)));
  rl.on('close', () => waiting?.(''));
  const ask = (q: string, def = ''): Promise<string> => {
    stdout.write(def ? `${q} [${def}]: ` : `${q}: `);
    return new Promise<string>(resolve => (lines.length ? resolve(lines.shift()!) : (waiting = resolve))).then(v => v.trim() || def);
  };
  const list = (s: string) => s.split(',').map(x => x.trim()).filter(Boolean);
  try {
    const path = global ? GLOBAL_FILE : join(process.cwd(), PROJECT_FILE);
    const existing = readProject(path) ?? {task: null, allow: [], deny: []};
    console.log(global ? '\nGlobal rules — apply to every project.\n' : `\nSetting up Focus Doctor for ${process.cwd()}\n`);
    const p: Project = {task: null, allow: [], deny: []};
    if (!global) {
      p.task = await ask('What is the task in this folder?', existing.task ?? basename(process.cwd()));
      console.log('  Tip: name it the way you would describe it to a colleague — the AI reads this title.\n');
    }
    console.log(`Distractions to ${global ? 'deny everywhere' : 'deny while on this task'} — apps or sites, comma separated.`);
    p.deny = list(await ask('  deny', existing.deny.join(', ') || (global ? 'youtube.com, netflix.com, reddit.com' : '')));
    console.log(`\nThings that always count as on-task${global ? ' (any project)' : ' for this task'} — Enter to skip.`);
    p.allow = list(await ask('  allow', existing.allow.join(', ')));
    mkdirSync(dirname(path), {recursive: true});
    writeFileSync(path, formatProject(p, global));
    const activate = global ? false : (await ask('\nMake this the active task now? (Y/n)', 'Y')).toLowerCase() !== 'n';
    const r = syncProject(store, p, {global, activate});
    console.log(`\nWrote ${path} and loaded ${r.rules} rule(s)${r.taskId ? ` for task #${r.taskId}` : ''}.`);
    if (!global && !readProject(GLOBAL_FILE)) console.log('Next: `focus init --global` for distractions that apply to every project.');
    if (!global) console.log(`Later: edit ${PROJECT_FILE} and run \`focus use\` here to reload, or \`focus use\` in another project to switch.`);
  } finally {
    rl.close();
  }
}

function use(store: Store, dir: string): void {
  const globalProject = readProject(GLOBAL_FILE);
  if (globalProject) syncProject(store, globalProject, {global: true});
  const path = findProjectFile(resolve(dir)) ?? fail(`no ${PROJECT_FILE} found in ${resolve(dir)} or its parents — run \`focus init\` there first`);
  const r = syncProject(store, readProject(path)!);
  console.log(`using ${path}\ntask #${r.taskId} is now active with ${r.rules} project rule(s)${globalProject ? ` + ${globalProject.allow.length + globalProject.deny.length} global` : ''}`);
}

async function main(argv: string[]): Promise<void> {
  const [group, cmd, ...rest] = argv;
  if (!group || group === '--help' || group === '-h') return console.log(USAGE);
  if (group === 'doctor') return doctor();
  if (group === 'settings') return openInBrowser(`http://127.0.0.1:${config.port}/`);
  if (group === 'google' && cmd === 'login') return new GoogleTasks(config.googleCredentialsPath, config.googleTokenPath).login();
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
    if (group === 'init') return await init(store, cmd === '--global');
    if (group === 'use') return use(store, cmd ?? '.');
    if (group === 'llm' && cmd === 'test') {
      const task = activeTask(store.tasks()) ?? fail('no active task — run `focus init` first');
      const llm = new OllamaClassifier({url: config.ollamaUrl, model: settings.get('ollama_model'), timeoutMs: config.ollamaTimeoutMs});
      const started = Date.now();
      const {pOff, reason} = await llm.classify({app: null, title: rest.join(' ')}, task);
      const threshold = settings.number('off_task_threshold');
      const verdict = pOff === null ? 'unknown (treated as on task)' : pOff >= threshold ? 'off task' : 'on task';
      console.log(`task "${task.title}"\noff-task probability: ${pOff === null ? '-' : pOff.toFixed(2)}  (threshold ${threshold})  → ${verdict}  [${reason}, ${((Date.now() - started) / 1000).toFixed(1)}s]`);
    } else if (group === 'config' && cmd === 'list') {
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
      const title = rest.join(' ') || fail('usage: focus task add <title>');
      const t = store.addTask(title);
      console.log(`added #${t.id} "${t.title}" at priority ${t.priority}`);
    } else if (group === 'task' && cmd === 'list') {
      const tasks = store.tasks();
      const active = activeTask(tasks);
      for (const t of tasks.sort((a, b) => a.priority - b.priority))
        console.log(`${t.id === active?.id ? '*' : ' '} #${t.id}  p${t.priority}  [${t.status}]  ${t.title}`);
    } else if (group === 'task' && cmd === 'promote') {
      store.saveTasks(promote(store.tasks(), Number(rest[0]) || fail('usage: focus task promote <id>')));
      console.log(`#${rest[0]} is now the active task`);
    } else if (group === 'task' && cmd === 'done') {
      store.setTaskStatus(Number(rest[0]) || fail('usage: focus task done <id>'), 'done');
      console.log(`#${rest[0]} done`);
    } else if (group === 'rule' && cmd === 'add') {
      let taskId: number | null = null;
      if (rest[0] === '--task') taskId = Number(rest.splice(0, 2)[1]) || fail('--task needs a task id');
      const effect: RuleEffect = rest[0] === 'allow' || rest[0] === 'deny' ? (rest.shift() as RuleEffect) : 'deny';
      const pattern = rest.join(' ') || fail('usage: focus rule add [--task <id>] [allow|deny] <pattern>');
      store.addRule({taskId, effect, pattern});
      console.log(`rule added: ${effect} "${pattern}"${taskId ? ` for task #${taskId}` : ' (global)'}`);
    } else if (group === 'rule' && cmd === 'remove') {
      const target = rest.join(' ') || fail('usage: focus rule remove <id|pattern>');
      const n = /^\d+$/.test(target) ? store.deleteRule(Number(target)) : store.deleteRulesByPattern(target);
      console.log(n ? `removed ${n} rule(s)` : `no rule matches "${target}" — see \`focus rule list\``);
    } else if (group === 'rule' && cmd === 'list') {
      const rules = store.rules();
      if (!rules.length) console.log('no rules yet — `focus init` or `focus rule add youtube.com`');
      for (const r of rules) console.log(`#${String(r.id).padEnd(4)} ${(r.taskId === null ? 'global' : `task ${r.taskId}`).padEnd(9)} ${r.effect.padEnd(6)} ${r.pattern}${r.source && r.source !== 'manual' ? `  (${r.source})` : ''}`);
    } else {
      fail(`unknown command "${[group, cmd].filter(Boolean).join(' ')}"`);
    }
  } finally {
    store.close();
  }
}

main(process.argv.slice(2)).catch(err => {
  console.error(err instanceof UsageError ? `${err.message}\nrun \`focus\` for usage` : `error: ${(err as Error).message}`);
  process.exit(1);
});
