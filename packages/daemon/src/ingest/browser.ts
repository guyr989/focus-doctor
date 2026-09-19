import {createServer, type Server} from 'node:http';
import type {Tab} from '../types.js';

const MAX_BODY = 4096;

export class BrowserIngest {
  private server: Server | null = null;

  constructor(private readonly port: number) {}

  start(onTab: (t: Tab) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/tab') {
          res.writeHead(404).end();
          return;
        }
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > MAX_BODY) req.destroy();
        });
        req.on('end', () => {
          try {
            const t = JSON.parse(body) as Partial<Tab>;
            onTab({host: t.host ?? null, pageTitle: t.pageTitle ?? null});
            res.writeHead(204).end();
          } catch {
            res.writeHead(400).end();
          }
        });
      });
      this.server.once('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => (this.server ? this.server.close(() => resolve()) : resolve()));
  }
}
