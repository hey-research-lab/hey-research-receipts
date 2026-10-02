# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the package uses
[Semantic Versioning](https://semver.org/). Schema versions are independent of package versions.

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
