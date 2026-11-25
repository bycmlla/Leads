/** Diagnóstico de carregamento: lista requisições pendentes/falhas (somente origem+caminho). */
import { openBrowser } from '../lib/browser';
import { loadConfig } from '../lib/config';
import { redactUrl, safeError } from '../lib/redact';

async function main() {
  const cfg = loadConfig();
  const context = await openBrowser();
  const page = context.pages()[0] ?? (await context.newPage());
  const pending = new Map<string, number>();
  page.on('request', (r) => pending.set(r.url(), Date.now()));
  page.on('requestfinished', (r) => pending.delete(r.url()));
  page.on('requestfailed', (r) => {
    pending.delete(r.url());
    console.log('FALHOU', r.failure()?.errorText, redactUrl(r.url()));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) console.log('HTTP', r.status(), redactUrl(r.url()));
  });
  await page.goto(cfg.url, { waitUntil: 'commit', timeout: 60000 }).catch((e) => console.log('goto:', safeError(e)));
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(5000);
    const rs = await Promise.race([
      page.evaluate(() => document.readyState).catch(() => 'erro'),
      new Promise<string>((r) => setTimeout(() => r('evaluate-travado'), 3000)),
    ]);
    console.log(`t=${(i + 1) * 5}s readyState=${rs} pendentes=${pending.size}`);
  }
  for (const [u, t] of pending) console.log('PENDENTE', Math.round((Date.now() - t) / 1000) + 's', redactUrl(u));
  await context.close();
}
main().catch((e) => {
  console.error(safeError(e));
  process.exit(1);
});
