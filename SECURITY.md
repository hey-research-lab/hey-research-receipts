# Security policy

## Reporting a vulnerability

Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope

The package reads untrusted receipts: JSON written by agents nobody here knows.

- **Input size and structure.** A receipt is at most 64 KB; larger input is refused before it is
  parsed (the CLI stops reading at 64 KB + 1 byte). `__proto__`, `constructor` and `prototype`
  keys are refused at any depth before the schema runs, nesting deeper than 32 levels is refused
  iteratively, and every object in the schema is strict.
- **No fetching of receipt contents (SSRF).** URLs inside a receipt (`external`, `market_observation`,
  `hey_agent_answer`, `sourceSystems`, `signature.jku`, `researchState.vocabulary`) are data. The
  validator and the CLI never request them, and HEY's validator does not either.
- **One opt-in network call.** `hey-receipt validate --online` / `checkReceiptOnline` sends the
  receipt to the fixed URL `https://heyresearch.xyz/api/receipts/validate` — https only, no
  configurable host, redirects refused, 10 s timeout, at most 64 KB sent and 256 KB read, no
  cookies or credentials. Nothing else in the package uses the network.
- **Files.** The CLI reads one regular file or stdin; it refuses symbolic links (`lstat`, then
  `O_NOFOLLOW` where the platform has it) and anything that is not a regular file. It writes no
  files and starts no processes.
- **Terminal output.** Agent-written text is printed with control, escape, bidirectional and
  zero-width characters removed.

## Handling secrets

This project never needs HEY credentials, and it reads no tokens or environment variables. Never
commit a `.env` with values.

## Supported versions

The latest 0.x minor receives fixes.
