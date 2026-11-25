# Dione CRM: automação de captação de leads (Portal GO, Moura Dubeux)

**Etapa 1:** autenticação, inspeção e observação, **somente leitura**.
As descobertas sobre o portal estão em [docs/portal-go.md](docs/portal-go.md).

## Requisitos
- Node.js 24 ou superior
- `npm install` e depois `npx playwright install chromium`
- Arquivo `.env` na raiz com as variáveis `link`, `login` e `senha` (veja `.env.example`). O código nunca altera esse arquivo.

## Comandos

| Comando | O que faz |
|---|---|
| `npm run login` | Abre o Chromium visível, autentica (ou reaproveita a sessão) e mantém a janela aberta, vigiando a expiração da sessão. |
| `npm run inspect -- /oportunidades/ --detail` | Descreve a estrutura das páginas informadas e, com `--detail`, a da 1ª ficha. Grava em `artifacts/inspect/`. |
| `npm run observe -- 30` | Modo de observação por 30 min (sem argumento, roda até a janela ser fechada). Grava em `logs/observe-*.jsonl`. |
| `npm run probe` | Descreve a tela de login sem preencher nada. |
| `npm run diag:network` | Diagnóstico de carregamento (requisições pendentes e com falha). |
| `npm run typecheck` | Verificação de tipos do TypeScript. |

> No Git Bash, use `MSYS_NO_PATHCONV=1 npm run inspect -- /oportunidades/`, para que `/oportunidades/` não seja convertido em um caminho do Windows.

Só um comando por vez pode usar o perfil do navegador. Feche a janela anterior antes de rodar outro.

## Segurança
- As credenciais vêm só do `.env`. Elas não aparecem no código, no terminal nem nos logs (há mascaramento automático).
- A sessão fica no perfil do Chromium em `.auth/chromium-profile`. No Windows, os cookies são cifrados com DPAPI.
- `.env`, `.auth/`, `logs/` e `artifacts/` são ignorados pelo git, porque `logs/` e `artifacts/` podem conter dados de leads.
- **Guarda somente leitura** ([src/lib/guard.ts](src/lib/guard.ts)): bloqueia toda escrita, inclusive o **auto-Online que o portal dispara ao abrir a home**. Veja [docs/portal-go.md §4](docs/portal-go.md#4-presença-onlineoffline).

## Estrutura
```
src/
  lib/config.ts     carrega o .env (link, login, senha) sem exibir valores
  lib/browser.ts    Chromium com perfil persistente e correção de IPv6 do CDN
  lib/guard.ts      guarda somente leitura
  lib/logger.ts     eventos com horário em JSON Lines
  lib/redact.ts     mascaramento de URLs, GUIDs, tokens e dados pessoais
  lib/dom.ts        descrição estrutural de páginas
  auth/session.ts   login, detecção de CAPTCHA/2FA e vigilância da sessão
  scripts/          login, inspect, observe, probe-login, diag-network
docs/portal-go.md   descobertas (confirmado × hipótese)
```
