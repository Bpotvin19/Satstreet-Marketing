# The `client-site` branch

`main` builds the desk terminal. This branch builds the client-facing site from
the same pages, and deploys to a separate Netlify site.

| | Branch | Site |
| --- | --- | --- |
| Desk | `main` | <https://satstreet.netlify.app> |
| Client | `client-site` | <https://satstreet-terminal.netlify.app> |

Both sites build from this one repository, each pinned to its own branch. A
push to `client-site` redeploys the client site and does not touch the desk
build; a push to `main` does the reverse. The production branch is set per
site in Netlify, so the thing to check after any change to a site's build
settings is that this one still says `client-site` — defaulting it back to
`main` would publish the desk build, Macro Desk and all, to the public URL.

The two share everything a client and the desk both look at — Overview, Markets,
Chart, Structure, Treasuries, Explorer, Portfolio. They differ only in what this
branch takes away.

## What is removed, and why

**The Macro Desk news page.** It says so itself, in its own header: *internal
only, not investment advice, not client copy*. It carried the desk's sourcing
notes, bias meters and rate-hike odds, and it sat behind a team access key.

**The Resource Centre.** Editorially owned in Notion and pre-rendered at deploy
time. Not finished client material.

Both are deleted from the tree rather than unlinked from the nav. An unlinked
page is still served, still indexable, and still readable by anyone who guesses
the URL — which for a page named `news.html` is not much of a guess.

## What that dragged with it

Nine endpoints existed only to feed those two pages, and they are gone too:

    news  news-thumbs  resources  resource-research
    system  workspace  prospect-owner
    _notion.ts  _system-content.ts

`/api/system` is the one to note. It served internal system content that was
deliberately kept out of `public/` so that View Source could not reach it — the
comment in the file says as much. Leaving the function behind while removing the
page that called it would have published exactly what it was written to protect.

`scripts/build-resource-cache.mjs` went with the Resource Centre, so the Netlify
build command here is a no-op.

## What was kept, deliberately

`/api/desknote` stays, and Overview still renders it. It reads one Notion
document type — `Client Email`, the one written to be sent to clients — and only
when its status is `Reviewed`. Both rules are enforced in the endpoint, not in
the page. It is client copy by construction.

`/api/news-image` stays too, despite the name. Treasuries uses it to proxy
company logos past CDNs that refuse a hotlink.

## The nav

`main` ships a nav and then patches it in an edge function at request time,
inserting Resources and swapping two tabs. This branch states the order it wants
in `public/assets/terminal.js` and the edge function no longer touches the nav
at all — a rewrite that reinstated Resources would put back the page this branch
exists to remove.

The edge function still injects layout CSS. That is all it does here.

## De-personalisation

No `Good morning, Ben.`, no `BP` avatar, no notification bell. The greeting is
by hour only. `main` strips these on the way out with a regex; here they are not
in the source to begin with.

## Not served, but still present

`marketing/` (the Telegram bot), `config/`, `outputs/` and `specs/` are still on
this branch. Netlify publishes `public/` and the functions directory, so none of
it reaches the site. It is carried so the branch stays a cheap rebase onto
`main` rather than a permanent fork.

## Keeping the two in step

    git checkout client-site
    git cherry-pick <commit-from-main>

Fix shared pages on `main` and bring them across. Changes that belong only to
the client cut — anything in this document — stay here.

## Event Odds

A read-only board of market-implied probabilities for rate decisions, Bitcoin
and Ethereum levels, and the macro backdrop, read from Polymarket's public
Gamma API through `/api/forecasts`.

It exists because a client should be able to see what a liquid market prices
for a Fed cut without Satstreet having said anything about it. That framing is
the whole basis on which this page is defensible: it reports a third party's
prices, the way Treasuries reports a third party's filings. It carries no
Satstreet interpretation, and it must not grow one. A number with a source and
a timestamp is reporting; the sentence after it would be advice.

### It cannot reach a venue

Polymarket is an exchange. The page must not be a route to it, and that is
enforced in the shape of the data rather than in the markup.

The upstream response carries `slug`, `conditionId`, `clobTokenIds` and
`marketMakerAddress` — everything needed to address a specific order book.
`/api/forecasts` copies none of them. What reaches the browser is a question,
a label, a probability, a volume and a date. There is no identifier in scope
on the page from which a link to a venue could be constructed, and a test
asserts that none of them appear in the response body.

There are no outbound links on the page at all. Attribution reads
`Source: Polymarket` as plain text, deliberately not an anchor.

### Two kinds of card

Upstream groups several markets under one heading, and they do not always mean
the same thing:

- `negRisk: true` — one question, one answer. Exactly one outcome resolves
  Yes and the prices sum to about 100%.
- `negRisk: false` — independent questions sharing a heading. "Will Bitcoin
  touch 75k", "touch 85k" are priced separately, and their prices sum to
  whatever they sum to. 380% is normal and correct.

Each card states which kind it is. Without that, the second kind reads as a
broken page to anyone who assumes the first.

### Scope

The tag list is fixed in the function and deliberately narrow: `fed`,
`bitcoin`, `ethereum`, `inflation`, `recession`. Polymarket's highest-volume
markets by far are US election politics, which is not what a desk opens this
for and not something a brokerage should put in front of clients. Widening the
list is a compliance decision, not a configuration change.
