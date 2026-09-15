# Event Odds UI

## The one idea

A market's shape is drawn the way the market is actually built.

An **exclusive** market — the Fed decision, where exactly one outcome resolves
Yes — is a single distribution, so it gets **one segmented bar** with a legend.
You see 88% of the mass sitting on one outcome without reading a number.

An **independent** group — "will Bitcoin touch 75k", "touch 85k" — is several
separate questions that happen to share a heading. Those get **separate
tracks**. Drawing them as one bar would assert a relationship that is not
there, and would sum past 100% while doing it.

The endpoint already tells us which is which (`exclusive`, from upstream's
`negRisk`). This turns that flag from a footnote into the page's main visual
language, and each card still states its basis in words underneath.

## Featured market

One market spans the grid, chosen by **what is about to happen** rather than by
size: the soonest to resolve, subject to a volume floor of 10% of the largest
market on the page so a thin near-dated curiosity cannot take the slot. If
nothing resolves within 45 days, nothing is featured and the grid is uniform.

A market settling tomorrow is what a client opened the page for, and it should
not look like one settling in fourteen months. Resolution proximity is also a
chip on every card, warm-toned inside two weeks.

## Categories

Derived from the feed, never a fixed list. A hardcoded list produced six
permanently disabled chips — AI, Politics, Geopolitics, Oil, Commodities,
Rates — advertising sections `/api/forecasts` never returns. A disabled filter
is a promise the page cannot keep.

## What is deliberately absent

No anchors of any kind. The endpoint strips every venue identifier, so the page
has nothing to build a link from, and the tests assert the renderer emits no
`<a>` and contains no venue host. Attribution is plain text in the toolbar —
stated once, rather than repeated on all fourteen cards.

No interpretation. No "this implies", no desk reading. A number with a source
and a timestamp is reporting; the sentence after it would be advice.

## Known repetition

The leading outcome appears twice on each card: once as the headline figure,
once in the legend or track list below. This is summary-then-detail and is
intentional — the legend must label every segment of the bar, including the
largest, or the bar has an unlabelled region. It is not the same as the earlier
layout, which printed two visually identical adjacent rows plus a redundant
`LEADING` badge.

## Data behaviour

Same-origin `/api/forecasts`, refreshed every two minutes. No bundled fixtures.
A failed or empty response replaces the grid with a retryable state that shows
nothing stale or estimated in place of real numbers.
