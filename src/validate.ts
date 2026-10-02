import { CAIP2, CHAIN_ID, CHAIN_NAME } from './chain';
import { formatEvidenceId, parseEvidenceId, type EvidenceFamily } from './evidence-ids';
import { OFFLINE_NOTE } from './notice';
import { hasControl } from './text';
import {
  AGENT_RESEARCH_RECEIPT_MAX_BYTES,
  agentResearchReceiptSchema,
  citedEvidence,
  type AgentResearchReceipt,
  type EvidenceRef,
} from './schema';

/**
 * The stateless, offline check of an AgentResearchReceipt.
 *
 * Three questions, all answered from the document alone:
 * 1. Is it shaped as AgentResearchReceipt v1 says? (the extracted v1 schema, unchanged)
 * 2. Is its subject on Robinhood Chain? The v1 schema accepts any positive chainId; this package
 *    is Robinhood Chain only and reports any other chain as `unsupported_chain`.
 * 3. Is every HEY id it cites well-formed? (`hey_evidence` against HEY's typed evidence-id
 *    families, `hey_change_event` against the change ledger's families, `hey_agent_answer`
 *    against HEY's agent-contract URLs.)
 *
 * It never fetches anything: not HEY, not a URL the receipt names. Whether a cited HEY id exists
 * is a question only HEY can answer (`checkReceiptOnline`).
 */

export const VALIDATION_SCHEMA = 'hey-receipt.validation/v1' as const;
/** HEY's public origin. Agent-contract answers are cited by URLs under it. */
export const HEY_ORIGIN = 'https://heyresearch.xyz' as const;
/** The deepest nesting a v1 receipt can need is 6; anything far deeper is not a receipt. */
export const MAX_DEPTH = 32;
/** At most this many errors are reported, as HEY's validator does. */
export const MAX_ERRORS = 50;
/** Keys refused anywhere in a receipt, before the schema runs (prototype pollution). */
export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * The typed id families of HEY's change ledger (`/api/changes`). A change event id starts with one
 * of them; some carry a suffix (`source:<uuid>:added`, `lock:<chain>:<id>:due`), which makes them
 * event ids, not evidence ids.
 */
export const CHANGE_EVENT_FAMILIES = [
  'ship',
  'signal',
  'state',
  'abi',
  'impl',
  'method',
  'claim',
  'source',
  'sourcechange',
  'narrative',
  'lock',
  'integrity',
] as const;
export type ChangeEventFamily = (typeof CHANGE_EVENT_FAMILIES)[number];

export type FindingCode =
  | 'invalid_json'
  | 'payload_too_large'
  | 'forbidden_key'
  | 'too_deep'
  | 'invalid_shape'
  | 'unsupported_chain'
  | 'invalid_evidence_id'
  | 'invalid_change_event_id'
  | 'invalid_agent_answer_url';

export type WarningCode = 'evidence_id_other_chain' | 'change_event_revision_not_given';

export interface Finding<C extends string = FindingCode> {
  code: C;
  /** Dotted path into the receipt, or `(root)`. */
  path: string;
  message: string;
}

/**
 * What the offline check can say about one cited reference. The status words are HEY's validator
 * vocabulary; offline only two of them are reachable: `invalid_id` (malformed) and `not_checked`
 * (well-formed, or not a HEY id at all, and in either case not looked up).
 */
export interface OfflineRefResult {
  kind: EvidenceRef['kind'];
  /** The id, slug or URL the receipt cited, as given. */
  ref: string;
  status: 'invalid_id' | 'not_checked';
  /**
   * `offline` — a well-formed HEY reference, not looked up; `not_a_hey_id` — a market or external
   * reference, never fetched; otherwise why the id is malformed (`not_an_evidence_id`,
   * `unknown_change_event_family`, `not_a_hey_agent_answer_url`).
   */
  reason: string;
  /** The id family, for HEY evidence ids and change events. */
  family?: string;
  /** HEY's canonical text form of a well-formed evidence id (uuids and addresses lower-cased). */
  canonical?: string;
}

export interface OfflineValidation {
  schema: typeof VALIDATION_SCHEMA;
  /** Shape, Robinhood Chain and id syntax all pass. */
  valid: boolean;
  /** The v1 schema alone — what HEY's validator endpoint calls `valid`. */
  shapeValid: boolean;
  errors: Finding[];
  warnings: Finding<WarningCode>[];
  chain: { name: typeof CHAIN_NAME; chainId: typeof CHAIN_ID; caip2: typeof CAIP2 };
  subject?: {
    subjectType: AgentResearchReceipt['subjectType'];
    chainId: number;
    projectSlug?: string;
    tokenContract?: string;
    contract?: string;
  };
  evidence?: { total: number; heyReferences: number; results: OfflineRefResult[] };
  /** Offline, HEY was asked nothing: never true or false here. */
  heyEvidenceStands: null;
  heyEvidenceStandsReason: 'nothing_checked';
  checkedAgainstHey: false;
  stored: false;
  endorsement: false;
  fetched: false;
  note: string;
  /** The parsed receipt (schema defaults applied), when the shape is valid. */
  receipt?: AgentResearchReceipt;
}

const base = (): Omit<OfflineValidation, 'valid' | 'shapeValid' | 'errors' | 'warnings'> => ({
  schema: VALIDATION_SCHEMA,
  chain: { name: CHAIN_NAME, chainId: CHAIN_ID, caip2: CAIP2 },
  heyEvidenceStands: null,
  heyEvidenceStandsReason: 'nothing_checked',
  checkedAgainstHey: false,
  stored: false,
  endorsement: false,
  fetched: false,
  note: OFFLINE_NOTE,
});

/** An offline result that failed before the schema could run (or on the schema). */
export const failedValidation = (errors: Finding[]): OfflineValidation => ({
  ...base(),
  valid: false,
  shapeValid: false,
  errors,
  warnings: [],
});

const unsupportedChain = (chainId: unknown): Finding => ({
  code: 'unsupported_chain',
  path: 'subject.chainId',
  message: `HEY supports Robinhood Chain (4663) only; chain ${String(chainId)} is not supported.`,
});

const pathOf = (segments: readonly (string | number)[]): string =>
  segments.length === 0 ? '(root)' : segments.join('.');

/**
 * Refuses `__proto__`, `constructor` and `prototype` keys at any depth, and nesting deeper than
 * `MAX_DEPTH`. Iterative, so a hostile document cannot exhaust the stack.
 */
export function findUnsafeStructure(value: unknown): Finding | undefined {
  const stack: { node: unknown; path: (string | number)[] }[] = [{ node: value, path: [] }];
  while (stack.length > 0) {
    const { node, path } = stack.pop()!;
    if (node === null || typeof node !== 'object') continue;
    if (path.length > MAX_DEPTH) {
      return {
        code: 'too_deep',
        path: pathOf(path.slice(0, MAX_DEPTH)),
        message: `Nested deeper than ${MAX_DEPTH} levels.`,
      };
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => stack.push({ node: item, path: [...path, index] }));
      continue;
    }
    for (const key of Object.keys(node)) {
      if (FORBIDDEN_KEYS.includes(key)) {
        return {
          code: 'forbidden_key',
          path: pathOf([...path, key]),
          message: `The key "${key}" is not allowed anywhere in a receipt.`,
        };
      }
      stack.push({ node: (node as Record<string, unknown>)[key], path: [...path, key] });
    }
  }
  return undefined;
}

/** HEY ids that name a chain: `impl:<chainId>:…`, `lock:<chainId>:…`, `v4hook:<chainId>:…`. */
const chainOfEvidenceId = (
  id: NonNullable<ReturnType<typeof parseEvidenceId>>,
): number | undefined =>
  id.family === 'impl' || id.family === 'lock' || id.family === 'v4hook' ? id.chainId : undefined;

const changeFamilyOf = (id: string): ChangeEventFamily | undefined => {
  const colon = id.indexOf(':');
  if (colon <= 0) return undefined;
  const family = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  // Event ids are machine-written: one family, a non-empty tail, no whitespace or control characters.
  if (rest.length === 0 || /\s/.test(id) || hasControl(id)) return undefined;
  return (CHANGE_EVENT_FAMILIES as readonly string[]).includes(family)
    ? (family as ChangeEventFamily)
    : undefined;
};

/** Is this URL one of HEY's agent-contract answers for that capability? (HEY's own rule.) */
export function isHeyAgentAnswerUrl(url: string, capability: string): boolean {
  const prefix = `${HEY_ORIGIN}/api/agent/${capability}`;
  return url === prefix || url.startsWith(`${prefix}?`);
}

const refLabel = (ref: EvidenceRef): string =>
  ref.kind === 'hey_evidence' || ref.kind === 'hey_change_event'
    ? ref.id
    : ref.kind === 'hey_snapshot'
      ? ref.project
      : ref.kind === 'external' || ref.kind === 'hey_agent_answer'
        ? ref.url
        : ref.source;

/** Where each cited reference sits in the receipt, for error paths. */
function refPaths(receipt: AgentResearchReceipt): Map<EvidenceRef, string> {
  const paths = new Map<EvidenceRef, string>();
  receipt.claims.forEach((claim, c) =>
    claim.evidence.forEach((ref, e) => paths.set(ref, `claims.${c}.evidence.${e}`)),
  );
  receipt.risks.forEach((risk, r) =>
    risk.evidence?.forEach((ref, e) => paths.set(ref, `risks.${r}.evidence.${e}`)),
  );
  return paths;
}

/** Validates a receipt already parsed from JSON (or built in code). Never fetches. */
export function validateReceipt(value: unknown): OfflineValidation {
  const unsafe = findUnsafeStructure(value);
  if (unsafe) return failedValidation([unsafe]);

  const parsed = agentResearchReceiptSchema.safeParse(value);
  if (!parsed.success) {
    const errors: Finding[] = parsed.error.issues.slice(0, MAX_ERRORS).map((issue) => ({
      code: 'invalid_shape',
      path: pathOf(issue.path),
      message: issue.message,
    }));
    // The chain rule is reported even when the shape fails, when the chain id can be read.
    const raw = value as { subject?: { chainId?: unknown } } | null;
    const chainId = raw && typeof raw === 'object' ? raw.subject?.chainId : undefined;
    if (typeof chainId === 'number' && chainId !== CHAIN_ID) errors.push(unsupportedChain(chainId));
    return failedValidation(errors);
  }

  const receipt = parsed.data;
  const errors: Finding[] = [];
  const warnings: Finding<WarningCode>[] = [];
  if (receipt.subject.chainId !== CHAIN_ID) errors.push(unsupportedChain(receipt.subject.chainId));

  // Every occurrence is checked (so each bad id is reported where it sits); results list each
  // reference once, in HEY's order (claims, then risks).
  const paths = refPaths(receipt);
  for (const [ref, path] of paths) {
    if (ref.kind === 'hey_evidence') {
      const id = parseEvidenceId(ref.id);
      if (!id) {
        errors.push({
          code: 'invalid_evidence_id',
          path: `${path}.id`,
          message: `"${ref.id.slice(0, 80)}" is not a HEY typed evidence id.`,
        });
      } else {
        const chain = chainOfEvidenceId(id);
        if (chain !== undefined && chain !== CHAIN_ID) {
          warnings.push({
            code: 'evidence_id_other_chain',
            path: `${path}.id`,
            message: `The id names chain ${chain}; HEY records Robinhood Chain (4663).`,
          });
        }
      }
    } else if (ref.kind === 'hey_change_event') {
      if (!changeFamilyOf(ref.id)) {
        errors.push({
          code: 'invalid_change_event_id',
          path: `${path}.id`,
          message: `"${ref.id.slice(0, 80)}" does not start with a HEY change-event family.`,
        });
      } else if (ref.revision === undefined) {
        warnings.push({
          code: 'change_event_revision_not_given',
          path,
          message:
            'No revision cited: HEY can confirm the event exists, not that it is the version read.',
        });
      }
    } else if (ref.kind === 'hey_agent_answer' && !isHeyAgentAnswerUrl(ref.url, ref.capability)) {
      errors.push({
        code: 'invalid_agent_answer_url',
        path: `${path}.url`,
        message: `A ${ref.capability} answer is cited by its ${HEY_ORIGIN}/api/agent/${ref.capability} URL.`,
      });
    }
  }

  const results: OfflineRefResult[] = citedEvidence(receipt).map((ref) => {
    const label = refLabel(ref);
    if (ref.kind === 'hey_evidence') {
      const id = parseEvidenceId(ref.id);
      return id
        ? {
            kind: ref.kind,
            ref: label,
            status: 'not_checked',
            reason: 'offline',
            family: id.family as EvidenceFamily,
            canonical: formatEvidenceId(id),
          }
        : { kind: ref.kind, ref: label, status: 'invalid_id', reason: 'not_an_evidence_id' };
    }
    if (ref.kind === 'hey_change_event') {
      const family = changeFamilyOf(ref.id);
      return family
        ? { kind: ref.kind, ref: label, status: 'not_checked', reason: 'offline', family }
        : {
            kind: ref.kind,
            ref: label,
            status: 'invalid_id',
            reason: 'unknown_change_event_family',
          };
    }
    if (ref.kind === 'hey_agent_answer') {
      return isHeyAgentAnswerUrl(ref.url, ref.capability)
        ? { kind: ref.kind, ref: label, status: 'not_checked', reason: 'offline' }
        : {
            kind: ref.kind,
            ref: label,
            status: 'invalid_id',
            reason: 'not_a_hey_agent_answer_url',
          };
    }
    if (ref.kind === 'hey_snapshot')
      return { kind: ref.kind, ref: label, status: 'not_checked', reason: 'offline' };
    return { kind: ref.kind, ref: label, status: 'not_checked', reason: 'not_a_hey_id' };
  });

  const { subject } = receipt;
  return {
    ...base(),
    valid: errors.length === 0,
    shapeValid: true,
    errors: errors.slice(0, MAX_ERRORS),
    warnings,
    subject: {
      subjectType: receipt.subjectType,
      chainId: subject.chainId,
      ...(subject.projectSlug ? { projectSlug: subject.projectSlug } : {}),
      ...(subject.tokenContract ? { tokenContract: subject.tokenContract } : {}),
      ...(subject.contract ? { contract: subject.contract } : {}),
    },
    evidence: {
      total: results.length,
      heyReferences: results.filter((r) => r.kind !== 'external' && r.kind !== 'market_observation')
        .length,
      results,
    },
    receipt,
  };
}

/** UTF-8 byte length of a string, without Buffer (works in browsers too). */
export const byteLength = (text: string): number => new TextEncoder().encode(text).byteLength;

/**
 * Validates a receipt from its JSON text: refuses more than 64 KB (HEY's limit) before parsing,
 * then parses and runs `validateReceipt`.
 */
export function validateReceiptJson(text: string): OfflineValidation {
  const bytes = byteLength(text);
  if (bytes > AGENT_RESEARCH_RECEIPT_MAX_BYTES) {
    return failedValidation([
      {
        code: 'payload_too_large',
        path: '(root)',
        message: `A receipt is at most ${AGENT_RESEARCH_RECEIPT_MAX_BYTES / 1024} KB of JSON; this one is ${bytes} bytes.`,
      },
    ]);
  }
  let value: unknown;
  try {
    value = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return failedValidation([
      { code: 'invalid_json', path: '(root)', message: 'The input is not valid JSON.' },
    ]);
  }
  return validateReceipt(value);
}
