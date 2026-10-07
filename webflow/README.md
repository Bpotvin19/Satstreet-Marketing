# Satstreet terminal on Webflow

Five pages, one snippet each. Every snippet is well under Webflow's 50,000-character limit for an Embed element.

| Webflow page | Suggested slug | Paste this file | Size |
| --- | --- | --- | --- |
| Overview | `/overview` | `overview.html` | ~9.6k chars |
| News | `/news` | `news.html` | ~3.0k chars |
| Markets | `/markets` | `ticker.html` | ~6.4k chars |
| Chart | `/chart` | `chart.html` | ~2.6k chars |
| Explorer | `/explorer` | `explorer.html` | ~8.5k chars |

## Setting up each page

1. In Webflow, create the page with the slug in the table above.
2. Add one **Embed** element (Add panel → Components → Code Embed) where the terminal should appear, usually right under the site navigation, and set it to full width.
3. Open the matching `.html` file, copy **all** of it, paste it into the Embed, and save.
4. Publish. The pages only run on the **published** site; the Designer canvas shows an empty box, which is expected.

## If you use different slugs

The second line of every snippet is a small config:

```html
<script>window.SATSTREET_EMBED={host:"https://…",header:true,pages:{overview:"/overview",news:"/news",ticker:"/markets",chart:"/chart",explorer:"/explorer"}};</script>
```

Change the paths in `pages` to match your Webflow slugs, using the **same values in all five snippets**. Links between the pages (for example, a Markets row opening its Chart, or a headline opening on News) follow these paths.

## The terminal's own navigation bar

Each page shows the terminal's dark navigation bar (Overview · News · Markets · Chart · Explorer) under your site navigation. To hide it and rely on the Webflow navigation instead, change `header:true` to `header:false` in all five snippets.

## What still runs on Netlify

Prices, news, charts and the block explorer are served by small functions on Netlify (`host` in the config line), which Webflow cannot run. The page styles and scripts are also loaded from there, which keeps the snippets small and means most updates go live without anything being re-pasted. That Netlify site must stay up.

The host is currently the `client-facing` branch preview. For production, a Netlify site dedicated to that branch (for example `satstreet-terminal.netlify.app`, or `terminal.satstreet.com`) is better; changing hosts means updating `host` in the five snippets.

## Notes

- Clients' names and custom watchlists on the Overview are stored in their own browser on that device. Nothing is sent to Satstreet.
- All styles are scoped inside a `.ss-app` wrapper, so the Webflow theme and the terminal do not restyle each other. If a site-wide custom script or style targets bare elements very aggressively (for example `* { … !important }`), check the pages after publishing.
- Regenerating the snippets: `python3 tools/build-webflow.py` in the repository.
