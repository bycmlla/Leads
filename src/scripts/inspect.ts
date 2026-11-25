/**
 * Inspeção SOMENTE LEITURA do portal após login.
 * - Descreve a estrutura (menus, botões, campos, tabelas) da home e das páginas informadas.
 * - Navega apenas por GET (page.goto) para caminhos de menu; não clica em botões.
 * - Usa a guarda somente leitura (src/lib/guard.ts), instalada antes do login.
 * - Grava JSON e captura de tela em artifacts/inspect/ (pasta ignorada pelo git: pode conter dados pessoais).
 *
 * Uso: npm run inspect -- [/caminho1 /caminho2 ...]
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'playwright';
import { ensureLoggedIn } from '../auth/session';
import { openBrowser } from '../lib/browser';
import { ARTIFACTS_DIR, loadConfig } from '../lib/config';
import { describeFrame } from '../lib/dom';
import { installReadOnlyGuard } from '../lib/guard';
import { EventLogger } from '../lib/logger';
import { GUID_RE, redactText, redactUrl, safeError } from '../lib/redact';

const OUT = path.join(ARTIFACTS_DIR, 'inspect');

async function pageSummary(page: Page) {
  return page.evaluate(() => {
    const txt = (el: Element | null) => ((el as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const sel = (el: Element) => {
      if (el.id) return '#' + el.id;
      const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.');
      return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
    };
    const w = window as any;
    return {
      nav: Array.from(document.querySelectorAll('nav a, .navbar a, header a, .menu a, [role=menu] a, .dropdown-menu a'))
        .map((a) => ({ sel: sel(a), href: a.getAttribute('href'), text: txt(a) }))
        .filter((x) => x.text || x.href)
        .slice(0, 80),
      tables: Array.from(document.querySelectorAll('table')).map((t) => ({
        sel: sel(t),
        headers: Array.from(t.querySelectorAll('thead th')).map((th) => txt(th)),
        rows: t.querySelectorAll('tbody tr').length,
        parentEntityList: !!t.closest('.entitylist, .entity-grid, [data-view-layouts]'),
      })),
      entityLists: Array.from(document.querySelectorAll('.entitylist, .entity-grid')).map((e) => ({
        sel: sel(e),
        dataAttrs: Array.from(e.attributes).map((a) => a.name).filter((n) => n.startsWith('data-')),
      })),
      modals: Array.from(document.querySelectorAll('.modal')).map((m) => ({ sel: sel(m), title: txt(m.querySelector('.modal-title, .modal-title-alerta, h1')) })),
      presence: (() => {
        const el = document.querySelector('#md-inicio');
        return el ? { sel: '#md-inicio', cls: el.getAttribute('class'), title: el.getAttribute('title') } : null;
      })(),
      profileMenu: Array.from(document.querySelectorAll('.md-dropdown-profile [id]')).map((e) => ({ id: e.id, text: txt(e) })),
      globals: {
        MD: w.MD ? Object.keys(w.MD.Portal || {}) : [],
        ambienteKeys: w.MD_Portal_Ambiente ? Object.keys(w.MD_Portal_Ambiente) : [],
        signalR: !!w.signalR,
        signalRState: w.MD?.Portal?.SignalRNewLead?.connection?.connectionState ?? null,
      },
      tabs: Array.from(document.querySelectorAll('.nav-tabs a, [role=tab]')).map((t) => txt(t)).filter(Boolean),
      labels: Array.from(document.querySelectorAll('label')).map((l) => ({ for: l.getAttribute('for'), text: txt(l) })).filter((l) => l.text).slice(0, 120),
      textareas: Array.from(document.querySelectorAll('textarea')).map((t) => sel(t)),
      selects: Array.from(document.querySelectorAll('select')).map((s) => ({ sel: sel(s), options: (s as HTMLSelectElement).options.length })),
      /** Estrutura da 1ª linha de cada grade: atributos data-*, links e nomes de atributo das células. */
      firstRows: Array.from(document.querySelectorAll('table tbody tr:first-child')).map((tr) => ({
        trAttrs: Array.from(tr.attributes).map((a) => a.name),
        cells: Array.from(tr.querySelectorAll('td')).map((td) => ({ attr: td.getAttribute('data-attribute'), type: td.getAttribute('data-type') })),
        links: Array.from(tr.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')),
        actions: Array.from(tr.querySelectorAll('.dropdown-menu a, [class*=action]')).map((a) => txt(a)).filter(Boolean),
      })),
      forms: Array.from(document.querySelectorAll('.crmEntityFormView, .entity-form, form')).map((f) => ({ sel: sel(f), attrs: Array.from(f.attributes).map((a) => a.name) })),
      fields: Array.from(document.querySelectorAll('input:not([type=hidden]), textarea, select'))
        .map((i) => ({ id: i.id || null, name: i.getAttribute('name'), type: i.getAttribute('type') || i.tagName.toLowerCase(), readonly: (i as HTMLInputElement).readOnly || i.hasAttribute('disabled'), label: txt(document.querySelector(`label[for="${i.id}"]`)) }))
        .slice(0, 150),
      /** Textos das opções de selects de domínio (fases, motivos, tipos) — não são dados pessoais. */
      selectOptions: Object.fromEntries(
        Array.from(document.querySelectorAll('select[id^="md-"], select#opportunityratingcode'))
          .filter((s) => s.id !== 'md-especialista')
          .map((s) => [s.id, Array.from((s as HTMLSelectElement).options).map((o) => o.text.trim()).slice(0, 40)]),
      ),
      /** Formato (não o valor) dos identificadores: dígitos → 9, letras → A. */
      idShapes: (() => {
        const shape = (v: string) => v.replace(/[0-9]/g, '9').replace(/[A-Za-z]/g, (c) => (/[A-Z]/.test(c) ? c : 'a'));
        const out: Record<string, string> = {};
        const f = document.querySelector('#md_id_oportunidade') as HTMLInputElement | null;
        if (f?.value) out.md_id_oportunidade = shape(f.value);
        const firstCell = document.querySelector('table tbody tr:first-child td') as HTMLElement | null;
        if (firstCell?.innerText) out.primeiraCelulaGrade = shape(firstCell.innerText.trim()).slice(0, 30);
        const hidden = ['md_etapaname', 'md_sub_etapaautomatica'];
        for (const h of hidden) {
          const el = document.getElementById(h) as HTMLInputElement | null;
          if (el) out[h] = h === 'md_etapaname' ? el.value : String(el.value);
        }
        return out;
      })(),
      hiddenIds: Array.from(document.querySelectorAll('input[type=hidden][id^="md"]')).map((i) => i.id).slice(0, 60),
      allButtons: Array.from(document.querySelectorAll('button, input[type=button], input[type=submit], a.btn'))
        .filter((b) => (b as HTMLElement).offsetParent !== null)
        .map((b) => ({ sel: sel(b), text: txt(b).slice(0, 50), onclick: (b.getAttribute('onclick') || '').split('(')[0] || null }))
        .slice(0, 120),
    };
  });
}

async function inspectPage(page: Page, name: string, log: EventLogger) {
  const structure = await describeFrame(page);
  const summary = await pageSummary(page);
  const data = { url: redactUrl(page.url()), title: structure.title, structure: { ...structure, url: redactUrl(structure.url) }, summary };
  // Textos visíveis podem conter dados pessoais de leads: mascarar antes de gravar.
  const json = JSON.stringify(data, (_k, v) => (typeof v === 'string' ? redactText(v, 300).replace(GUID_RE, '<guid>') : v), 2);
  fs.writeFileSync(path.join(OUT, `${name}.json`), json);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true }).catch(() => {});
  log.event('pagina-inspecionada', {
    nome: name,
    url: redactUrl(page.url()),
    titulo: structure.title,
    nav: summary.nav.length,
    tabelas: summary.tables.length,
    presenca: summary.presence?.title ?? null,
    signalR: summary.globals.signalRState,
  });
}

async function main() {
  const cfg = loadConfig();
  fs.mkdirSync(OUT, { recursive: true });
  const log = new EventLogger('inspect');
  const context = await openBrowser();
  const guard = await installReadOnlyGuard(context, log, cfg.url);
  const page = context.pages()[0] ?? (await context.newPage());

  await ensureLoggedIn(page, log);
  guard.setAllowLogin(false);

  await page.waitForTimeout(4000);
  await inspectPage(page, 'home', log);

  const extra = process.argv.slice(2).filter((a) => a.startsWith('/'));
  for (const p of extra) {
    const target = new URL(p, cfg.url).toString();
    await page.goto(target, { waitUntil: 'load', timeout: 60_000 }).catch((e) => log.event('falha-navegacao', { erro: safeError(e) }));
    await page.waitForTimeout(4000);
    await inspectPage(page, p.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root', log);
  }

  // --detail: abre (GET) a ficha da 1ª oportunidade listada em /oportunidades/, sem interagir.
  if (process.argv.includes('--detail')) {
    await page.goto(new URL('/oportunidades/', cfg.url).toString(), { waitUntil: 'load', timeout: 60_000 });
    await page.waitForSelector('table tbody tr', { timeout: 30_000 }).catch(() => {});
    const href = await page
      .locator('table tbody tr:first-child a[href*="detalhes-oportunidade"], table tbody tr:first-child a[href*="id="]')
      .first()
      .getAttribute('href')
      .catch(() => null);
    if (!href) {
      log.event('ficha-nao-encontrada', { motivo: 'nenhum link de detalhe na 1ª linha da grade' });
    } else {
      log.event('abrindo-ficha', { href: redactUrl(new URL(href, cfg.url).toString()) });
      await page.goto(new URL(href, cfg.url).toString(), { waitUntil: 'load', timeout: 60_000 });
      await page.waitForTimeout(6000);
      await inspectPage(page, 'detalhes-oportunidade', log);
    }
  }

  await log.close();
  await context.close();
}

main().catch((e) => {
  console.error('Erro:', safeError(e));
  process.exit(1);
});
