import fs from 'node:fs';
import path from 'node:path';
import { LOGS_DIR, loadConfig } from './config';
import { scrubSecrets } from './redact';

/**
 * Logger de eventos operacionais com horário (JSON Lines em logs/<nome>-<data>.jsonl).
 * Toda linha passa por scrubSecrets para nunca conter login/senha do .env.
 */
export class EventLogger {
  private stream: fs.WriteStream;
  private secrets: string[];
  readonly file: string;

  constructor(name: string) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.file = path.join(LOGS_DIR, `${name}-${stamp}.jsonl`);
    this.stream = fs.createWriteStream(this.file, { flags: 'a' });
    const cfg = loadConfig();
    this.secrets = [cfg.login, cfg.senha];
  }

  event(type: string, data: Record<string, unknown> = {}, echo = true): void {
    const ts = new Date().toISOString();
    const line = scrubSecrets(JSON.stringify({ ts, type, ...data }), this.secrets);
    this.stream.write(line + '\n');
    if (echo) {
      const local = new Date().toLocaleTimeString('pt-BR', { hour12: false });
      const summary = scrubSecrets(JSON.stringify(data), this.secrets);
      console.log(`[${local}] ${type} ${summary.length > 2 ? summary.slice(0, 400) : ''}`);
    }
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
