export default async function terminalRefresh(_request: Request, context: any) {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  /* This function exists for one reason on this branch: the layout CSS below,
     which the pages are not carrying themselves yet.

     The desk build also uses it to rewrite the greeting, strip the staff
     avatar and patch the nav — inserting a Resources link and reordering two
     tabs. None of that happens here. The client pages ship de-personalised and
     in the right order already, and a nav rewrite that reinstated Resources
     would put back the page this branch exists to remove. */
  let html = await response.text();

  const css = `<style data-terminal-refresh>
  .avatar{display:none!important}.mainnav{gap:1px}.mainnav a{padding-left:8px;padding-right:8px}
  .pagehead{position:relative;min-height:148px;margin-bottom:28px;padding:14px 0 28px;gap:34px;align-items:flex-start;border-bottom:1px solid rgba(13,27,46,.085)}
  .pagehead>div:first-child{flex:1 1 620px;min-width:0;max-width:920px}.pagehead .eyebrow{margin:0 0 12px;font-size:11px;line-height:1.35;letter-spacing:1.28px;color:#59697a}
  .page-title-row{gap:15px;margin:0 0 12px;align-items:center}.pagehead h1{margin:0;font-size:39px;line-height:1.02;letter-spacing:-.55px}.page-emblem{width:48px;height:48px;border-radius:14px;background:linear-gradient(145deg,#e8f5fa,#f9fbfd 72%);border-color:#d1e5ed}
  .pagehead>div:first-child>p:last-child{max-width:72ch;font-size:16px;line-height:1.62;color:#465463}.pagehead>.feedstate{margin-top:8px;padding:7px 11px;border:1px solid #dfe7ee;border-radius:999px;background:rgba(255,255,255,.68);white-space:nowrap}.tabs{margin-bottom:24px}
  @media(max-width:900px){.navtoggle{display:block!important}.mainnav{display:none!important;position:absolute;top:58px;left:0;right:0;z-index:40;flex-direction:column;gap:0;margin:0;padding:6px 0 10px;background:var(--navy)}.mainnav.open{display:flex!important}.mainnav a{height:auto;padding:12px 20px}.pagehead{min-height:0;padding-top:6px;gap:18px}.pagehead h1{font-size:32px}}
  </style>`;

  const js = `<script data-terminal-refresh>(function(){function run(){var g=document.getElementById('greeting');if(g){var h=new Date().getHours();g.textContent='Good '+(h<12?'morning':h<17?'afternoon':'evening')+'.'}}if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run()})();</script>`;

  html = html.replace('</head>', css + '</head>').replace('</body>', js + '</body>');

  const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('etag');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}
export const config = { path: '/*' };
