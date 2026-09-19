import {createServer, type Server} from 'node:http';

const MAX_BODY = 16_384;

export interface Reply {
  status: number;
  json?: unknown;
  html?: string;
}
export type Route = (method: string, path: string, body: unknown) => Reply | Promise<Reply>;

export class LocalServer {
  private server: Server | null = null;

  constructor(private readonly port: number, private readonly route: Route) {}

  start(): Promise<void> {
    if (this.server) return Promise.resolve();
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        let raw = '';
        req.on('data', chunk => {
          raw += chunk;
          if (raw.length > MAX_BODY) req.destroy();
        });
        req.on('end', async () => {
          let body: unknown = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            res.writeHead(400).end();
            return;
          }
          try {
            const r = await this.route(req.method ?? 'GET', req.url ?? '/', body);
            if (r.html) res.writeHead(r.status, {'content-type': 'text/html; charset=utf-8'}).end(r.html);
            else if (r.json !== undefined) res.writeHead(r.status, {'content-type': 'application/json'}).end(JSON.stringify(r.json));
            else res.writeHead(r.status).end();
          } catch (err) {
            res.writeHead(500, {'content-type': 'application/json'}).end(JSON.stringify({error: (err as Error).message}));
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
