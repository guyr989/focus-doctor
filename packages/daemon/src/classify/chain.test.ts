import {describe, expect, it} from 'vitest';
import {VerdictCache} from './cache.js';
import {ClassifierChain} from './chain.js';
import type {OllamaClassifier} from './ollama.js';
import {Store} from '../store/db.js';

const task = {id: 1, title: 'client invoice', priority: 1, status: 'active' as const};
const sig = {app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive'};
const chain = (llm: OllamaClassifier | null) => new ClassifierChain(new VerdictCache(Store.memory(), 3600), llm, () => {});
const fake = (classify: () => Promise<{pOff: number | null; reason: string}>) => ({classify}) as unknown as OllamaClassifier;

describe('ClassifierChain', () => {
  it('says why a window went unjudged', async () => {
    expect(await chain(null).classify(sig, task, [], 0)).toEqual({verdict: 'unknown', reason: 'no llm configured'});
    const down = fake(async () => ({pOff: null, reason: 'fetch failed'}));
    expect(await chain(down).classify(sig, task, [], 0)).toEqual({verdict: 'unknown', reason: 'fetch failed'});
  });

  it('lets a rule decide before the model is asked', async () => {
    const never = fake(async () => {
      throw new Error('model was asked');
    });
    const deny = [{taskId: null, pattern: 'kdenlive', effect: 'deny' as const}];
    expect(await chain(never).classify(sig, task, deny, 0)).toEqual({verdict: 'off_task', reason: 'rule'});
  });
});
