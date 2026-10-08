#!/usr/bin/env python3
"""Build the Webflow version of the client-facing terminal.

Webflow pages take pasted HTML (an Embed element), capped at 50,000
characters each. Each page here becomes:

  webflow/<page>.html        the snippet to paste: page markup plus <link>
                             and <script> tags, under the cap
  public/embed/<page>.css    every style the page uses, scoped under .ss-app
                             so the Webflow theme and the terminal cannot
                             restyle each other
  public/embed/<page>-N.js   the page's inline scripts, hosted rather than
                             pasted, so the snippet stays small
  public/embed/shim.js       loaded first on every page: sends /api calls to
                             Netlify and maps ./page.html links onto the
                             Webflow page addresses

The data still comes from the Netlify functions, which Webflow cannot run,
so HOST must stay up. Re-run after any change to public/ and push:

    python3 tools/build-webflow.py [--host https://…]
"""
import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / 'public'
EMBED = PUBLIC / 'embed'
OUT = ROOT / 'webflow'
LIMIT = 50_000

PAGES = ['overview', 'news', 'ticker', 'chart', 'explorer', 'whitepaper']
# Suggested Webflow slugs; editable in the config line of each snippet.
SLUGS = {'overview': '/overview', 'news': '/news', 'ticker': '/markets', 'chart': '/chart', 'explorer': '/explorer', 'whitepaper': '/bitcoin-whitepaper'}
TITLES = {'overview': 'Overview', 'news': 'News', 'ticker': 'Markets', 'chart': 'Chart', 'explorer': 'Explorer', 'whitepaper': 'Bitcoin Whitepaper'}

SCOPE = '.ss-app'

# Webflow ships its own element defaults (p margins, h1 sizes, label weights,
# list padding). The terminal was written against browser defaults, so those
# are restored inside the wrapper first; the terminal's own rules follow and
# win wherever they say something.
RESET = """
.ss-app{display:block;font-size:16px;line-height:normal;text-align:left;letter-spacing:normal;-webkit-font-smoothing:antialiased}
.ss-app *,.ss-app *::before,.ss-app *::after{box-sizing:border-box}
.ss-app h1{font-size:2em;margin:.67em 0;line-height:normal;font-weight:700}
.ss-app h2{font-size:1.5em;margin:.83em 0;line-height:normal;font-weight:700}
.ss-app h3{font-size:1.17em;margin:1em 0;line-height:normal;font-weight:700}
.ss-app h4{font-size:1em;margin:1.33em 0;line-height:normal;font-weight:700}
.ss-app p{margin:1em 0}
.ss-app ul,.ss-app ol{margin:1em 0;padding-left:40px}
.ss-app label{display:inline;margin:0;font-weight:inherit}
.ss-app img{max-width:none;vertical-align:baseline;display:inline}
.ss-app a{color:inherit}
.ss-app button,.ss-app input,.ss-app select,.ss-app textarea{font-family:inherit;margin:0}
.ss-app table{border-collapse:separate;border-spacing:0}
"""

# Overlays must clear a Webflow site's own sticky navigation.
AFTER = """
.ss-app .reader,.ss-app .dash-layer{z-index:2147483000}
.ss-app .tour-spot{z-index:2147483001}
.ss-app .tour-card{z-index:2147483002}
.ss-app .mainnav.open{z-index:2147482000}
"""


def strip_comments(css: str) -> str:
    return re.sub(r'/\*.*?\*/', '', css, flags=re.S)


def scope_selector(sel: str) -> str:
    sel = sel.strip()
    if not sel:
        return sel
    if sel in (':root', 'html', 'body'):
        return SCOPE
    if sel == '*':
        return f'{SCOPE},{SCOPE} *'
    # State classes the scripts toggle on <body> stay on <body>.
    if re.match(r'body[.\[:]', sel):
        return sel
    m = re.match(r'(html|body|:root)\s+(.*)$', sel, re.S)
    if m:
        return f'{SCOPE} {m.group(2)}'
    return f'{SCOPE} {sel}'


def split_selectors(prelude: str):
    """Split on commas that are not inside parentheses or brackets."""
    out, depth, cur = [], 0, ''
    for ch in prelude:
        if ch in '([':
            depth += 1
        elif ch in ')]':
            depth -= 1
        if ch == ',' and depth == 0:
            out.append(cur)
            cur = ''
        else:
            cur += ch
    out.append(cur)
    return out


IMPORT = re.compile(r"""@import\s+(?:url\((?:'[^']*'|"[^"]*"|[^)]*)\)|'[^']*'|"[^"]*")[^;]*;""")


def take_imports(css: str):
    """@import must open a stylesheet and its URL can hold semicolons, so it
    is lifted out whole and hoisted to the top of the bundle."""
    css = strip_comments(css)
    return IMPORT.findall(css), IMPORT.sub('', css)


def scope_css(css: str) -> str:
    css = strip_comments(css)
    out, i, n = [], 0, len(css)
    while i < n:
        j = css.find('{', i)
        k = css.find(';', i)
        if j == -1:
            break
        # A statement at-rule such as @import or @charset.
        if k != -1 and k < j and css[i:k].strip().startswith('@'):
            out.append(css[i:k + 1].strip())
            i = k + 1
            continue
        prelude = css[i:j].strip()
        depth, p = 1, j + 1
        while p < n and depth:
            if css[p] == '{':
                depth += 1
            elif css[p] == '}':
                depth -= 1
            p += 1
        body = css[j + 1:p - 1]
        if prelude.startswith('@media') or prelude.startswith('@supports'):
            out.append(prelude + '{' + scope_css(body) + '}')
        elif prelude.startswith('@'):
            out.append(prelude + '{' + body.strip() + '}')
        elif prelude:
            sels = ','.join(scope_selector(s) for s in split_selectors(prelude) if s.strip())
            out.append(sels + '{' + re.sub(r'\s+', ' ', body).strip() + '}')
        i = p
    return '\n'.join(out)


def edge_css() -> str:
    ts = (ROOT / 'netlify/edge-functions/terminal-refresh.ts').read_text()
    m = re.search(r'<style data-terminal-refresh>(.*?)</style>', ts, re.S)
    return m.group(1) if m else ''


SHIM = r"""/* Webflow embed shim. Loaded first by every Satstreet page snippet.

   1. /api/… and /data/… requests go to the Netlify host, where the data
      functions live (Webflow cannot run them).
   2. Links and history entries written as ./overview.html, ./chart.html?…
      are mapped onto the Webflow page addresses in SATSTREET_EMBED.pages.
   3. SATSTREET_EMBED.header === false hides the terminal's own navy bar,
      for pages where the Webflow site navigation is enough. */
(function () {
  'use strict';
  var C = window.SATSTREET_EMBED || {};
  var HOST = String(C.host || '').replace(/\/$/, '');
  /* Default Webflow addresses, so a page added later is linked correctly
     from snippets pasted before it existed. The snippet's own pages win. */
  var PAGES = __DEFAULT_PAGES__;
  var own = C.pages || {};
  for (var k in own) if (Object.prototype.hasOwnProperty.call(own, k)) PAGES[k] = own[k];

  var nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === 'string' && /^\/(api|data)\//.test(input)) input = HOST + input;
    return nativeFetch(input, init);
  };

  var RE = /^(?:\.\/|\/)?(overview|news|ticker|chart|explorer|whitepaper)\.html(.*)$/;
  function map(url) {
    if (typeof url !== 'string') return url;
    var m = RE.exec(url);
    return m && PAGES[m[1]] ? PAGES[m[1]] + m[2] : url;
  }
  window.SS_URL = map;

  ['pushState', 'replaceState'].forEach(function (k) {
    var orig = history[k];
    history[k] = function (state, title, url) { return orig.call(history, state, title, url == null ? url : map(String(url))); };
  });

  function fix(a) {
    var h = a.getAttribute('href');
    if (h && RE.test(h)) a.setAttribute('href', map(h));
  }
  function sweep(node) {
    if (node.nodeType !== 1) return;
    if (node.tagName === 'A') fix(node);
    if (node.querySelectorAll) Array.prototype.forEach.call(node.querySelectorAll('a[href]'), fix);
  }
  new MutationObserver(function (list) {
    list.forEach(function (m) {
      if (m.type === 'attributes') fix(m.target);
      else Array.prototype.forEach.call(m.addedNodes, sweep);
    });
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });

  if (C.header === false) {
    var s = document.createElement('style');
    s.textContent = '.ss-app .topbar,.ss-app #shell-header{display:none!important}';
    document.head.appendChild(s);
  }
})();
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='https://client-facing--satstreet.netlify.app')
    args = ap.parse_args()
    host = args.host.rstrip('/')

    EMBED.mkdir(exist_ok=True)
    OUT.mkdir(exist_ok=True)
    defaults = '{' + ','.join('%s:"%s"' % (k, v) for k, v in SLUGS.items()) + '}'
    (EMBED / 'shim.js').write_text(SHIM.replace('__DEFAULT_PAGES__', defaults))

    config = ('<script>window.SATSTREET_EMBED={host:"%s",header:true,pages:{%s}};</script>'
              % (host, ','.join('%s:"%s"' % (k, v) for k, v in SLUGS.items())))

    report = []
    for page in PAGES:
        html = (PUBLIC / f'{page}.html').read_text()
        head, body = html.split('<body>', 1) if '<body>' in html else html.split('<body', 1)
        body = body.split('</body>', 1)[0]

        # Styles: linked stylesheets, page <style> blocks, and the layout CSS
        # Netlify's edge function normally injects.
        css = []
        for href in re.findall(r'<link rel="stylesheet" href="\./(assets/[^"]+\.css)"', head):
            css.append((PUBLIC / href).read_text())
        css += re.findall(r'<style[^>]*>(.*?)</style>', head, re.S)
        css.append(edge_css())
        imports, rest = take_imports('\n'.join(css))
        bundle = '/* Generated by tools/build-webflow.py: do not edit. */\n' + \
            '\n'.join(dict.fromkeys(imports)) + '\n' + \
            scope_css(RESET) + '\n' + scope_css(rest) + '\n' + AFTER.strip() + '\n'
        bundle = bundle.replace(SCOPE + ' ' + SCOPE, SCOPE)
        (EMBED / f'{page}.css').write_text(bundle)

        fonts = re.findall(r'<link[^>]+fonts\.googleapis\.com/css2[^>]*>', head)

        # Scripts, in page order: externals by absolute URL, inline ones hosted.
        tags, n = [], 0
        def take_script(m):
            nonlocal n
            attrs, code = m.group(1), m.group(2)
            if 'data-terminal-refresh' in attrs or '/.netlify/' in attrs:
                return ''
            src = re.search(r'src="\./([^"]+)"', attrs)
            if src:
                tags.append(f'<script src="{host}/{src.group(1)}"></script>')
            else:
                n += 1
                name = f'{page}-{n}.js'
                (EMBED / name).write_text('/* Generated by tools/build-webflow.py from public/%s.html */\n%s' % (page, code))
                tags.append(f'<script src="{host}/embed/{name}"></script>')
            return ''
        markup = re.sub(r'<script([^>]*)>(.*?)</script>', take_script, body, flags=re.S)

        markup = re.sub(r'<!--.*?-->', '', markup, flags=re.S)
        markup = re.sub(r'\n\s*\n+', '\n', markup)
        markup = '\n'.join(line.strip() for line in markup.splitlines() if line.strip())
        # Relative asset references (none expected) would point at Webflow.
        markup = markup.replace('src="./', f'src="{host}/').replace('href="./assets/', f'href="{host}/assets/')

        snippet = '\n'.join([
            f'<!-- Satstreet terminal · {TITLES[page]} page. Paste into one Webflow Embed element. Generated; do not edit by hand. -->',
            config,
            f'<script src="{host}/embed/shim.js"></script>',
            *fonts,
            f'<link rel="stylesheet" href="{host}/embed/{page}.css">',
            f'<div class="ss-app ss-page-{page}">',
            markup,
            '</div>',
            *tags,
        ]) + '\n'
        (OUT / f'{page}.html').write_text(snippet)
        report.append((page, len(snippet)))

    worst = 0
    for page, size in report:
        flag = 'OK' if size <= LIMIT else 'OVER LIMIT'
        worst = max(worst, size)
        print(f'{page:9s} {size:6,d} chars  {flag}')
    if worst > LIMIT:
        sys.exit(1)


if __name__ == '__main__':
    main()
