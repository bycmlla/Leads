/**
 * Sondagem da tela de login: abre a URL do .env, NÃO preenche nada e descreve
 * a estrutura (campos, botões, frames, captcha). Salva captura em artifacts/.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from '../lib/browser';
import { ARTIFACTS_DIR, loadConfig } from '../lib/config';
import { describeFrame } from '../lib/dom';
import { redactUrl, safeError } from '../lib/redact';

async function main() {
  const cfg = loadConfig();
  const context = await openBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(cfg.url, { waitUntil: 'commit', timeout: 60000 });
  await page.waitForLoadState('domcontentloaded', { timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const result: Record<string, unknown> = { finalUrl: redactUrl(page.url()), frames: [] as unknown[] };
  for (const frame of page.frames()) {
    try {
      const s = await describeFrame(frame);
      (result.frames as unknown[]).push({ ...s, url: redactUrl(s.url) });
    } catch (e) {
      (result.frames as unknown[]).push({ url: redactUrl(frame.url()), error: String(e).slice(0, 200) });
    }
  }
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS_DIR, 'probe-login.json'), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'probe-login.png'), fullPage: true });
  console.log(JSON.stringify(result, null, 2));
  await context.close();
}

main().catch((e) => {
  console.error('Falha na sondagem:', safeError(e));
  process.exit(1);
});
