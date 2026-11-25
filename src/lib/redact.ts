/**
 * Funções de sanitização para impedir que tokens, credenciais e dados pessoais
 * cheguem ao terminal ou aos arquivos de log.
 */

const SENSITIVE_PARAM = /(token|auth|senha|password|pass|pwd|secret|key|session|sid|code|jwt|bearer|cpf|email|telefone|phone|celular|nome|name)/i;
/** GUIDs (ids de contato/oportunidade do Dataverse) e tokens longos sem hífen. */
export const GUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const LONG_TOKEN_RE = /\b[A-Za-z0-9_]{40,}\b/g;

/** Mantém origem + caminho; valores sensíveis da query viram "***" e GUIDs viram "<guid>". */
export function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const params: string[] = [];
    u.searchParams.forEach((value, key) => {
      const v = SENSITIVE_PARAM.test(key) ? '***' : truncate(value.replace(GUID_RE, '<guid>').replace(LONG_TOKEN_RE, '<token>'), 40);
      params.push(`${key}=${v}`);
    });
    const path = u.pathname.replace(GUID_RE, '<guid>').replace(LONG_TOKEN_RE, '<token>');
    return `${u.origin}${path}${params.length ? '?' + params.join('&') : ''}`;
  } catch {
    return truncate(raw, 120);
  }
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/g;
const CPF_RE = /\d{3}\.?\d{3}\.?\d{3}-?\d{2}/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/** Mascara e-mails, telefones, CPFs e JWTs em textos livres. */
export function redactText(text: string, max = 300): string {
  return truncate(
    text
      .replace(JWT_RE, '<jwt>')
      .replace(EMAIL_RE, '<email>')
      .replace(CPF_RE, '<cpf>')
      .replace(PHONE_RE, '<telefone>')
      .replace(/\s+/g, ' ')
      .trim(),
    max,
  );
}

/** Mascara qualquer ocorrência literal de segredos conhecidos (ex.: login/senha do .env). */
export function scrubSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 3) out = out.split(s).join('***');
  }
  return out;
}

/**
 * Descreve a "forma" de um JSON (chaves e tipos) sem os valores —
 * útil para entender payloads sem registrar dados pessoais.
 */
export function jsonShape(value: unknown, depth = 0): unknown {
  if (depth > 4) return '…';
  if (Array.isArray(value)) return value.length ? [jsonShape(value[0], depth + 1), `len=${value.length}`] : [];
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out[k] = jsonShape(v, depth + 1);
    }
    return out;
  }
  return value === null ? 'null' : typeof value;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/** Sanitiza mensagens de erro (ex.: call logs do Playwright que incluem URLs e valores digitados). */
export function safeError(e: unknown, secrets: string[] = []): string {
  const msg = e instanceof Error ? e.message : String(e);
  const noUrls = msg.replace(/https?:\/\/[^\s"')]+/g, (m) => redactUrl(m).replace(/^https?:\/\/[^/]+/, '<portal>'));
  return scrubSecrets(redactText(noUrls, 600), secrets);
}
