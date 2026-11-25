/**
 * Autentica no portal GO e mantém o navegador aberto.
 * A sessão fica persistida no perfil .auth/chromium-profile (reutilizada nas próximas execuções).
 * Encerre fechando a janela do navegador ou com Ctrl+C.
 */
import { ensureLoggedIn, watchSession } from '../auth/session';
import { openBrowser } from '../lib/browser';
import { installReadOnlyGuard } from '../lib/guard';
import { loadConfig } from '../lib/config';
import { EventLogger } from '../lib/logger';
import { safeError } from '../lib/redact';

async function main() {
  const cfg = loadConfig();
  const log = new EventLogger('login');
  const context = await openBrowser();
  const guard = await installReadOnlyGuard(context, log, cfg.url);
  const page = context.pages()[0] ?? (await context.newPage());

  try {
    await ensureLoggedIn(page, log);
    guard.setAllowLogin(false);
  } catch (e) {
    log.event('erro-autenticacao', { erro: safeError(e, [cfg.login, cfg.senha]) });
    log.event('aguardando', { instrucao: 'Navegador mantido aberto para análise. Feche a janela para encerrar.' });
  }

  const stop = watchSession(page, log);
  log.event('navegador-aberto', { instrucao: 'Feche a janela do navegador ou pressione Ctrl+C para encerrar.' });

  await new Promise<void>((resolve) => {
    context.on('close', () => resolve());
    process.on('SIGINT', () => resolve());
  });
  stop();
  log.event('encerrado');
  await log.close();
  await context.close().catch(() => {});
  process.exit(0);
}

main().catch((e) => {
  console.error('Erro:', safeError(e));
  process.exit(1);
});
