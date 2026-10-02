import { parseArgs } from 'node:util';

import { CAIP2, CHAIN_ID, CHAIN_NAME } from './chain';
import { readReceiptFile, readStdin, type InputResult } from './input';
import { RECEIPT_NOT_PROOF } from './notice';
import { checkReceiptOnline, type OnlineResult } from './online';
import { plainDuration, summarizeReceipt, type ReceiptSummary } from './summary';
import { cleanText } from './text';
import { failedValidation, validateReceiptJson, type OfflineValidation } from './validate';
import { PACKAGE_VERSION } from './version';

/** Exit codes, as every HEY ecosystem CLI uses them. */
export const EXIT = {
  ok: 0,
  invalid: 1,
  usage: 2,
  refused: 3,
  notFound: 4,
  rateLimited: 5,
  network: 6,
} as const;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdin: AsyncIterable<Uint8Array | string>;
  /** Injected for tests; the online check uses the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const HELP = `hey-receipt ${PACKAGE_VERSION} — AgentResearchReceipt v1 tools for Robinhood Chain (${CHAIN_ID})

Usage
  hey-receipt validate <file|->  [--json] [--online] [--quiet]
  hey-receipt inspect  <file|->  [--json]
  hey-receipt --help | --version

validate   Checks the receipt offline: its shape against the v1 schema, that its subject is on
           Robinhood Chain (4663), and the syntax of every HEY id it cites. Fetches nothing.
  --online   Also asks HEY's public validator (POST https://heyresearch.xyz/api/receipts/validate,
             30 checks a minute) whether the cited HEY ids exist. Sends only the receipt.
inspect    Prints what the receipt says it used: the subject and mandate, cited evidence ids,
           freshness, content origins and unknowns.

Options
  --json       Print one JSON document on stdout.
  --quiet      Print nothing; use the exit code.
  --no-color   Accepted for compatibility; output is never coloured.

Exit codes
  0 valid · 1 invalid receipt or a failed check (unsupported_chain included) · 2 usage error
  3 HEY refused the request · 4 not found · 5 rate limited · 6 network failure, timeout or HEY 5xx

${RECEIPT_NOT_PROOF}
`;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const chainBlock = { name: CHAIN_NAME, chainId: CHAIN_ID, caip2: CAIP2 };

async function readInput(arg: string, io: CliIo): Promise<InputResult> {
  return arg === '-' ? readStdin(io.stdin) : readReceiptFile(arg);
}

/** Offline result without the parsed receipt (it is the input; printing it back adds nothing). */
const publicOffline = (offline: OfflineValidation): Omit<OfflineValidation, 'receipt'> => {
  const { receipt: _receipt, ...rest } = offline;
  return rest;
};

function onlineExit(result: OnlineResult): number {
  if (result.ok) {
    const { answer } = result;
    return answer.valid &&
      answer.heyEvidenceStands !== false &&
      answer.subject?.status !== 'not_found'
      ? EXIT.ok
      : EXIT.invalid;
  }
  switch (result.error.code) {
    case 'payload_too_large':
      return EXIT.invalid;
    case 'rate_limited':
      return EXIT.rateLimited;
    case 'not_found':
      return EXIT.notFound;
    case 'refused':
      return EXIT.refused;
    default:
      return EXIT.network;
  }
}

function printOffline(label: string, offline: OfflineValidation, out: string[]): void {
  out.push(`${offline.valid ? 'VALID' : 'INVALID'}  ${label} — AgentResearchReceipt v1`);
  if (offline.shapeValid) out.push('  shape: valid against the v1 schema');
  if (offline.subject) {
    const chain =
      offline.subject.chainId === CHAIN_ID
        ? `${CHAIN_NAME} (${CHAIN_ID})`
        : `chain ${offline.subject.chainId} (not supported)`;
    out.push(`  subject: ${offline.subject.subjectType} on ${chain}`);
  }
  for (const error of offline.errors)
    out.push(`  error ${error.code} at ${error.path}: ${cleanText(error.message, 300)}`);
  for (const warning of offline.warnings)
    out.push(`  warning ${warning.code} at ${warning.path}: ${cleanText(warning.message, 300)}`);
  if (offline.evidence) {
    const hey = offline.evidence.heyReferences;
    const other = offline.evidence.total - hey;
    const malformed = offline.evidence.results.filter((r) => r.status === 'invalid_id').length;
    out.push(
      `  evidence: ${offline.evidence.total} reference(s) cited — ${hey} HEY reference(s), syntax checked offline${malformed ? ` (${malformed} malformed)` : ''}; ${other} market or external reference(s), not fetched`,
    );
  }
}

function printOnline(result: OnlineResult, out: string[]): void {
  if (!result.ok) {
    const e = result.error;
    out.push(`  HEY check: not completed — ${e.code}: ${cleanText(e.message, 300)}`);
    if (e.retryAfterSeconds !== undefined) out.push(`  retry after: ${e.retryAfterSeconds} s`);
    if (e.requestId) out.push(`  request id: ${cleanText(e.requestId, 120)}`);
    return;
  }
  const a = result.answer;
  out.push(`  HEY check (${result.url}): shape ${a.valid ? 'valid' : 'invalid'}`);
  for (const error of a.errors.slice(0, 50))
    out.push(`    error at ${cleanText(error.path, 200)}: ${cleanText(error.message, 300)}`);
  if (a.subject)
    out.push(
      `    subject: ${a.subject.status}${a.subject.reason ? ` (${cleanText(a.subject.reason, 80)})` : ''}`,
    );
  for (const r of a.evidence?.results ?? []) {
    out.push(
      `    ${r.status.padEnd(14)} ${cleanText(r.kind, 30)} ${cleanText(r.ref, 200)}${r.reason ? ` (${cleanText(r.reason, 80)})` : ''}${r.scoringVersion ? ` [scoring ${r.scoringVersion}]` : ''}`,
    );
  }
  const stands = a.heyEvidenceStands;
  const standsText =
    stands === true
      ? 'yes — every cited HEY reference was checked and stands'
      : stands === false
        ? 'no — at least one checked HEY reference does not stand'
        : stands === 'partial'
          ? 'partly — every checked one stands, some were not checked'
          : 'unknown — no HEY reference was checked';
  out.push(`    HEY evidence stands: ${standsText}`);
  out.push(`    stored: ${String(a.stored)} · endorsement: ${String(a.endorsement)}`);
  if (result.requestId) out.push(`    request id: ${cleanText(result.requestId, 120)}`);
}

function printSummary(
  label: string,
  s: ReceiptSummary,
  offline: OfflineValidation,
  out: string[],
): void {
  const q = s.question;
  const chain = q.onRobinhoodChain
    ? `${CHAIN_NAME} (${CHAIN_ID})`
    : `chain ${q.chainId} — not supported by this tool`;
  out.push(`AgentResearchReceipt v1 — ${label}`, '');
  out.push('What was researched');
  out.push(`  Subject:         ${q.subjectType} ${q.subject} on ${chain}`);
  out.push(
    `  Mandate:         ${q.mandate.value !== null ? `${q.mandate.value} (self-declared)` : 'not stated'}`,
  );
  out.push(`  Thesis summary:  ${q.thesisSummary}`);
  out.push(`  Agent:           ${s.agent.agentId} (self-declared; HEY does not verify it)`);
  if (s.agent.operator) out.push(`  Operator:        ${s.agent.operator} (self-declared)`);
  out.push(
    `  Signature:       ${s.agent.signature === 'absent' ? 'none' : 'present, not verified'}`,
  );
  out.push(
    `  Research state:  ${s.researchState.value} — ${s.researchState.definition} (the agent's own vocabulary)`,
  );
  out.push(
    `  Outcome:         ${s.outcome.value === null ? 'not stated' : `${s.outcome.value}, decided by the agent${'definition' in s.outcome && s.outcome.definition ? ` — ${s.outcome.definition}` : ''}`}`,
  );
  out.push(
    `  Confidence:      ${s.confidence.value === null ? 'not stated' : `${s.confidence.value} (the agent's own)`}`,
  );
  out.push('');

  const f = s.freshness;
  out.push('Freshness (as the agent states it)');
  out.push(`  Created:          ${f.createdAt}`);
  out.push(
    `  Evidence cutoff:  ${f.evidenceCutoff} (${plainDuration(f.cutoffBeforeCreatedSeconds)} before creation; ${plainDuration(f.cutoffAgeSecondsAtInspection)} ${f.cutoffAgeSecondsAtInspection >= 0 ? 'before' : 'after'} this inspection)`,
  );
  out.push(
    `  Cited times:      ${f.oldestCitedAt ? `oldest ${f.oldestCitedAt}, newest ${f.newestCitedAt ?? f.oldestCitedAt}` : 'no cited reference carries a time'}${f.citedWithoutTime ? `; ${f.citedWithoutTime} reference(s) without a time` : ''}`,
  );
  out.push('');

  out.push(
    `Claims (${s.claims.total}: ${s.claims.FACT} FACT, ${s.claims.DERIVED} DERIVED, ${s.claims.JUDGEMENT} JUDGEMENT)`,
  );
  for (const c of s.claims.items)
    out.push(`  [${c.kind}] ${c.statement}${c.cites ? ` — cites ${c.cites}` : ''}`);
  out.push('');

  out.push(`Cited evidence (${s.citedEvidence.length}, each once)`);
  if (s.citedEvidence.length === 0) out.push('  The receipt cites no evidence.');
  for (const r of s.citedEvidence) {
    const parts = [r.kind.padEnd(18), r.ref];
    if (r.detail) parts.push(`· ${r.detail}`);
    if (r.at) parts.push(`· ${r.atField} ${r.at}`);
    out.push(`  ${parts.join(' ')}`);
    if (r.resolveAt) out.push(`  ${' '.repeat(18)} resolves at ${r.resolveAt}`);
  }
  out.push('');

  const o = s.contentOrigins;
  out.push('Content origins');
  out.push(`  HEY records:          ${o.heyRecords}`);
  out.push(`  HEY agent answers:    ${o.heyAgentAnswers}`);
  out.push(
    `  Market providers:     ${o.marketProviders.length ? `${o.marketProviders.join(', ')} (market context, never builder evidence)` : 'the receipt cites none'}`,
  );
  out.push(`  External URLs:        ${o.externalUrls} (named by the agent; not fetched)`);
  out.push(
    `  Source systems:       ${o.sourceSystems.map((x) => `${x.name}${x.url ? ` <${x.url}>` : ''}${x.apiVersion ? ` API ${x.apiVersion}` : ''}`).join('; ')} (as the agent declares them)`,
  );
  out.push('');

  out.push(`Unknowns (${s.unknowns.length})`);
  if (s.unknowns.length === 0) out.push('  The agent listed no unknowns.');
  for (const u of s.unknowns)
    out.push(
      `  - ${u.statement}${u.category ? ` [${u.category}]` : ''}${u.coverageDimension ? ` (coverage: ${u.coverageDimension})` : ''}`,
    );
  out.push('');

  out.push(`Risks (${s.risks.length})`);
  if (s.risks.length === 0) out.push('  The agent listed no risks.');
  for (const r of s.risks) out.push(`  - ${r.statement}${r.cites ? ` — cites ${r.cites}` : ''}`);
  out.push('');

  out.push(`Review conditions (${s.reviewConditions.length})`);
  for (const r of s.reviewConditions)
    out.push(`  - ${r.condition}${r.watch ? ` — watches: ${r.watch}` : ''}`);
  out.push('');

  out.push('Validation (offline)');
  printOffline(label, offline, out);
  out.push('');
  out.push('What this receipt is not');
  out.push(`  ${s.notice}`);
  out.push('  This tool fetched nothing the receipt names.');
}

export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        json: { type: 'boolean', default: false },
        online: { type: 'boolean', default: false },
        quiet: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    });
  } catch (error) {
    io.stderr(
      `hey-receipt: ${error instanceof Error ? cleanText(error.message, 200) : 'invalid arguments'}\nRun hey-receipt --help.\n`,
    );
    return EXIT.usage;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.stdout(`${PACKAGE_VERSION}\n`);
    return EXIT.ok;
  }
  const [command, target, ...extra] = positionals;
  if (values.help || command === undefined || command === 'help') {
    io.stdout(HELP);
    return values.help || command === 'help' ? EXIT.ok : EXIT.usage;
  }
  const usage = (message: string): number => {
    io.stderr(`hey-receipt: ${message}\nRun hey-receipt --help.\n`);
    return EXIT.usage;
  };
  if (command !== 'validate' && command !== 'inspect')
    return usage(`unknown command "${cleanText(command, 40)}"`);
  if (target === undefined) return usage(`${command} needs a file, or - for stdin`);
  if (extra.length > 0) return usage(`${command} takes one file`);
  if (command === 'inspect' && values.online) return usage('--online applies to validate only');

  const input = await readInput(target, io);
  const now = io.now?.() ?? new Date();
  const label = input.ok ? input.label : target;

  let offline: OfflineValidation;
  if (!input.ok) {
    if (input.kind === 'usage') {
      if (values.json) {
        io.stdout(
          json({
            schema: `hey-receipt.${command}/v1`,
            ok: false,
            input: label,
            chain: chainBlock,
            error: { code: input.code, message: input.message },
          }),
        );
      } else io.stderr(`hey-receipt: ${input.message}\n`);
      return EXIT.usage;
    }
    offline = failedValidation([
      { code: 'payload_too_large', path: '(root)', message: input.message },
    ]);
  } else {
    offline = validateReceiptJson(input.text);
  }

  if (command === 'inspect') {
    const summary = offline.receipt ? summarizeReceipt(offline.receipt, now) : undefined;
    const exit = offline.valid ? EXIT.ok : EXIT.invalid;
    if (values.quiet) return exit;
    if (values.json) {
      io.stdout(
        json({
          schema: 'hey-receipt.inspect/v1',
          ok: exit === EXIT.ok,
          input: label,
          chain: chainBlock,
          validation: publicOffline(offline),
          summary: summary ?? null,
          notice: RECEIPT_NOT_PROOF,
        }),
      );
      return exit;
    }
    const out: string[] = [];
    if (summary) printSummary(label, summary, offline, out);
    else {
      out.push(
        'The receipt could not be summarised: it is not a well-formed AgentResearchReceipt v1.',
        '',
      );
      printOffline(label, offline, out);
      out.push('', RECEIPT_NOT_PROOF);
    }
    io.stdout(`${out.join('\n')}\n`);
    return exit;
  }

  // validate
  let online: OnlineResult | { skipped: 'offline_invalid' } | null = null;
  let exit: number = offline.valid ? EXIT.ok : EXIT.invalid;
  if (values.online && input.ok) {
    if (!offline.valid) online = { skipped: 'offline_invalid' };
    else {
      online = await checkReceiptOnline(
        input.text.charCodeAt(0) === 0xfeff ? input.text.slice(1) : input.text,
        io.fetchImpl ? { fetchImpl: io.fetchImpl } : {},
      );
      exit = onlineExit(online);
    }
  }
  if (values.quiet) return exit;
  if (values.json) {
    io.stdout(
      json({
        schema: 'hey-receipt.validate/v1',
        ok: exit === EXIT.ok,
        input: label,
        chain: chainBlock,
        offline: publicOffline(offline),
        online,
        notice: RECEIPT_NOT_PROOF,
      }),
    );
    return exit;
  }
  const out: string[] = [];
  printOffline(label, offline, out);
  if (online && 'skipped' in online)
    out.push('  HEY check: skipped — the receipt is invalid offline, so it was not sent.');
  else if (online) printOnline(online, out);
  else if (offline.valid)
    out.push(
      '  HEY was not asked whether the cited ids exist; add --online to ask (sends only the receipt).',
    );
  out.push('', RECEIPT_NOT_PROOF);
  io.stdout(`${out.join('\n')}\n`);
  return exit;
}
