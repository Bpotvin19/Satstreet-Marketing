Subject: Satstreet AI build — where it stands, and the two decisions I need

Mike, Jon,

Here is the full picture of what has been built across Notion, the Grok
content pipeline and the terminal, what is public versus internal, and what
it takes to run any of it without me at my desk.

Full write-up, with the architecture and the status ledger:
→ https://claude.ai/artifact/JUduKAoX5RbGbzbR41BQDE

Ten minutes of reading. The short version follows.

---

WHAT THE CLIENT PRODUCT IS

A public market terminal at a Satstreet URL, with seven tabs: Overview
(cross-asset monitor plus the morning desk note), Markets, Chart, Structure,
Treasuries, a native Bitcoin Explorer, and a watch-only Portfolio.

No login, no client data, nothing to breach. It is a reference tool a
prospect can use before they ever speak to us — which is a claim about
competence that a brochure cannot make.

WHAT THE INTERNAL SYSTEM IS

Notion is the system of record. Grok's Founder News Desk harvests news
overnight into a Notion Content Queue. A Telegram bot reads those cards,
rewrites them in a founder voice, runs them through a compliance gate, and
presents them to the team — 26 commands. A separate pipeline produces the
weekday client brief at 8:00 and 16:30 ET.

The division of labour is deliberate and it is enforced in code:

    Grok harvests  ·  the bot rewrites  ·  a person publishes

Nothing publishes itself. The Approve button does not render on a draft that
fails compliance, and approval re-runs the check, so a rule added after
drafting still catches it.

PUBLIC VERSUS INTERNAL

Public: the seven tabs, live market and chain data, and the desk note — and
the desk note only when it is typed "Client Email" and marked "Reviewed",
both enforced in the endpoint rather than in the page.

Internal: the Macro Desk (which carries sourcing notes, bias meters and
rate-hike odds), the Resource Centre, the team workspace, the prospect
lists, and the Notion workspace itself.

The internal pages are deleted from the client build, not hidden from its
menu. An unlinked page is still served and still indexable, and for a page
named news.html the URL is not much of a guess. Nine backend endpoints went
with them — including one that served internal content deliberately kept out
of the public directory so View Source could not reach it.

HOW IT GENERATES LEADS

Four mechanisms: distribution (the content loop drops the cost of publishing
to a review decision), credibility (the terminal is a working tool, not a
brochure), targeting (the prospect engine produces a ranked daily list from
public data, with a reason each entity matters now), and retention (the
brief gives clients a reason to open something from us every morning
instead of once a month).

No outreach is ever sent automatically. The engine ranks and drafts; a
salesperson decides and sends.

WHAT IS DONE

The desk terminal is live. The client terminal is built, tested and
committed on its own branch. The public/internal separation is complete. The
bot, the compliance gate, the Grok→Notion→bot loop, the brief pipeline and
the first prospect lists all exist and have been run.

WHAT REMAINS — AND THIS IS THE PART I NEED HELP WITH

Built is not operating. Everything above has been run and verified, but by
me, by hand. There is no host and no scheduler.

Jon, five things:

  1. An always-on host with cron at 08:00 and 16:30 ET. This is the single
     biggest gap between "built" and "running".
  2. Secrets out of the .env on my laptop and into a real store, with a
     rotation owner. The Notion token is workspace-scoped.
  3. A Netlify site pointed at the client branch, plus a DNS record.
  4. Licensed feeds for ETF flows, derivatives and news. All three are
     currently unset — they report as unavailable rather than showing wrong
     numbers, so nothing is broken, but three sections of the brief run empty.
  5. One security fix: the image proxy's private-host guard never fired, and
     cloud instance metadata was reachable through it. Already fixed on the
     client branch, still present on main, which is what is live today.
     Worth porting before anything else ships.

PROPOSED PILOT

  Week of Sep 15   Infrastructure. Host, scheduler, secrets, staging URL.
                   Port the security fix. No clients.
  Week of Sep 22   Dry run. Everything on schedule, desk only. We find out
                   what breaks when nobody is watching.
  Sep 29 – Oct 10  Pilot. Client terminal goes public. Five to ten clients
                   get the brief as a Notion guest page. Sales runs the
                   prospect list daily and records disposition.
  Week of Oct 13   Review and decide.

Deliberately small. The expensive mistake would be building authentication
and a hosted dashboard for a brief clients are not reading — and inviting ten
clients to a Notion page tells us that at no engineering cost.

THE TWO DECISIONS I NEED

  1. The hostname. terminal.satstreet.com reads as a tool;
     client.satstreet.com implies a login that V1 does not have.
  2. An owner for the host and the secrets.

Everything in the engineering list is blocked behind those two. Nothing else
in the build changes depending on the answer.

Happy to walk either of you through it live, or to put the client build on a
staging URL before we meet if that is more useful than reading a diff.

Ben
