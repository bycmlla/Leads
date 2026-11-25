import fs from 'node:fs';
import https from 'node:https';
import { chromium, type BrowserContext, type Route } from 'playwright';
import { PROFILE_DIR } from './config';

/**
 * Hosts de CDN públicos que, nesta rede, ficam travados via IPv6 (TCP conecta, TLS não completa)
 * e não fazem fallback para IPv4 — confirmado em 2026-11-24 (curl -4 = 200 em 0,3s; curl -6 = timeout).
 * Apenas recursos estáticos (GET/HEAD) desses hosts são buscados pelo Node forçando IPv4.
 * Nenhum cookie é encaminhado.
 */
const IPV4_ONLY_HOSTS = new Set(['content.powerapps.com']);

const DROP_REQ_HEADERS = new Set(['cookie', 'authorization', 'accept-encoding', 'host', 'connection']);
const DROP_RES_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'set-cookie']);

function fetchIPv4(url: string, method: string, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: Record<string, string>; body: Buffer }>((resolve, reject) => {
    const req = https.request(url, { method, family: 4, headers, timeout: 30000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v !== undefined && !DROP_RES_HEADERS.has(k)) out[k] = Array.isArray(v) ? v.join(', ') : v;
        }
        resolve({ status: res.statusCode ?? 502, headers: out, body: Buffer.concat(chunks) });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout IPv4')));
    req.on('error', reject);
    req.end();
  });
}

async function ipv4Route(route: Route) {
  const req = route.request();
  if (!['GET', 'HEAD'].includes(req.method())) return route.continue();
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers())) if (!DROP_REQ_HEADERS.has(k)) headers[k] = v;
  try {
    const res = await fetchIPv4(req.url(), req.method(), headers);
    await route.fulfill({ status: res.status, headers: res.headers, body: res.body });
  } catch {
    await route.abort('failed').catch(() => {});
  }
}

/**
 * Abre o Chromium visível com perfil persistente em .auth/chromium-profile.
 * A sessão (cookies/localStorage) fica no perfil do próprio Chromium, que no Windows
 * cifra os cookies via DPAPI do usuário — mais seguro que exportar um JSON em texto puro.
 */
export async function openBrowser(): Promise<BrowserContext> {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: null,
    args: ['--start-maximized'],
    locale: 'pt-BR',
  });
  await context.route((url) => IPV4_ONLY_HOSTS.has(url.hostname), ipv4Route);
  // O tsx/esbuild injeta o helper __name em funções serializadas para page.evaluate.
  await context.addInitScript('globalThis.__name = globalThis.__name || ((fn) => fn);');
  return context;
}
