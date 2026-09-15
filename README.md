# Satstreet Marketing 

> **You are on `client-site`.** This branch is the client-facing cut of the
> terminal and deploys to its own Netlify site. It is not `main`.
>
> What is different here, and why: [`docs/client-site.md`](docs/client-site.md).
>
> Shared pages — Overview, Markets, Chart, Structure, Treasuries, Explorer,
> Portfolio — should be fixed on `main` and cherry-picked across, so the two
> sites do not drift. Only the removals and the de-personalisation belong to
> this branch alone.

Internal operating repository for building Satstreet's AI-enabled growth and operations system.

## Objective

Use AI and automation to help a small, high-touch team:

- create more qualified sales conversations,
- reduce repetitive internal work,
- improve client responsiveness,
- produce better marketing output,
- preserve Satstreet's human-first service model,
- and measure whether automation produces revenue or meaningful time savings.

## Operating principle

**AI should remove low-value work around the relationship, not replace the relationship.**

For meaningful client interactions, trading decisions, compliance judgments, approvals, and sensitive communications, a Satstreet team member remains accountable.

## Initial roadmap

1. **AI & Automation Audit** — map recurring workflows across Sales, Trading, Compliance, Client Service, Marketing, and Management.
2. **Automation Backlog** — score opportunities by revenue impact, time saved, implementation difficulty, and risk.
3. **Sales / BD MVP** — Daily Prospect List powered by the Prospect Intelligence Engine.
4. **Revenue workflows** — privacy-safe client reactivation, meeting prep, personalized outreach, follow-up, referral prospecting.
5. **Marketing / knowledge workflows** — social drafting, fact checking, internal knowledge retrieval.
6. **Measurement layer** — track adoption, hours saved, meetings created, funded accounts, and trading volume influenced.

## Data rules

This repository is for code, prompts, schemas, workflow definitions, tests, and documentation.

Do **not** commit:

- client PII,
- account numbers,
- private keys or seed phrases,
- passwords or API secrets,
- raw confidential CRM exports,
- sensitive compliance files,
- non-public client financial information.

Use environment variables / secret managers for credentials and approved systems of record for sensitive data.

## Current documents

- [AI & Automation Audit](docs/AI_AUTOMATION_AUDIT.md)
- [Sales / BD Audit](docs/SALES_BD_AUDIT.md)
- [Automation Backlog](docs/AUTOMATION_BACKLOG.md)
- [Process Interview Guide](docs/PROCESS_INTERVIEW_GUIDE.md)
- [Prospect Intelligence Engine — MVP Specification](specs/PROSPECT_INTELLIGENCE_ENGINE.md)

## Bitcoin Explorer

The public terminal includes a Bitcoin block explorer at `/explorer.html`. Its
browser code calls same-origin `/api/bitcoin/*` Netlify endpoints; the upstream
Esplora provider is isolated in `netlify/lib/bitcoin-service.mts`.

The default provider is Blockstream's public Esplora API. Set
`BITCOIN_ESPLORA_BASE_URL` in the Netlify environment to use another
Esplora-compatible provider, including a future Satstreet-hosted instance. The
feature uses public blockchain data only and does not connect to client-data
systems.
