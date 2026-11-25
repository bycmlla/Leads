import type { Page } from 'playwright';
import { loadConfig } from '../lib/config';
import type { EventLogger } from '../lib/logger';
import { redactText, redactUrl, safeError } from '../lib/redact';

/**
 * Seletores CONFIRMADOS na tela /SignIn (sondagem de 2026-11-24, ver docs/portal-go.md).
 */
export const LOGIN_SELECTORS = {
  username: '#Username',
  password: '#PasswordValue',
  rememberMe: '#RememberMe',
  submit: '#submit-signin-local',
  /** Erros de validação padrão do ASP.NET/Power Pages — HIPÓTESE até ocorrer um erro real. */
  errors: '.validation-summary-errors, .validation-summary-errors li, .alert-danger, .text-danger:not(:empty)',
  captcha:
    'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey], #captcha, [id*="Captcha" i]',
} as const;

export type AuthState = 'authenticated' | 'login-form' | 'challenge' | 'unknown';

/**
 * Estado de autenticação lido de forma passiva.
 * Power Pages expõe window.Microsoft.Dynamic365.Portal.User.contactId quando há usuário logado
 * (usado pelos próprios scripts MD.Portal.*). O valor NÃO é retornado, apenas se existe.
 */
export async function getAuthState(page: Page): Promise<AuthState> {
  const state = await page
    .evaluate((sel) => {
      const w = window as any;
      const contactId = w?.Microsoft?.Dynamic365?.Portal?.User?.contactId;
      if (contactId && String(contactId).length > 10) return 'authenticated';
      if (document.querySelector(sel.captcha)) return 'challenge';
      if (document.querySelector(sel.password)) return 'login-form';
      const text = document.body?.innerText?.toLowerCase() ?? '';
      if (/c[oó]digo de verifica|verification code|autentica[cç][aã]o de dois|two-factor|2fa/.test(text)) return 'challenge';
      return 'unknown';
    }, LOGIN_SELECTORS)
    .catch(() => 'unknown');
  return state as AuthState;
}

async function waitForUser(page: Page, log: EventLogger, reason: string, timeoutMs = 10 * 60_000): Promise<boolean> {
  log.event('intervencao-necessaria', { motivo: reason, instrucao: 'Conclua a etapa manualmente na janela do navegador.' });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await page.waitForTimeout(3000);
    if ((await getAuthState(page)) === 'authenticated') return true;
  }
  return false;
}

/**
 * Garante uma sessão autenticada: reaproveita o perfil persistente se a sessão ainda for válida,
 * caso contrário preenche o formulário local com as credenciais do .env.
 * Nunca tenta contornar CAPTCHA ou segundo fator: pausa e pede intervenção.
 */
export async function ensureLoggedIn(page: Page, log: EventLogger): Promise<void> {
  const cfg = loadConfig();
  const secrets = [cfg.login, cfg.senha];

  log.event('navegacao', { destino: 'url-de-login' });
  await page.goto(cfg.url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('load', { timeout: 60_000 }).catch(() => {});

  let state = await getAuthState(page);
  // Na /SignIn com sessão válida o portal pode não redirecionar; testar a home.
  if (state === 'login-form') {
    const home = new URL('/', cfg.url).toString();
    await page.goto(home, { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
    state = await getAuthState(page);
    if (state !== 'authenticated') {
      await page.goto(cfg.url, { waitUntil: 'load', timeout: 60_000 });
      state = await getAuthState(page);
    }
  }

  if (state === 'authenticated') {
    // Confirmado: com sessão válida o portal permanece em /SignIn em vez de redirecionar.
    if (/\/signin/i.test(new URL(page.url()).pathname)) {
      await page.goto(new URL('/', cfg.url).toString(), { waitUntil: 'load', timeout: 60_000 }).catch(() => {});
    }
    log.event('sessao-reutilizada', { url: redactUrl(page.url()) });
    return;
  }

  if (state === 'challenge') {
    if (!(await waitForUser(page, log, 'CAPTCHA/segundo fator detectado antes do login'))) {
      throw new Error('Tempo esgotado aguardando intervenção manual.');
    }
    return;
  }

  if (state !== 'login-form') {
    throw new Error(`Tela de login não reconhecida em ${redactUrl(page.url())}. Rode "npm run probe" e revise os seletores.`);
  }

  log.event('login-preenchendo', { campos: [LOGIN_SELECTORS.username, LOGIN_SELECTORS.password] });
  await page.fill(LOGIN_SELECTORS.username, cfg.login);
  await page.fill(LOGIN_SELECTORS.password, cfg.senha);
  // "Lembrar de mim" torna o cookie de autenticação persistente → sessão reaproveitável no perfil.
  const remember = page.locator(LOGIN_SELECTORS.rememberMe);
  if ((await remember.count()) && !(await remember.isChecked())) await remember.check().catch(() => {});

  log.event('login-enviando');
  try {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load', timeout: 60_000 }).catch(() => {}),
      page.click(LOGIN_SELECTORS.submit),
    ]);
  } catch (e) {
    throw new Error('Falha ao enviar o formulário: ' + safeError(e, secrets));
  }
  await page.waitForTimeout(1500);

  state = await getAuthState(page);
  if (state === 'authenticated') {
    log.event('login-sucesso', { url: redactUrl(page.url()) });
    return;
  }
  if (state === 'challenge') {
    if (await waitForUser(page, log, 'CAPTCHA/segundo fator após envio das credenciais')) {
      log.event('login-sucesso', { url: redactUrl(page.url()), apos: 'intervencao-manual' });
      return;
    }
    throw new Error('Tempo esgotado aguardando intervenção manual.');
  }

  const errors = await page
    .locator(LOGIN_SELECTORS.errors)
    .allInnerTexts()
    .catch(() => [] as string[]);
  const msg = errors.map((t) => redactText(t, 200)).filter(Boolean).join(' | ');
  log.event('login-falhou', { url: redactUrl(page.url()), mensagens: msg || '(nenhuma mensagem de erro visível)' });
  throw new Error('Login não confirmado. ' + (msg ? `Portal informou: ${msg}` : 'Verifique a janela do navegador.'));
}

/**
 * Vigia a sessão sem navegar: a cada intervalo verifica se o usuário continua autenticado.
 * Detecta expiração (redirecionamento para /SignIn ou perda do contactId).
 */
export function watchSession(page: Page, log: EventLogger, intervalMs = 60_000): () => void {
  let lastState: AuthState = 'authenticated';
  const timer = setInterval(async () => {
    if (page.isClosed()) return;
    const state = await getAuthState(page);
    if (state !== lastState) {
      if (state === 'login-form') log.event('sessao-expirada', { url: redactUrl(page.url()) });
      else if (state === 'challenge') log.event('sessao-desafio', { url: redactUrl(page.url()) });
      else if (state === 'authenticated') log.event('sessao-restabelecida');
      else log.event('sessao-estado-desconhecido', { url: redactUrl(page.url()) });
      lastState = state;
    }
  }, intervalMs);
  return () => clearInterval(timer);
}
