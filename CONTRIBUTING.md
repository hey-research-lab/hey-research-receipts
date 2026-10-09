# Contributing

Thank you for helping. This repository holds a public contract, so changes are careful and small.

## Setup and checks

```sh
corepack enable
pnpm install
pnpm scan        # leak and attribution scan (scripts/scan.mjs)
pnpm lint
pnpm typecheck
pnpm test        # saved fixtures only; the network is blocked in tests
pnpm build
```

Never commit secrets, `.env` files with values, or anything a test fetched live.

## What may change

- **The v1 contract does not change here.** `src/schema.ts`, `src/examples.ts`,
  `src/evidence-ids.ts` and `schema/agent-research-receipt.v1.json` mirror HEY Research Lab's
  production contract. A change to the receipt format is made by HEY and served at
  `https://heyresearch.xyz/schemas/…` first; this repository then re-extracts it. Within v1,
  changes are additive; a semantic change is a new major version served beside v1.
- The validator, the online check, the summary and the CLI are this package's own and welcome
  improvements, as long as they never fetch a URL a receipt names, never turn an unknown into
  `0`/`false`, and never phrase a result as a recommendation, a safety verdict or an endorsement.
- New evidence-id families arrive only from HEY's public parser.

## Parity (maintainers)

The contract files were extracted from HEY Research Lab's production contract at commit
`21775391f6c0fb4494575e0b4463df535c65cb96` (2026-10-02):

| File here                               | Production source                                                                             | Relation                                                                                                                                                                                    |
| --------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`                         | the receipts schema module (imports only `zod`)                                               | byte-identical except one doc comment (lines 60–61) that named an internal test file, reworded                                                                                              |
| `src/examples.ts`                       | the receipts examples module                                                                  | byte-identical (sha256 `5b468041209e7cb0f85864840f755198ddb0a2f27b3255db830a0ecea66eef16`)                                                                                                  |
| `src/evidence-ids.ts`                   | the evidence-id module, lines 4–188 (families, parser, formatter)                             | byte-identical excerpt below a three-line header; the remainder of that module depends on HEY internals                                                                                     |
| `schema/agent-research-receipt.v1.json` | `GET https://heyresearch.xyz/schemas/agent-research-receipt.v1.json`, read once on 2026-10-02 | byte-identical (12,868 bytes, no trailing newline, sha256 `af9dd9caa65035a183f75e5363b4bc399a66d69b6dc76e32c8dd8562d0c9592b`); a test asserts the extracted generator reproduces it exactly |
| `src/chain.ts`                          | HEY ecosystem conventions                                                                     | verbatim                                                                                                                                                                                    |

Production sha256 at that commit: schema module
`3915f74b08f84be07cb3d7b30720ebed45ebc93d752c25e0c2e62b4d9af5cd27`; evidence-id excerpt
(lines 4–188) `97a544d35fda3cb2b8fde5496733ab8475402668fdcef1ac03058de89ae0e736`.

Re-checked against production as of 2026-10-09: the schema module, the examples module, the
evidence-id excerpt and the published JSON Schema all still have the hashes above, and production's
validator (`POST /api/receipts/validate`) is unchanged, so 0.1.1 matches production and needs no
release.

To re-check against a newer production commit, a maintainer with access diffs the three modules
and re-reads the published JSON Schema once; `pnpm test` then proves the generator, the Zod
schema and the published file still agree. These files are excluded from Prettier so their bytes
stay identical.

The receipt's capability list (`RECEIPT_AGENT_CAPABILITIES`) is held equal to HEY's agent contract
in production; this package keeps its own copy and does not depend on
`@hey-research-lab/agent-contract` at runtime.

## Commits

Small conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`). Run
`git log --format=fuller` and `pnpm scan -- --git` before you push.
