# Portal GO (Moura Dubeux) — descobertas da etapa 1

> Investigação realizada em **24/11/2026**, entre 16:00 e 16:20 (horário de Brasília).
> Legenda: ✅ **Confirmado na prática** (observado no navegador, na rede ou no código JS servido pelo portal) ·
> 🔶 **Hipótese** (inferido, ainda não comprovado) · ❓ **A investigar**.
>
> Nesta documentação não há credenciais, nomes de leads, nomes de usuários nem hosts internos.
> Os valores reais ficam apenas em `logs/` e `artifacts/`, que são ignorados pelo git.

---

## 1. Plataforma

| Item | Status | Detalhe |
|---|---|---|
| Tecnologia | ✅ | **Microsoft Power Pages** (antigo Power Apps Portals) sobre **Dataverse**. Domínio `*.powerappsportals.com`. |
| Front-end | ✅ | jQuery + Bootstrap, renderização no servidor (ASP.NET). Scripts customizados `MD.Portal.*.js` e o SDK `AlfaPeople.Portals.SDK.js`. |
| Tempo real | ✅ | `@microsoft/signalr` (`/Signalr.4.2.2.js`) ligado ao **Azure SignalR Service** (hub `usermonitor`) por meio de **Azure Functions**. |
| Leitura de dados | ✅ | `GET /repository/?acao=...` (Liquid/FetchXML do portal), `POST /_services/entity-grid-data.json/<id>` (listas) e `GET /_api/<entidade>` (Web API do Power Pages). |
| Escrita de dados | ✅ (código) | `PATCH /_api/opportunities(<id>)`, `POST /_api/annotations` e Azure Functions (`<AZURE_FUNCTIONS_BASE_URL>/api/...`). Token antifalsificação: `GET /_layout/tokenhtml`. |
| Config. de ambiente | ✅ | Objeto global `MD_Portal_Ambiente` com as chaves `AZURE_FUNCTIONS_BASE_URL` e `EMAIL_DOMAINS`. |
| Usuário logado | ✅ | `window.Microsoft.Dynamic365.Portal.User.contactId` (GUID do contato do corretor). |

### Problema de rede encontrado ✅
Nesta máquina, o CDN `content.powerapps.com` (Azure Front Door) **não responde por IPv6**: a conexão TCP abre, mas o TLS nunca termina. Por IPv4 responde em cerca de 0,3 s. O Chromium não volta sozinho para IPv4, e a página fica presa em `readyState=loading`.
**Solução adotada:** [src/lib/browser.ts](../src/lib/browser.ts) intercepta **apenas** os recursos estáticos `GET`/`HEAD` desse host e os busca pelo Node forçando IPv4, sem encaminhar cookies.
Solução alternativa definitiva (exige administrador): fazer o Windows preferir IPv4 ou corrigir o IPv6 da rede.

---

## 2. Autenticação

| Item | Status | Detalhe |
|---|---|---|
| URL de login | ✅ | Valor de `link` no `.env` (página `/SignIn`). Título "Entrar", seção "Entrar com uma conta local". |
| Campo usuário | ✅ | `#Username` (`name="Username"`, `type=text`) |
| Campo senha | ✅ | `#PasswordValue` (`name="PasswordValue"`, `type=password`) |
| Lembrar de mim | ✅ | `#RememberMe` (checkbox). O script o marca para que o cookie seja persistente. |
| Botão | ✅ | `#submit-signin-local` ("Entrar") |
| Formulário | ✅ | `form[action="/SignIn"]` com `__RequestVerificationToken` (anti-CSRF) |
| CAPTCHA / 2FA no login | ✅ ausente | Nenhum elemento reCAPTCHA, hCaptcha ou Turnstile, e nenhum `[data-sitekey]`. O login automático funcionou de primeira. |
| Confirmação de sucesso | ✅ | `contactId` presente em `window.Microsoft.Dynamic365.Portal.User`. Após o envio, o portal redireciona para `/`. |
| Sessão já válida em `/SignIn` | ✅ | O portal **não redireciona**: continua em `/SignIn`, mas com `contactId` preenchido. O script navega para `/`. |
| Reutilização de sessão | ✅ | Perfil persistente `.auth/chromium-profile` reaproveitado em 6 execuções seguidas sem novo login. |
| Mensagens de erro de login | 🔶 | Seletores ASP.NET padrão (`.validation-summary-errors`, `.alert-danger`). Ainda não houve erro real para confirmar. |
| Expiração de sessão | 🔶 | Detectada pela perda do `contactId` ou pela volta à tela com `#PasswordValue` (verificada a cada 60 s). Tempo de expiração real desconhecido. |
| Logout | ✅ (código) | `#md-logout` → `/Account/Login/LogOff?returnUrl=%2F`. **O clique em "Sair" também coloca o corretor Offline.** |
| Esqueci a senha | ✅ | `/Account/Login/ForgotPassword` |

---

## 3. Estrutura e menus

### Cabeçalho (todas as páginas autenticadas) ✅
- Logo → `~/`
- `#disponibilidade` → `/disponibilidade/` (catálogo de empreendimentos)
- Menu do perfil `.md-dropdown-profile`:
  - `#md-inicio`: avatar com iniciais. **O indicador de presença está aqui** (veja a seção 4).
  - `#md-online` "Online", `#md-offline` "Offline"
  - `/profile/` "Perfil"
  - `#md-logout` "Sair"

### Home `/` ✅
- Títulos: "Tarefas", "Clientes a perder", "Resumo de negócios" (filtro `#md-periodo`).
- Duas grades Power Pages (`div.entity-grid.entitylist`), com seletor de visão (`button.selected-view.dropdown-toggle`):
  - Oportunidades: visões "Oportunidades abertas", "sem próximos passos", "ganhas" e "perdidas".
  - Tarefas: visões "Tarefas vencidas", "de hoje" e "futuras".
- Indicadores numéricos carregados por `GET /repository/?acao=...` e `GET /gettotal/`.

### Listagem de leads `/oportunidades/` ✅
- Título "Oportunidades". Botão `a.btn.btn-primary` "Criar lead/oportunidade".
- Grade `div.entity-grid.entitylist table` com 10 linhas por página, paginação `.entity-pager-*` e busca "Search Results".
- **Cada linha `tr` tem `data-id` (GUID da oportunidade), `data-entity` e `data-name`.**
- Colunas, identificadas por `td[data-attribute]`:

| Coluna | `data-attribute` | Tipo |
|---|---|---|
| ID Oportunidade (**MDVOP**) | `md_id_oportunidade` | String |
| Cliente Provável | `customerid` | EntityReference |
| Nome de Exibição | `md_nomeexibicao` | String |
| Empreendimento | `md_empreendimentoid` | EntityReference |
| Origem do Cliente | `md_canaldeorigemid` | EntityReference |
| Mídia de Origem | `md_midiadeorigemid` | EntityReference |
| Telefone | `md_telefone_contato` | String (há também um link `https://wa.me/...`) |
| Fase | `md_etapa` | EntityReference |
| Sub-Fase | `md_sub_etapa` | EntityReference |
| Created On | `createdon` | DateTime |
| Data de Expiração | `md_data_expiracao` | DateTime |
| Especialista | `md_especialista` | EntityReference |

- Link da ficha: `/oportunidades/detalhes-oportunidade/?id=<GUID oportunidade>&contactId=<GUID cliente>`.

### Código MDVOP ✅
- Formato observado: **`MDVOP-` + 6 dígitos** (por exemplo, `MDVOP-123456`; o valor real não foi registrado).
- Na grade: `td[data-attribute="md_id_oportunidade"]`. Na ficha: `#md_id_oportunidade` (somente leitura).
- É diferente do GUID interno (`data-id` na grade, `#md-opportunityId` na ficha). As mensagens SignalR usam o **GUID** (`leadid`), não o MDVOP.

### Ficha individual `/oportunidades/detalhes-oportunidade/` ✅
- Título: "Detalhes da oportunidade". Mostra "Tempo de expiração: dd/mm/aaaa hh:mm" (cronômetro em `MD.Portal.Timer.js`).
- Formulários Power Pages (`EntityFormControl_*`). Campos principais:

| Dado | Seletor | Editável |
|---|---|---|
| ID MDVOP | `#md_id_oportunidade` | não |
| Especialista | `#md_especialista_name` | não |
| Empreendimento | `#md_empreendimentoid_name` (+ lookup `button.launchentitylookup`) | via lookup |
| Temperatura | `#opportunityratingcode` (Frio/Morno/Quente) | sim |
| Nome de exibição | `#md_nomeexibicao` | sim |
| Cliente | `#customerid_name` | não |
| Nome do contato | `#md_nomecontato` | sim |
| **Telefone** | `#md_telefonecontato` | sim |
| **E-mail** | `#md_emailcontato` | sim |
| Telefones do contato | `#mobilephone`, `#telephone1/2/3`, `#mdb_telefoneinternacional`, `#fax` | sim |
| E-mails do contato | `#emailaddress2/3`, `#employeeid` (corporativo), `#address3_postofficebox` | sim |

- Campos ocultos úteis (somente leitura): `#md-opportunityId`, `#md-contactid`, `#md_etapaid`, `#md_etapaname`, `#md_sub_etapaid`, `#md_sub_etapaname`, `#md_sub_etapaautomatica`, `#md_data_expiracao`, `#md_campanha`, `#md_canaldeorigem`, `#md_midiaorigem`, `#md_empreendimentoid`, `#md-especialistaid-oportunity`.
- Campos isca anti-robô (honeypot): `#frm_pref_*`, rotulados "Leave this field blank". **Nunca devem ser preenchidos.** A página também carrega `radcaptcha.js` (❓ se o CAPTCHA aparece em algum fluxo).
- Tabelas: histórico "Fase / Sub-Fase / Data/Hora Entrada / Data/Hora Saída", proposta, conversões, contatos e linha do tempo.

### Fases e subfases ✅
Barra de fases com `select` por fase. A fase atual vem de `#md_etapaname` (por exemplo, `LEAD`):

| Fase | `select` | Subfases (opções) |
|---|---|---|
| Lead | `#md-faselead` | Lead sem contato (Lead aceito) · Lead em tentativa de contato |
| Atendimento | `#md-faseatendimento` | Em atendimento · Interesse em futuro lançamento · Já comprou · Manter relacionamento · Pesquisa |
| Agendamento | `#md-faseagendamento` | Visita agendada · Não compareceu/atendeu · Visita remarcada |
| Visita | `#md-fasevisita` | Compareceu e tem interesse · Compareceu e está em fase de pesquisa · Compareceu e não tem interesse |
| Proposta | `#md-faseproposta` | Solicitação de proposta |
| Venda | `#md-fasevenda` | (nenhuma opção) |

- Se `#md_sub_etapaautomatica == "true"`, todos os selects ficam desabilitados.
- Em Proposta ou Venda, as fases anteriores ficam ocultas e o empreendimento fica bloqueado.
- Subfases de sistema usadas pela roleta (chaves de parâmetro, ✅ no código): `SUB_FASE__ESPECIALISTA_ENCOTNRADO_NA_ROLETA`, `SUB_FASE__ESPECIALISTA_NAO_ENCOTNRADO_NA_ROLETA` e `SUB_FASE__OPORTUNIDADE_ACEITA`, além da fase `FASE__LEAD`.

### Salvamento ✅ (código)
- `#md-op-salvar` "Salvar" → `MD.Portal.DetalhesOportunidade.Oportunidade.Salvar()` → `PATCH /_api/opportunities(<id>)` com `md_etapa`, `md_sub_etapa`, `md_nomeexibicao`, `md_nomecontato`, `md_telefonecontato`, `md_emailcontato` e `md_modificado_por_portal`. Toast "Oportunidade atualizada com sucesso!" e recarga após 6 s.
- `#UpdateButton`: botão padrão dos formulários Power Pages (contato).
- `#md-op-descartar` "Descartar" → modal com `#md-motivo` (28 motivos).
- Modal "Atribuir" com `#md-especialista`.

### Anotações e atividades ✅ (código)
- `#md-novaatividade` "Nova atividade" → formulário com `#md-tipoatividade` (`Anotação` | `Tarefa`), `#md-assunto`, `#md-data`, `#md-hora`, `#md-descricao` (textarea) e `#md-anexo` (arquivo).
- Uma anotação é gravada com `POST /_api/annotations`. Tarefas usam a entidade de tarefas e Azure Functions.
- Linha do tempo: `MD.Portal.DetalhesOportunidade.TimeLine.*`. Concluir tarefa: `#md-conluir`.

---

## 4. Presença Online/Offline

| Item | Status | Detalhe |
|---|---|---|
| Indicador | ✅ | `.md-dropdown-profile #md-inicio`: classe `md-online` ou `md-offline` e atributo `title="Online"` ou `"Offline"`. |
| Leitura do estado | ✅ | No carregamento, `GET /repository/?acao=contatoOnlineOffline&id=<contactId>` → campo `md_disponibilidade` (`"true"`/`"false"`). |
| Alteração manual | ✅ (código) | Clique em `#md-online`/`#md-offline` → `POST <AZURE_FUNCTIONS>/api/contato-atualizar-disponibilidade?contatoid=<id>&disponibilidade=true|false`. |
| **Auto-Online no login** | ✅ | `MD.Portal.Home.js`: no **primeiro carregamento da home em cada sessão do navegador** (`sessionStorage.firstLogin` ausente), o portal chama sozinho `contato-atualizar-disponibilidade?disponibilidade=true`. **Abrir a home já coloca o corretor ONLINE.** A requisição foi vista e bloqueada pela guarda às 16:08:47. |
| Logout → Offline | ✅ (código) | `#md-logout` envia `disponibilidade=false` antes de sair. |
| Health-Check | ✅ | O servidor transmite `tipomensagem: "Health-Check"` por SignalR. Se o `usuarioid` for o do navegador, o portal responde com `POST <AZURE_FUNCTIONS>/api/atualizar-controle-usuario-on-off?usuarioid=<id>`. |
| Cadência do Health-Check | 🔶 | Uma rajada de cerca de 85 mensagens (uma por usuário online) foi observada às 16:18:00–06. O intervalo entre rajadas ainda não foi medido. |
| Offline automático sem resposta | 🔶 | Às 16:14 o servidor indicava **Online**. Às 16:15, após execuções com a guarda (que bloqueia a resposta ao Health-Check), indicava **Offline**. A hipótese é que o backend coloque como Offline quem não responde ao Health-Check. Ainda não está confirmado. |

---

## 5. Roleta e recebimento de novas oportunidades

### Canal: SignalR via WebSocket ✅
1. `POST <AZURE_FUNCTIONS>/api/negotiate` → 200, que devolve a URL e o token do Azure SignalR Service.
2. `POST https://<servico>.service.signalr.net/client/negotiate?hub=usermonitor&negotiateVersion=1` → 200.
3. `wss://<servico>.service.signalr.net/client/?hub=usermonitor&id=...&access_token=<JWT>`, protocolo JSON com separador `\x1e` e pings (`type: 6`) a cada ~15 s.
4. O portal valida a conexão a cada 60 s ("Validating the SignalR's connection") e reconecta sozinho (`withAutomaticReconnect`, reinício após `onclose`).

**Não há polling HTTP para novas oportunidades.** O único canal de chegada é o evento SignalR `newMessage`. Alterações no DOM (modal) são consequência dele.

### Mensagem `newMessage` ✅
- **Transmitida para todos os corretores conectados.** Cada navegador filtra no cliente com `message.usuarioid == contactId`. Confirmado: 85 Health-Checks e 1 `Lead-atender` de outros usuários recebidos em 3 minutos.
- Chaves observadas: `tipomensagem`, `usuarioid`, `leadid`, `nome`, `campanha`, `produto`, `oportunidadeid`, `conflitoEspecialista`, `nomeespecialista`, `gestorid`, `gestornome`. O código também usa `canal_origem`, `customerid` e `url_oportunidade`.
- ⚠️ O payload traz o **nome do lead** e é recebido por todos os corretores conectados. O observador **não** registra esse campo.

| `tipomensagem` | Status | Comportamento do portal (para o usuário destinatário) |
|---|---|---|
| `Lead-aceitar` | ✅ (código) | Abre o modal **"Novo Lead para ser aceito!"** e toca `~/windows_notification.mp3`. |
| `Lead-atender` | ✅ observado (outro usuário) | Abre o modal "Aonde deseja abrir o novo Lead!" com os botões "Abrir na Aba Atual" e "Abrir em Nova Aba". |
| `Health-Check` | ✅ observado | Responde com `atualizar-controle-usuario-on-off`. |

### Modal e botão ACEITAR ✅ (código), ❓ ainda não visto ao vivo
- Contêiner: `div#md-modal-openLead-00<leadid>.modal.md-modal-newLead`, título `h1.modal-title-alerta` "Novo Lead para ser aceito!".
- Conteúdo: `.md-lead-info h2` (nome), "Campanha", "Produto" e "Canal de origem" em `.md-lead-midia`.
- **ACEITAR:** `button#md-proximo.btn.btn-primary` com o texto "Aceitar", que chama `MD.Portal.SignalRNewLead.AceitarLead(nomeModal, oportunidadeid, customerid)`.
  - Verifica `obter-oportunidade-por-id`. Se a oportunidade já for de outro especialista, mostra o toast "Ops! A oportunidade já foi associada a outro usuário."
  - Se não, faz `PATCH /_api/opportunities(<id>)` com fase `FASE__LEAD` e subfase `SUB_FASE__OPORTUNIDADE_ACEITA`.
- **Recusar:** `button#md-registrar` → `<AZURE_FUNCTIONS>/api/oportunidade-aceitar-recusar-lead?...&acao=Recusar`.
- ⚠️ Os IDs `#md-proximo` e `#md-registrar` **se repetem em outros modais** ("Abrir na Aba Atual" e "Abrir em Nova Aba"). Um seletor seguro precisa do contêiner: `.md-modal-newLead #md-proximo` **e** o título "Novo Lead para ser aceito!".
- Outra via: ao abrir a ficha de uma oportunidade com a subfase `ESPECIALISTA_ENCOTNRADO_NA_ROLETA`, aparece o modal **"Lead ainda não aceito!"** (`OppAceitarLead`/`OppRecusarLead`).

### Roleta 🔶
- Pelo código: o backend escolhe um especialista, coloca a oportunidade na subfase "especialista encontrado na roleta" e envia `Lead-aceitar` com o `usuarioid` escolhido. O aceite move a oportunidade para "oportunidade aceita".
- 🔶 Só participam da roleta os corretores **Online** que respondem ao Health-Check.
- ❓ Tempo limite para aceitar, regra de repasse ao próximo corretor e efeito da recusa.
- ❓ Por que a mensagem observada foi `Lead-atender` (e não `Lead-aceitar`): possivelmente um lead de conversão de um cliente que já pertence ao corretor.

---

## 6. Mecanismo recomendado para detectar novas oportunidades 🔶

1. **Primário:** observar os quadros WebSocket do SignalR **dentro do navegador autenticado** (`page.on('websocket')`), filtrando `newMessage` com `tipomensagem` iniciado por `Lead-` e `usuarioid == contactId`. Esse é o mesmo canal que o portal usa, com latência mínima, e sem criar conexões ou chamadas extras.
2. **Confirmação:** `MutationObserver` no DOM para `.md-modal-newLead` com o título "Novo Lead para ser aceito!".
3. **Conciliação:** leitura periódica da grade `/oportunidades/` (navegação normal), para não perder nada durante reconexões.

Não usar as Azure Functions nem `/_api` diretamente fora do fluxo do próprio portal sem autorização formal da Moura Dubeux.

---

## 7. Proteções implementadas nesta etapa

- **Guarda somente leitura** ([src/lib/guard.ts](../src/lib/guard.ts)), instalada antes da primeira navegação:
  - Libera `GET`/`HEAD`/`OPTIONS`, o `POST /SignIn` (apenas durante o login), a negociação SignalR e as leituras `entity-grid-data.json` e `entity-subgrid-data.json`.
  - Aborta e registra todo o resto: auto-Online, resposta ao Health-Check, PATCH/POST em `/_api`, aceitar/recusar, telemetria.
  - Grava `sessionStorage.firstLogin = "true"` antes de a home carregar, para que o portal não dispare o auto-Online.
- Os scripts nunca clicam em botões. A inspeção só navega por `GET`.
- Os logs não guardam cabeçalhos, corpos, tokens, credenciais ou nomes de leads. GUIDs viram `<guid>` ou um hash curto. E-mails, telefones e CPF são mascarados.

---

## 8. Limitações

- A guarda impede respostas ao Health-Check. Por isso **o modo de observação não recebe leads destinados a esta conta**: os quadros de outros usuários chegam, mas os nossos dependem de estar Online e responder.
- Não foi possível ver ao vivo um `Lead-aceitar` destinado a esta conta.
- A correção de IPv6 é específica desta rede.
- A janela aberta pelo `npm run login` também fica sob a guarda. Ações manuais de escrita nessa janela serão bloqueadas.

## 9. Pendências de investigação

1. ❓ Observar ao vivo um `Lead-aceitar` para esta conta, o que exige ficar **Online**. Precisa de autorização.
2. ❓ Tempo limite e repasse da roleta. Efeito de recusar ou ignorar.
3. 🔶 Confirmar o Offline automático por falta de resposta ao Health-Check e medir o intervalo entre rajadas.
4. ❓ Tempo de expiração da sessão e comportamento do "Lembrar de mim".
5. ❓ Mensagens de erro reais do login (senha incorreta), sem forçar bloqueio de conta.
6. ❓ Se `radcaptcha.js` aparece em algum formulário usado no fluxo.
7. ❓ Visões "sem próximos passos", "ganhas" e "perdidas" e paginação da grade de oportunidades.
8. ❓ Termos de uso e autorização formal da Moura Dubeux para automação.
