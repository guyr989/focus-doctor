import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {decide, OllamaClassifier} from './ollama.js';

const task = {id: 1, title: 'client invoice', priority: 1, status: 'active' as const};
const sig = {app: 'kdenlive', title: 'mockup_bg.mp4 - Kdenlive'};

let server: Server | null = null;
const serve = (handler: Parameters<typeof createServer>[1]) =>
  new Promise<string>(resolve => {
    server = createServer(handler).listen(0, '127.0.0.1', () => {
      const {port} = server!.address() as {port: number};
      resolve(`http://127.0.0.1:${port}`);
    });
  });
afterEach(() => server?.close());

describe('OllamaClassifier (fail open)', () => {
  it('returns no decision quickly when the model hangs past the timeout', async () => {
    const url = await serve(() => {});
    const c = new OllamaClassifier({url, model: 'x', timeoutMs: 200});
    const t = Date.now();
    expect((await c.classify(sig, task)).pOff).toBeNull();
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('returns no decision on garbage output', async () => {
    const url = await serve((_req, res) => res.end(JSON.stringify({message: {content: 'not a letter'}})));
    expect((await new OllamaClassifier({url, model: 'x', timeoutMs: 1000}).classify(sig, task)).pOff).toBeNull();
  });

  it('returns no decision when the server is down', async () => {
    const c = new OllamaClassifier({url: 'http://127.0.0.1:1', model: 'x', timeoutMs: 1000});
    expect((await c.classify(sig, task)).pOff).toBeNull();
  });
});

describe('decide (probability from token logprobs)', () => {
  it('normalises over the work/fun tokens only, ignoring everything else', () => {
    const d = decide({
      message: {content: 'work'},
      logprobs: [{token: 'work', logprob: -0.2, top_logprobs: [{token: 'work', logprob: -0.2}, {token: 'The', logprob: -0.9}, {token: ' fun', logprob: -1.7}]}],
    });
    expect(d.pOff).toBeCloseTo(0.18, 2);
  });

  it('sums the mass of every spelling of the same word', () => {
    const half = Math.log(0.25);
    const d = decide({
      message: {content: 'fun'},
      logprobs: [{token: 'fun', logprob: half, top_logprobs: [{token: 'fun', logprob: half}, {token: ' Fun', logprob: half}, {token: 'work', logprob: Math.log(0.5)}]}],
    });
    expect(d.pOff).toBeCloseTo(0.5, 2);
  });

  it('falls back to a hard vote when logprobs are missing', () => {
    expect(decide({message: {content: 'fun'}}).pOff).toBe(0.85);
    expect(decide({message: {content: ' Work\n'}}).pOff).toBe(0.15);
  });
});
