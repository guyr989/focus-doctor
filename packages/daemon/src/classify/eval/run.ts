/**
 * Scores the shipped classifier against labelled window titles.
 *
 *   pnpm eval                 # the configured model
 *   pnpm eval qwen2.5:7b      # any pulled model
 *
 * It imports the real OllamaClassifier, so the prompt it measures is the prompt that ships.
 * Exits non-zero if it scores below the baseline recorded in cases.json.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {OllamaClassifier} from '../ollama.js';
import type {Task} from '../../types.js';

interface Case {
  title: string;
  label: 'on' | 'off';
}
interface Cases {
  threshold: number;
  baseline: {model: string; onTaskKept: number; offTaskCaught: number};
  suites: {task: string; cases: Case[]}[];
}

const data = JSON.parse(readFileSync(join(import.meta.dirname, 'cases.json'), 'utf8')) as Cases;
const model = process.argv[2] ?? 'qwen2.5:3b';
const url = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';
const llm = new OllamaClassifier({url, model, timeoutMs: 30000});

const {ok} = await llm.available();
if (!ok) {
  console.error(`no ollama at ${url}`);
  process.exit(2);
}

let onKept = 0;
let onTotal = 0;
let offCaught = 0;
let offTotal = 0;
let unjudged = 0;

console.log(`model ${model}   threshold ${data.threshold}\n`);
for (const suite of data.suites) {
  const task: Task = {id: 0, title: suite.task, priority: 1, status: 'active'};
  console.log(`  task: ${suite.task}`);
  for (const c of suite.cases) {
    const {pOff} = await llm.classify({app: null, title: c.title}, task);
    if (c.label === 'on') onTotal++;
    else offTotal++;
    if (pOff === null) {
      unjudged++;
      console.log(`    ?  ---- ${c.label.padEnd(3)} ${c.title}`);
      continue;
    }
    const got = pOff >= data.threshold ? 'off' : 'on';
    const hit = got === c.label;
    if (hit && c.label === 'on') onKept++;
    if (hit && c.label === 'off') offCaught++;
    console.log(`    ${hit ? '✔' : '✘'}  ${pOff.toFixed(2)} ${c.label.padEnd(3)} ${c.title}`);
  }
  console.log('');
}

const {baseline} = data;
console.log(`on task kept     ${onKept}/${onTotal}   (baseline ${baseline.onTaskKept}, ${baseline.model})`);
console.log(`off task caught  ${offCaught}/${offTotal}   (baseline ${baseline.offTaskCaught}, ${baseline.model})`);
if (unjudged) console.log(`unjudged         ${unjudged}`);

const regressed = onKept < baseline.onTaskKept || offCaught < baseline.offTaskCaught;
if (regressed && model === baseline.model) {
  console.error('\nregressed against the recorded baseline');
  process.exit(1);
}
