import type { BrowserContext, Request } from 'playwright';
import type { EventLogger } from './logger';
import { redactUrl } from './redact';

/**
 * Guarda SOMENTE LEITURA — instalada ANTES de qualquer navegação.
 *
 * Motivo (confirmado no código do portal, MD.Portal.Home.js): no primeiro carregamento da home
 * em cada sessão do navegador (sessionStorage "firstLogin" ausente), o portal chama sozinho
 * <AZURE_FUNCTIONS>/api/contato-atualizar-disponibilidade?disponibilidade=true → coloca o corretor ONLINE.
 * Além disso, mensagens SignalR "Health-Check" disparam POST atualizar-controle-usuario-on-off.
 *
 * Regras:
 *  - GET/HEAD/OPTIONS: liberados.
 *  - POST /SignIn no domínio do portal: liberado apenas enquanto `allowLogin` estiver ativo.
 *  - Leituras via POST conhecidas: negociação SignalR (/api/negotiate) e grades do Power Pages
 *    (/_services/entity-grid-data.json/ — endpoint de listagem, não grava).
 *  - Todo o resto (POST/PUT/PATCH/DELETE/MERGE) é abortado e registrado.
 */
export interface Guard {
  setAllowLogin(v: boolean): void;
}

const READ_POST_PATHS = [
  /\/api\/negotiate$/i, // Azure Function de negociação SignalR
  /^\/_services\/entity-grid-data\.json\//i, // listas (entity list) do Power Pages
  /^\/_services\/entity-subgrid-data\.json\//i, // subgrades da ficha (somente leitura)
];
/** Negociação com o Azure SignalR Service (hub "usermonitor") — confirmado em 2026-11-24. */
const isSignalRNegotiate = (u: URL) => u.hostname.endsWith('.service.signalr.net') && /\/negotiate$/i.test(u.pathname);
/** Telemetria da Microsoft: bloqueada sem poluir o console. */
const isTelemetry = (u: URL) => u.hostname.endsWith('events.data.microsoft.com');

export async function installReadOnlyGuard(context: BrowserContext, log: EventLogger, portalUrl: string): Promise<Guard> {
  const portalOrigin = new URL(portalUrl).origin;
  let allowLogin = true;

  const isAllowed = (req: Request): boolean => {
    const method = req.method();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
    const u = new URL(req.url());
    if (allowLogin && u.origin === portalOrigin && /^\/signin\/?$/i.test(u.pathname)) return true;
    return isSignalRNegotiate(u) || READ_POST_PATHS.some((re) => re.test(u.pathname));
  };

  // Impede o auto-Online do primeiro acesso (Home.OnLoad) e o falso indicador "Online" local.
  // Apenas grava a mesma chave que o portal usa para marcar "já executado nesta sessão".
  await context.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('firstLogin')) sessionStorage.setItem('firstLogin', 'true');
    } catch {}
  });

  await context.route('**/*', (route) => {
    const req = route.request();
    if (isAllowed(req)) return route.fallback();
    const u = new URL(req.url());
    if (isTelemetry(u)) log.event('telemetria-bloqueada', { host: u.hostname }, false);
    else log.event('escrita-bloqueada', { metodo: req.method(), url: redactUrl(req.url()), tipo: req.resourceType() });
    return route.abort('blockedbyclient');
  });

  return { setAllowLogin: (v) => (allowLogin = v) };
}
