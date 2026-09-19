import {createServer, type Server} from 'node:http';
import {afterEach, describe, expect, it} from 'vitest';
import {OllamaClassifier} from './ollama.js';

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
  it('returns unknown quickly when the model hangs past the timeout', async () => {
    const url = await serve(() => {});
    const c = new OllamaClassifier({url, model: 'x', timeoutMs: 200});
    const t = Date.now();
    expect((await c.classify(sig, task)).verdict).toBe('unknown');
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('returns unknown on garbage output', async () => {
    const url = await serve((_req, res) => res.end(JSON.stringify({message: {content: 'not json'}})));
    expect((await new OllamaClassifier({url, model: 'x', timeoutMs: 1000}).classify(sig, task)).verdict).toBe('unknown');
  });

  it('returns unknown when the server is down', async () => {
    const c = new OllamaClassifier({url: 'http://127.0.0.1:1', model: 'x', timeoutMs: 1000});
    expect((await c.classify(sig, task)).verdict).toBe('unknown');
  });

  it('parses a valid verdict', async () => {
    const url = await serve((_req, res) => res.end(JSON.stringify({message: {content: '{"verdict":"off_task","reason":"video editing"}'}})));
    const v = await new OllamaClassifier({url, model: 'x', timeoutMs: 1000}).classify(sig, task);
    expect(v).toEqual({verdict: 'off_task', reason: 'video editing'});
  });
});
