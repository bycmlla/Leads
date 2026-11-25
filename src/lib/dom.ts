import type { Frame, Page } from 'playwright';

export interface ElementInfo {
  tag: string;
  id?: string;
  name?: string;
  type?: string;
  cls?: string;
  placeholder?: string;
  aria?: string;
  role?: string;
  href?: string;
  text?: string;
  formAction?: string;
  visible: boolean;
  dataAttrs?: string[];
}

export interface PageStructure {
  url: string;
  title: string;
  framework: Record<string, boolean>;
  scripts: string[];
  iframes: string[];
  inputs: ElementInfo[];
  buttons: ElementInfo[];
  links: ElementInfo[];
  forms: ElementInfo[];
  captcha: string[];
  headings: string[];
}

/**
 * Extrai a estrutura da página/frame. Não lê o valor (value) de nenhum campo.
 * Textos são truncados; o chamador deve aplicar redactText antes de registrar.
 */
export async function describeFrame(frame: Frame | Page): Promise<PageStructure> {
  return frame.evaluate(() => {
    const vis = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      const st = getComputedStyle(el as HTMLElement);
      return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
    };
    const info = (el: Element) => {
      const h = el as HTMLElement & { type?: string; name?: string; placeholder?: string; href?: string; form?: HTMLFormElement };
      const dataAttrs = Array.from(el.attributes)
        .filter((a) => a.name.startsWith('data-') || a.name.startsWith('ng-') || a.name.startsWith('_ng') || a.name.startsWith('v-'))
        .map((a) => a.name)
        .slice(0, 8);
      return {
        tag: el.tagName.toLowerCase(),
        id: h.id || undefined,
        name: el.getAttribute('name') || undefined,
        type: el.getAttribute('type') || undefined,
        cls: (el.getAttribute('class') || '').slice(0, 120) || undefined,
        placeholder: el.getAttribute('placeholder') || undefined,
        aria: el.getAttribute('aria-label') || undefined,
        role: el.getAttribute('role') || undefined,
        href: el.getAttribute('href') || undefined,
        text: (h.innerText || h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || undefined,
        formAction: el.tagName === 'FORM' ? el.getAttribute('action') || undefined : undefined,
        visible: vis(el),
        dataAttrs: dataAttrs.length ? dataAttrs : undefined,
      };
    };
    const w = window as any;
    const html = document.documentElement.outerHTML;
    return {
      url: location.href,
      title: document.title,
      framework: {
        angular: !!document.querySelector('[ng-version]') || !!w.ng || !!w.angular,
        react: !!document.querySelector('[data-reactroot]') || !!w.React || /__reactFiber|__reactContainer/.test(Object.keys(document.querySelector('#root, #app, body > div') || {}).join(',')),
        vue: !!w.Vue || !!document.querySelector('[data-v-app]') || /data-v-[0-9a-f]{6,}/.test(html.slice(0, 200000)),
        jquery: !!w.jQuery,
        signalR: !!w.signalR || !!(w.jQuery && w.jQuery.signalR) || !!(w.$ && w.$.connection),
        aspnetWebForms: !!document.querySelector('#__VIEWSTATE'),
        blazor: !!w.Blazor,
      },
      scripts: Array.from(document.scripts).map((s) => s.src).filter(Boolean).slice(0, 60),
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => f.getAttribute('src') || '(sem src)'),
      inputs: Array.from(document.querySelectorAll('input, textarea, select')).map(info).slice(0, 150),
      buttons: Array.from(document.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')).map(info).slice(0, 150),
      links: Array.from(document.querySelectorAll('a[href], [routerlink], [ng-click], [onclick]')).map(info).slice(0, 200),
      forms: Array.from(document.querySelectorAll('form')).map(info),
      captcha: Array.from(
        document.querySelectorAll(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], .g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]',
        ),
      ).map((e) => e.tagName.toLowerCase() + (e.getAttribute('src') ? ' ' + (e.getAttribute('src') || '').slice(0, 60) : '')),
      headings: Array.from(document.querySelectorAll('h1, h2, h3, h4')).map((h) => (h as HTMLElement).innerText.trim().slice(0, 80)).filter(Boolean).slice(0, 40),
    };
  });
}
