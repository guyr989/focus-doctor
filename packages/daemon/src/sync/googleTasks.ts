import {createServer} from 'node:http';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {spawn} from 'node:child_process';

const SCOPE = 'https://www.googleapis.com/auth/tasks';
const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://tasks.googleapis.com/tasks/v1/lists/@default/tasks';

interface Credentials {
  client_id: string;
  client_secret: string;
}
interface Token {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function openInBrowser(url: string): void {
  spawn('xdg-open', [url], {detached: true, stdio: 'ignore'}).unref();
}

export class GoogleTasks {
  constructor(private readonly credentialsPath: string, private readonly tokenPath: string) {}

  configured(): boolean {
    return existsSync(this.credentialsPath) && existsSync(this.tokenPath);
  }

  private credentials(): Credentials {
    if (!existsSync(this.credentialsPath))
      throw new Error(`missing ${this.credentialsPath} — see README "Google Tasks" for how to create it`);
    return JSON.parse(readFileSync(this.credentialsPath, 'utf8')) as Credentials;
  }

  async login(): Promise<void> {
    const {client_id, client_secret} = this.credentials();
    const {code, redirect} = await new Promise<{code: string; redirect: string}>((resolve, reject) => {
      let redirect = '';
      const server = createServer((req, res) => {
        const c = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('code');
        res.end(c ? 'Focus Monitor is connected to Google Tasks. You can close this tab.' : 'missing code');
        server.close();
        c ? resolve({code: c, redirect}) : reject(new Error('no code in callback'));
      }).listen(0, '127.0.0.1', () => {
        redirect = `http://127.0.0.1:${(server.address() as {port: number}).port}`;
        const url = new URL(AUTH);
        url.search = new URLSearchParams({
          client_id, redirect_uri: redirect, response_type: 'code',
          scope: SCOPE, access_type: 'offline', prompt: 'consent',
        }).toString();
        console.log(`Opening browser for Google sign-in… (or visit)\n${url}`);
        openInBrowser(url.toString());
      });
    });
    const token = await this.exchange({code, redirect_uri: redirect, grant_type: 'authorization_code', client_id, client_secret});
    this.save(token);
    console.log(`connected; token saved to ${this.tokenPath}`);
  }

  private async exchange(params: Record<string, string>): Promise<Token> {
    const res = await fetch(TOKEN, {method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(params)});
    const data = (await res.json()) as {access_token?: string; refresh_token?: string; expires_in?: number; error_description?: string};
    if (!res.ok || !data.access_token) throw new Error(data.error_description ?? `token http ${res.status}`);
    const previous = existsSync(this.tokenPath) ? (JSON.parse(readFileSync(this.tokenPath, 'utf8')) as Token) : null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? previous?.refresh_token ?? '',
      expires_at: Date.now() + (data.expires_in ?? 3600) * 1000 - 60_000,
    };
  }

  private save(token: Token): void {
    mkdirSync(dirname(this.tokenPath), {recursive: true});
    writeFileSync(this.tokenPath, JSON.stringify(token), {mode: 0o600});
  }

  private async accessToken(): Promise<string> {
    let token = JSON.parse(readFileSync(this.tokenPath, 'utf8')) as Token;
    if (Date.now() >= token.expires_at) {
      const {client_id, client_secret} = this.credentials();
      token = await this.exchange({refresh_token: token.refresh_token, grant_type: 'refresh_token', client_id, client_secret});
      this.save(token);
    }
    return token.access_token;
  }

  async push(title: string, notes: string): Promise<void> {
    const res = await fetch(API, {
      method: 'POST',
      headers: {authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json'},
      body: JSON.stringify({title, notes}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`google tasks http ${res.status}`);
  }
}
