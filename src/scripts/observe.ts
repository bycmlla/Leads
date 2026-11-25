/**
 * MODO DE OBSERVAÇÃO — passivo, não altera registros.
 *
 * - Guarda somente leitura ativa (src/lib/guard.ts): nenhuma escrita sai do navegador
 *   (inclui o auto-Online do primeiro acesso e o POST de Health-Check).
 * - Não clica em nada. Se um modal "Novo Lead para ser aceito!" aparecer, apenas registra.
 * - Registra em logs/observe-*.jsonl, com horário:
 *     • quadros SignalR recebidos (WebSocket, protocolo JSON com separador \x1e);
 *     • requisições XHR/fetch (método, URL sanitizada, status, duração) — sem cabeçalhos nem corpos;
 *     • mutações relevantes do DOM (modais, toasts, indicador de presença #md-inicio);
 *     • mensagens de console do portal relacionadas a SignalR;
 *     • estado da sessão (expiração).
 * - Dados pessoais de leads (nome) não são registrados; GUIDs são reduzidos a um hash curto.
 *
 * Uso: npm run observe -- [minutos]   (sem argumento: até fechar a janela / Ctrl+C)
 */
import crypto from 'node:crypto';
import type { Page } from 'playwright';
import { ensureLoggedIn, watchSession } from '../auth/session';
import { openBrowser } from '../lib/browser';
import { loadConfig } from '../lib/config';
import { installReadOnlyGuard } from '../lib/guard';
import { EventLogger } from '../lib/logger';
import { GUID_RE, redactText, redactUrl, safeError } from '../lib/redact';

const RS = '\x1e';
const shortHash = (v: unknown) => (v ? crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 10) : null);
const maskGuids = (s: string) => s.replace(GUID_RE, '<guid>');

/** Script injetado na página: observa DOM e reporta via binding exposto. Não altera nada. */
function domObserverScript() {
  const report = (data: unknown) => {
    try {
      (window as any).__dioneObserve?.(data);
    } catch {}
  };
  const txt = (el: Element | null) => ((el as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const describe = (el: Element) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    cls: (el.getAttribute('class') || '').slice(0, 120),
    titulo: txt(el.querySelector('.modal-title-alerta, .modal-title, h1, .toast-header, strong')),
    botoes: Array.from(el.querySelectorAll('button')).map((b) => ({ id: b.id || null, texto: txt(b).slice(0, 40), onclick: (b.getAttribute('onclick') || '').split('(')[0] || null })),
  });
  const INTERESTING = '.modal, .md-modal-newLead, .md-modal-openLead, .toast, .alert, [role=alert], [role=dialog], .notification';
  const start = () => {
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') {
          const el = m.target as Element;
          if (el.id === 'md-inicio') report({ kind: 'presenca-dom', cls: el.getAttribute('class'), title: el.getAttribute('title') });
          else if (el.matches?.('.md-modal-newLead, .md-modal-openLead') && m.attributeName === 'class')
            report({ kind: 'modal-classe', ...describe(el) });
          continue;
        }
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          const hits = n.matches(INTERESTING) ? [n] : Array.from(n.querySelectorAll(INTERESTING));
          for (const h of hits.slice(0, 5)) report({ kind: 'elemento-adicionado', ...describe(h) });
        });
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'title'] });
    report({ kind: 'observador-dom-ativo', url: location.pathname });
  };
  if (!/^https?:/.test(location.protocol)) return; // ignora about:blank / iframes vazios
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
}

async function main() {
  const cfg = loadConfig();
  const minutes = Number(process.argv[2]) || 0;
  const log = new EventLogger('observe');
  const context = await openBrowser();
  const guard = await installReadOnlyGuard(context, log, cfg.url);

  let myContactId: string | null = null;
  const stats = { wsFrames: 0, pings: 0, xhr: 0 };

  // --- DOM ---
  await context.exposeBinding('__dioneObserve', (_src, data: Record<string, unknown>) => {
    const clean = JSON.parse(maskGuids(redactText(JSON.stringify(data), 2000)));
    const isLead = /md-modal-newLead|md-modal-openLead|Novo Lead|Lead ainda/i.test(JSON.stringify(data));
    log.event(isLead ? 'NOVA-OPORTUNIDADE-DOM' : 'dom', clean, isLead || data.kind !== 'elemento-adicionado');
  });
  await context.addInitScript(domObserverScript);

  const attach = (page: Page) => {
    // --- Console do portal (SignalR) ---
    page.on('console', (msg) => {
      const t = msg.text();
      if (!/signalr|validating|health-check|connection/i.test(t)) return;
      // Health-Check de outros usuários é volumoso e já aparece no quadro SignalR.
      if (/Health-Check/i.test(t)) return;
      const semUrls = t.replace(/(wss?|https?):\/\/[^\s"')]+/g, (u) => u.replace(/\?.*$/, '?…'));
      log.event('console', { nivel: msg.type(), texto: maskGuids(redactText(semUrls, 200)) });
    });

    // --- WebSocket / SignalR ---
    page.on('websocket', (ws) => {
      log.event('websocket-aberto', { url: redactUrl(ws.url()) });
      ws.on('close', () => log.event('websocket-fechado', { url: redactUrl(ws.url()) }));
      ws.on('socketerror', (err) => log.event('websocket-erro', { erro: redactText(String(err), 200) }));
      ws.on('framereceived', ({ payload }) => {
        stats.wsFrames++;
        const text = typeof payload === 'string' ? payload : payload.toString('utf8');
        for (const part of text.split(RS).filter(Boolean)) {
          let msg: any;
          try {
            msg = JSON.parse(part);
          } catch {
            log.event('ws-quadro-nao-json', { tamanho: part.length }, false);
            continue;
          }
          if (msg.type === 6) {
            stats.pings++;
            continue;
          }
          if (msg.type === 1 && msg.target === 'newMessage') {
            const m = msg.arguments?.[0] ?? {};
            const paraMim = myContactId ? String(m.usuarioid).toLowerCase() === myContactId.toLowerCase() : null;
            const isLead = /^Lead-/i.test(String(m.tipomensagem));
            const isHealth = /health-check/i.test(String(m.tipomensagem));
            // Health-Check de outros corretores: registrado só no arquivo (sem eco), para medir a cadência.
            log.event(isLead ? 'NOVA-OPORTUNIDADE-SIGNALR' : 'signalr-newMessage', {
              tipomensagem: m.tipomensagem ?? null,
              paraMim,
              leadHash: shortHash(m.leadid),
              usuarioHash: shortHash(m.usuarioid),
              campanha: m.campanha ? redactText(String(m.campanha), 80) : undefined,
              produto: m.produto ? redactText(String(m.produto), 80) : undefined,
              canal_origem: m.canal_origem ? redactText(String(m.canal_origem), 60) : undefined,
              chaves: Object.keys(m),
            }, !(isHealth && !paraMim));
          } else {
            log.event('signalr-quadro', { tipoQuadro: msg.type, target: msg.target ?? null, chaves: Object.keys(msg) });
          }
        }
      });
    });

    // --- HTTP (XHR/fetch) ---
    page.on('requestfinished', async (req) => {
      const rt = req.resourceType();
      if (rt !== 'xhr' && rt !== 'fetch') return;
      stats.xhr++;
      const res = await req.response().catch(() => null);
      const timing = req.timing();
      log.event(
        'http',
        {
          metodo: req.method(),
          url: redactUrl(req.url()),
          status: res?.status() ?? null,
          ms: timing.responseEnd > 0 ? Math.round(timing.responseEnd) : null,
          tipo: res?.headers()['content-type']?.split(';')[0] ?? null,
        },
        false,
      );
    });
    page.on('requestfailed', (req) => {
      const rt = req.resourceType();
      if (rt === 'xhr' || rt === 'fetch') log.event('http-falhou', { metodo: req.method(), url: redactUrl(req.url()), erro: req.failure()?.errorText }, false);
    });
  };

  context.pages().forEach(attach);
  context.on('page', (p) => {
    log.event('nova-aba', { url: redactUrl(p.url()) });
    attach(p);
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await ensureLoggedIn(page, log);
  guard.setAllowLogin(false);

  myContactId = await page.evaluate(() => (window as any)?.Microsoft?.Dynamic365?.Portal?.User?.contactId ?? null).catch(() => null);
  const presence = await page.evaluate(() => document.querySelector('#md-inicio')?.getAttribute('title') ?? null).catch(() => null);
  log.event('observacao-iniciada', { presencaExibida: presence, contatoIdentificado: !!myContactId, duracaoMin: minutes || 'ate-fechar' });

  const stopSession = watchSession(page, log);
  const heartbeat = setInterval(async () => {
    const st = await page
      .evaluate(() => ({
        signalR: (window as any).MD?.Portal?.SignalRNewLead?.connection?.connectionState ?? null,
        presenca: document.querySelector('#md-inicio')?.getAttribute('title') ?? null,
      }))
      .catch(() => null);
    log.event('status', { ...st, ...stats });
  }, 5 * 60_000);

  await new Promise<void>((resolve) => {
    context.on('close', () => resolve());
    process.on('SIGINT', () => resolve());
    if (minutes) setTimeout(resolve, minutes * 60_000);
  });
  clearInterval(heartbeat);
  stopSession();
  log.event('observacao-encerrada', stats);
  await log.close();
  await context.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error('Erro:', safeError(e));
  process.exit(1);
});
