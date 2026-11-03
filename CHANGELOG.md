# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/). Schema versions are independent of package versions.

## 0.2.0 — unreleased (not yet on npm)

- Security: `zod` moves from `^3.24.1` to `^4.6.7` (GHSA-mrhx-c7xc-m3w5, memory exhaustion on large arrays, fixed only in 4.6.6). `agentResearchReceiptSchema` is a zod 4 schema now, hence the minor bump. The receipt schema (v1.0), the published JSON Schema and every verdict are unchanged; the parity test reads zod 4's check definitions.
- Development: vitest 4.1.12.
- Development: vitest 4.1.11 / tsup 8.5.1, with esbuild held at ^0.28.1 by a pnpm override; clears dev-only advisories in the test and build toolchain. No runtime change.

## 0.1.1 — 2026-10-02

- `hey-receipt validate --online`: the headline answers the whole run. A receipt HEY does not confirm reads `NOT CONFIRMED (valid offline; HEY does not confirm it)` instead of `VALID`; a confirmed one `VALID (confirmed by HEY)`; an unfinished check `VALID (offline only; HEY check not completed)`. Exit codes are unchanged.
- Issue templates (bug, idea) with private security reporting and HEY corrections linked.

## 0.1.0 — 2026-10-02

Initial release.

- AgentResearchReceipt v1 Zod schema, types, examples and JSON Schema generator, extracted
  unchanged from HEY Research Lab's production contract.
- `schema/agent-research-receipt.v1.json`: the JSON Schema HEY publishes at
  `https://heyresearch.xyz/schemas/agent-research-receipt.v1.json`, byte for byte, with tests that
  hold it to the Zod schema (properties, required fields, enums, constants and verdicts on shared
  fixtures).
- HEY typed evidence-id parser and formatter for the fourteen public families (`ship`, `signal`,
  `abi`, `impl`, `lock`, `source`, `claim`, `state`, `integrity`, `narrative`, `method`,
  `sourcechange`, `security`, `v4hook`).
- `validateReceipt` / `validateReceiptJson`: a stateless offline validator — shape, Robinhood Chain
  only (`unsupported_chain` for any other chain), cited id syntax, 64 KB limit, forbidden-key and
  depth checks. Never fetches anything.
- `checkReceiptOnline`: an opt-in POST to HEY's public receipt validator.
- `summarizeReceipt` and the `hey-receipt` CLI (`validate`, `inspect`, `--json`, `--online`).
- Fixtures for valid receipts, invalid shapes, malformed ids, other chains, oversized input,
  prototype-pollution keys and saved validator answers.
