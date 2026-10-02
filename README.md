# hey-research-receipts

The specification, JSON Schema, Zod schema, TypeScript types and a stateless validator for
**AgentResearchReceipt v1** — a small JSON record of what an autonomous agent cited and concluded
about a Robinhood Chain project, token or contract, as of when.

[![CI](https://github.com/hey-research-lab/hey-research-receipts/actions/workflows/ci.yml/badge.svg)](https://github.com/hey-research-lab/hey-research-receipts/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-informational.svg)](package.json)
[![Robinhood Chain 4663](https://img.shields.io/badge/Robinhood%20Chain-4663-informational.svg)](#why-robinhood-chain-only)

## Why it exists

An agent that researched a project should be able to say, in a form anyone can check, _"I reached
this conclusion from these facts, as of this time."_ HEY Research Lab defined that shape for its
public API, publishes its JSON Schema and runs a stateless validator. This package is that
contract as an installable library and a command-line tool, so agents and research tooling can
write, validate and read receipts offline, without depending on HEY's servers.

## Why Robinhood Chain only

HEY researches Robinhood Chain (chain id `4663`, CAIP-2 `eip155:4663`). The v1 schema itself
accepts any positive `chainId` and is exported here unchanged, so it stays identical to the schema
HEY publishes. The validator and the CLI add one rule on top: a receipt whose subject is on any
other chain is reported as **`unsupported_chain`** — an invalid receipt, exit code 1.

## Install

```sh
npm install @hey-research-lab/research-receipts
# or run the CLI without installing
npx -p @hey-research-lab/research-receipts hey-receipt --help
```

Node.js 18 or newer. One runtime dependency: [`zod`](https://zod.dev) 3.

## Smallest working example

Offline, no network:

```sh
hey-receipt validate receipt.json      # shape, Robinhood Chain, cited id syntax
hey-receipt inspect receipt.json       # what the receipt says it used
cat receipt.json | hey-receipt validate - --json
```

From code:

```ts
import { validateReceiptJson, summarizeReceipt } from '@hey-research-lab/research-receipts';

const result = validateReceiptJson(text); // never fetches anything
if (!result.valid)
  console.error(result.errors); // [{ code, path, message }]
else console.log(summarizeReceipt(result.receipt!).citedEvidence);
```

## The receipt

A receipt carries `type: "AgentResearchReceipt"`, `version: "1.0"`, the agent's own `agentId`
(plus optional `operator` and `mandate`, all self-declared), a `subjectType` (`project`, `token`
or `contract`) and `subject` (`chainId` and the slug, token contract or contract), `createdAt` and
an `evidenceCutoff` that is never later, a `thesisSummary` (at most 600 characters; not a reasoning
trace), `claims[]` (each `FACT`, `DERIVED` or `JUDGEMENT`; a FACT or DERIVED claim cites at least
one piece of evidence), `risks[]`, `unknowns[]` (optionally with HEY's unknown `category`), the
agent's own `researchState` and optional `outcome` (always `decidedBy: "agent"`), an optional
`confidence` (0–1 or null), `reviewConditions[]`, `sourceSystems[]` and an optional detached
`signature` (not verified by HEY or by this package). Unknown fields are refused anywhere, so there
is no place for a chain-of-thought.

Evidence references are one of six kinds:

| `kind`               | What it names                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `hey_evidence`       | A HEY typed evidence id, resolvable at `https://heyresearch.xyz/api/evidence/{id}`       |
| `hey_change_event`   | A change-ledger event id from `/api/changes`, with the `revision` read                   |
| `hey_snapshot`       | A project snapshot as read: slug, `asOf`, `scoringVersion`                               |
| `hey_agent_answer`   | One answer of HEY's agent contract, as its `citation` object                             |
| `market_observation` | A market reading: provider, `observedAt`, field — market context, never builder evidence |
| `external`           | Any other public `https://` URL and when it was read                                     |

- JSON Schema (draft 2020-12): [`schema/agent-research-receipt.v1.json`](schema/agent-research-receipt.v1.json),
  byte-for-byte the file HEY serves at
  `https://heyresearch.xyz/schemas/agent-research-receipt.v1.json`. Also importable as
  `@hey-research-lab/research-receipts/schema/agent-research-receipt.v1.json`.
- Zod: `agentResearchReceiptSchema` (the schema HEY's validator runs), `evidenceRefSchema`.
- Types: `AgentResearchReceipt`, `EvidenceRef`.
- Examples: `EXAMPLE_RECEIPT_OTHER_PROJECT`, `EXAMPLE_RECEIPT_HEY` (and the JSON files under
  [`fixtures/valid`](fixtures/valid)). The ids in them are illustrative.

### Typed evidence ids

A `hey_evidence` id must be one of HEY's public typed families (the list HEY's own parser accepts):

`ship:<uuid>` · `signal:<uuid>` · `abi:<uuid>` · `source:<uuid>` · `claim:<uuid>` · `method:<uuid>` ·
`sourcechange:<uuid>` · `impl:<chainId>:<address>:<block>:<logIndex>` (or `…:rpc:<uuid>`) ·
`lock:<chainId>:<lockId>` · `state:<projectUuid>:<key>:<transitionId>` ·
`integrity:<tokenUuid>:<key>` · `narrative:<projectUuid>:<slug>` ·
`security:<projectUuid>:<audit|bounty|contact>:<16 hex>` · `v4hook:<chainId>:<address>`

An event id with a suffix (`source:<uuid>:added`) is a change-event id, not an evidence id: cite
it as `hey_change_event`. `parseEvidenceId` and `formatEvidenceId` are exported.

## `hey-receipt` reference

```
hey-receipt validate <file|->  [--json] [--online] [--quiet]
hey-receipt inspect  <file|->  [--json]
hey-receipt --help | --version
```

**validate** checks, offline: the v1 shape; that the subject is on Robinhood Chain; that each
`hey_evidence` id is a well-formed typed id, each `hey_change_event` id starts with one of HEY's
change families, and each `hey_agent_answer` URL is that capability on `https://heyresearch.xyz`.
It reports `market_observation` and `external` references as `not_checked` / `not_a_hey_id` and
never fetches them.

**validate --online** additionally sends the receipt — and nothing else — to HEY's public
validator, `POST https://heyresearch.xyz/api/receipts/validate`, which answers whether each cited
HEY id exists and still stands (`exists`, `revised`, `project_exists`, `withdrawn`, `moved`,
`not_found`, `invalid_id`, `not_checked`) and `heyEvidenceStands` (`true`, `false`, `"partial"`
or `null`). Only when you pass `--online`; https only; the URL is fixed; at most 64 KB sent and
256 KB read; redirects refused; 10 s timeout; HEY allows 30 checks a minute per client and a 429 is
reported with its delay, never retried. A receipt that is invalid offline is not sent.

**inspect** prints what the receipt says it used: the subject, mandate and thesis (as the agent
states them), every cited reference once with its time and where HEY resolves it, freshness
(creation, evidence cutoff and its age now, the oldest and newest cited times), content origins
(HEY records, HEY agent answers, market providers, external URLs, the declared source systems),
unknowns, risks, review conditions, the offline validation, and the neutrality statement below.
Agent text is printed as data: control, escape and bidirectional characters are removed.

`--json` prints exactly one JSON document (`hey-receipt.validate/v1` or `hey-receipt.inspect/v1`)
on stdout. Unknown values stay `null` with a reason (`confidence: { value: null, reason:
"not_stated" }`), never `0`.

| Exit | Meaning                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | valid (and, with `--online`, HEY's evidence check did not fail)                                                                                         |
| 1    | invalid receipt or failed check: shape, `unsupported_chain`, malformed id, over 64 KB, not JSON, a forbidden key, or HEY says a cited id does not stand |
| 2    | usage error (bad flag or argument, missing file, symbolic link, not a file)                                                                             |
| 3    | HEY refused the request (4xx other than 404/429)                                                                                                        |
| 4    | not found (404)                                                                                                                                         |
| 5    | rate limited (429) — retry after the printed delay                                                                                                      |
| 6    | network failure, timeout or HEY 5xx                                                                                                                     |

Error codes in results: `invalid_json`, `payload_too_large`, `forbidden_key`, `too_deep`,
`invalid_shape`, `unsupported_chain`, `invalid_evidence_id`, `invalid_change_event_id`,
`invalid_agent_answer_url`. Warnings: `evidence_id_other_chain`, `change_event_revision_not_given`.

## How it relates to HEY Research Lab

The Zod schema, the examples and the evidence-id parser are extracted unchanged from HEY Research
Lab's production code, and the JSON Schema is the one HEY publishes; tests hold the Zod schema and
the published JSON Schema to the same required fields, enums and verdicts. HEY's own validator
remains the only place that can say whether a cited HEY id exists; this package checks shape and
syntax offline and, on request, asks that validator. HEY's private quality gate stays
authoritative, and nothing about receipts reaches HEY's activity status, Build Momentum, Discovery
Gap or Builder Radar.

Links: [Developers](https://heyresearch.xyz/developers) ·
[Agents guide](https://heyresearch.xyz/developers/agents) ·
[Public API](https://heyresearch.xyz/docs/public-api) ·
[Receipt JSON Schema](https://heyresearch.xyz/schemas/agent-research-receipt.v1.json) ·
[Receipt validator](https://heyresearch.xyz/api/receipts/validate)

## What it does NOT prove

A research receipt records what an agent cited and concluded under its own mandate. A valid
receipt is not a recommendation, not proof that a token is safe or a project legitimate, not a buy
signal and not an endorsement by HEY. HEY stores no receipts and ranks none.

In particular, a receipt records what research response and evidence an agent used. It is not an
investment recommendation, not proof that a token is safe, not proof that a project is legitimate,
not a buy signal and not a ranking endorsement. `researchState` and `outcome` are the agent's own
words with the agent's own definitions. HEY stores nothing and fetches nothing a receipt names, and
neither does this package: a URL inside a receipt is data, never a request (SSRF).

HEY Research Lab is an independent research project and is not affiliated with, endorsed by or
partnered with Robinhood Markets, Inc. or Robinhood Chain.

## Security

See [SECURITY.md](SECURITY.md). The offline validator reads only the document it is given and
makes no network calls. Inputs are capped at 64 KB before parsing; `__proto__`, `constructor` and
`prototype` keys are refused anywhere; nesting is capped; every object is strict. The CLI reads one
regular file (never through a symbolic link) or stdin. The only network call is the opt-in
`--online` POST to the fixed HEY URL above. No credentials are needed or sent.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). `pnpm install`, then `pnpm lint`, `pnpm typecheck`,
`pnpm test`, `pnpm build` and `pnpm scan` (leak scan). Tests use saved fixtures and cannot reach
the network. Never commit secrets.

## Licence

MIT © 2026 HEY Research Lab. See [LICENSE](LICENSE).
