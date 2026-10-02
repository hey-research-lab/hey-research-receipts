import { z } from 'zod';

/**
 * AgentResearchReceipt v1 (2026-09-28, agent discovery).
 *
 * A neutral, project-agnostic record an autonomous agent can publish after it
 * researched something on Robinhood Chain: "I reached this conclusion from
 * these facts, as of this time." It works for any project — HoodLock, OrdoFi,
 * Pons, HEY, anything HEY or another source researched — and it is never a
 * HEY signal: HEY defines the shape and checks that cited HEY evidence
 * exists; it does not store receipts, aggregate them, rank them or endorse
 * a conclusion.
 *
 * What it deliberately does not carry:
 * - no private chain-of-thought: `thesisSummary`, claims, risks and unknowns
 *   are the agent's concise, publishable rationale; there is no field for a
 *   reasoning trace, and unknown top-level fields are refused;
 * - no HEY verdict: `researchState` and `outcome` are the agent's own words,
 *   with the agent's own definition, and `outcome.decidedBy` is always
 *   `agent`;
 * - no instruction to anyone else: a receipt describes one agent's research,
 *   never a trade for others to copy.
 *
 * Two representations of one contract: this Zod schema (what the validator
 * endpoint runs) and `AGENT_RESEARCH_RECEIPT_JSON_SCHEMA` (what
 * `/schemas/agent-research-receipt.v1.json` publishes). A test in the web app
 * validates the same fixtures under both and fails on any disagreement.
 */

export const AGENT_RESEARCH_RECEIPT_TYPE = 'AgentResearchReceipt';
export const AGENT_RESEARCH_RECEIPT_VERSION = '1.0';
/** The largest receipt the validator reads, in bytes of JSON. */
export const AGENT_RESEARCH_RECEIPT_MAX_BYTES = 64 * 1024;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
/** RFC 3339 / ISO 8601 with a zone, as every HEY timestamp is written. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const HTTPS_URL = /^https:\/\/[^\s]{1,490}$/;

const text = (max: number) => z.string().trim().min(1).max(max);
const instant = z.string().regex(INSTANT, 'an ISO 8601 date-time with a zone, e.g. 2026-09-28T12:00:00Z');
const httpsUrl = z.string().regex(HTTPS_URL, 'an https:// URL');

/** A HEY typed evidence id (`ship:`, `signal:`, `state:` …), resolvable at `/api/evidence/{id}`. */
const heyEvidenceRef = z.object({ kind: z.literal('hey_evidence'), id: text(240), note: text(200).optional() }).strict();
/** A ChangeEvent id from `/api/changes`, with the revision the agent read. */
const heyChangeRef = z.object({ kind: z.literal('hey_change_event'), id: text(240), revision: z.number().int().min(1).optional(), note: text(200).optional() }).strict();
/** A project snapshot as read: the slug, its `asOf`, and the scoring version it reported. */
const heySnapshotRef = z.object({ kind: z.literal('hey_snapshot'), project: z.string().regex(SLUG), asOf: instant, scoringVersion: text(40).optional(), note: text(200).optional() }).strict();
/** A market reading: its provider and the time the provider observed it — never a price target. */
const marketRef = z
  .object({ kind: z.literal('market_observation'), source: text(80), observedAt: instant, field: z.enum(['marketCap', 'fdv', 'price', 'liquidity', 'volume24h', 'other']).optional(), url: httpsUrl.optional(), note: text(200).optional() })
  .strict();
/** Anything else: a public URL and when the agent read it. HEY never fetches it. */
const externalRef = z.object({ kind: z.literal('external'), url: httpsUrl, retrievedAt: instant.optional(), note: text(200).optional() }).strict();

/**
 * The six capabilities of HEY's agent contract (2026-09-30), as a receipt may
 * cite them. Held equal to `AGENT_CAPABILITIES` in HEY's agent contract
 * by a parity test in HEY's production repository.
 */
export const RECEIPT_AGENT_CAPABILITIES = ['research_project', 'what_changed', 'builder_status', 'verify_project', 'compare_builders', 'unknowns'] as const;
/** HEY's unknown categories (2026-09-30), which a receipt's unknown may carry as HEY gave it. */
export const RECEIPT_UNKNOWN_CATEGORIES = ['UNKNOWN', 'NOT_MEASURED', 'NOT_VERIFIED', 'STALE', 'INSUFFICIENT_EVIDENCE'] as const;

/**
 * One answer of HEY's agent contract as read (2026-09-30, additive to v1): its
 * capability, the canonical URL it was read from (`links.self`), its `asOf`,
 * and — for a project answer — the project and scoring version. The response's
 * `citation` object is exactly this reference. HEY does not store answers, so
 * the validator checks the capability, the URL and the project, never what the
 * answer said at `asOf`.
 */
const heyAgentAnswerRef = z
  .object({
    kind: z.literal('hey_agent_answer'),
    capability: z.enum(RECEIPT_AGENT_CAPABILITIES),
    schemaVersion: z.literal('1'),
    url: httpsUrl,
    asOf: instant,
    project: z.string().regex(SLUG).optional(),
    scoringVersion: text(40).optional(),
    note: text(200).optional(),
  })
  .strict();

export const evidenceRefSchema = z.discriminatedUnion('kind', [heyEvidenceRef, heyChangeRef, heySnapshotRef, marketRef, externalRef, heyAgentAnswerRef]);
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;

const claimSchema = z
  .object({
    statement: text(500),
    /** FACT: recorded somewhere, cited. DERIVED: a rule the agent applied to cited facts. JUDGEMENT: the agent's own view. */
    kind: z.enum(['FACT', 'DERIVED', 'JUDGEMENT']),
    evidence: z.array(evidenceRefSchema).max(20).default([]),
  })
  .strict()
  .refine((claim) => claim.kind === 'JUDGEMENT' || claim.evidence.length > 0, { message: 'A FACT or DERIVED claim cites at least one piece of evidence.', path: ['evidence'] });

export const agentResearchReceiptSchema = z
  .object({
    $schema: httpsUrl.optional(),
    type: z.literal(AGENT_RESEARCH_RECEIPT_TYPE),
    version: z.literal(AGENT_RESEARCH_RECEIPT_VERSION),
    /** The agent's own identifier (a URL, a DID, a name). HEY does not verify it. */
    agentId: text(200),
    /** Who operates the agent, self-declared. */
    operator: text(200).optional(),
    /** The agent's mandate in a sentence, self-declared. */
    mandate: text(500).optional(),
    subjectType: z.enum(['project', 'token', 'contract']),
    subject: z
      .object({
        chainId: z.number().int().positive(),
        projectSlug: z.string().regex(SLUG).optional(),
        tokenContract: z.string().regex(ADDRESS).optional(),
        contract: z.string().regex(ADDRESS).optional(),
      })
      .strict()
      .refine((subject) => Boolean(subject.projectSlug || subject.tokenContract || subject.contract), { message: 'Name the subject: projectSlug, tokenContract or contract.' }),
    createdAt: instant,
    /** The newest evidence the agent considered; nothing after it informed the receipt. */
    evidenceCutoff: instant,
    /** The concise rationale. Not a reasoning trace. */
    thesisSummary: text(600),
    claims: z.array(claimSchema).min(1).max(50),
    risks: z.array(z.object({ statement: text(500), evidence: z.array(evidenceRefSchema).max(20).optional() }).strict()).max(50),
    /** `category` (additive, 2026-09-30): HEY's own unknown category, when the unknown restates one of HEY's. */
    unknowns: z.array(z.object({ statement: text(500), coverageDimension: text(60).optional(), category: z.enum(RECEIPT_UNKNOWN_CATEGORIES).optional() }).strict()).max(50),
    /** The agent's research state, in its own vocabulary, with its own definition. */
    researchState: z.object({ value: text(40), definition: text(300), vocabulary: text(200).optional() }).strict(),
    /** What the agent decided under its own mandate (PASS, MONITOR, RESEARCH_MORE …). Never HEY's. */
    outcome: z.object({ value: text(40), decidedBy: z.literal('agent'), definition: text(300).optional() }).strict().optional(),
    /** The agent's own confidence, 0–1, or null when it does not state one. */
    confidence: z.number().min(0).max(1).nullable().optional(),
    reviewConditions: z.array(z.object({ condition: text(300), watch: text(300).optional() }).strict()).max(20),
    /** Where the evidence came from: HEY, another system, or several. */
    sourceSystems: z.array(z.object({ name: text(80), url: httpsUrl.optional(), apiVersion: text(40).optional() }).strict()).min(1).max(10),
    /** Optional detached signature by the agent; HEY does not verify it. */
    signature: z.object({ alg: text(20), value: text(4096), kid: text(200).optional(), jku: httpsUrl.optional() }).strict().optional(),
  })
  .strict()
  .refine((receipt) => Date.parse(receipt.evidenceCutoff) <= Date.parse(receipt.createdAt), { message: 'evidenceCutoff cannot be later than createdAt.', path: ['evidenceCutoff'] })
  .refine((receipt) => receipt.subjectType !== 'project' || Boolean(receipt.subject.projectSlug), { message: 'A project receipt names subject.projectSlug.', path: ['subject', 'projectSlug'] })
  .refine((receipt) => receipt.subjectType !== 'token' || Boolean(receipt.subject.tokenContract), { message: 'A token receipt names subject.tokenContract.', path: ['subject', 'tokenContract'] })
  .refine((receipt) => receipt.subjectType !== 'contract' || Boolean(receipt.subject.contract), { message: 'A contract receipt names subject.contract.', path: ['subject', 'contract'] });

export type AgentResearchReceipt = z.infer<typeof agentResearchReceiptSchema>;

/**
 * Every evidence reference a receipt cites, wherever it sits (claims, risks),
 * in order of first appearance, duplicates removed by kind and id.
 */
export function citedEvidence(receipt: AgentResearchReceipt): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const seen = new Set<string>();
  const add = (ref: EvidenceRef) => {
    const key =
      ref.kind === 'hey_evidence' || ref.kind === 'hey_change_event'
        ? `${ref.kind}:${ref.id}`
        : ref.kind === 'hey_snapshot'
          ? `${ref.kind}:${ref.project}:${ref.asOf}`
          : ref.kind === 'external' || ref.kind === 'hey_agent_answer'
            ? `${ref.kind}:${ref.url}:${ref.kind === 'hey_agent_answer' ? ref.asOf : ''}`
            : `${ref.kind}:${ref.source}:${ref.observedAt}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(ref);
  };
  for (const claim of receipt.claims) claim.evidence.forEach(add);
  for (const risk of receipt.risks) risk.evidence?.forEach(add);
  return out;
}

/* ------------------------------------------------------------ JSON Schema */

const jsText = (max: number) => ({ type: 'string', minLength: 1, maxLength: max });
const jsInstant = { type: 'string', pattern: INSTANT.source, description: 'ISO 8601 date-time with a zone.' };
const jsUrl = { type: 'string', pattern: HTTPS_URL.source, description: 'An https:// URL.' };
const jsNote = jsText(200);

const jsEvidenceRef = {
  oneOf: [
    { type: 'object', additionalProperties: false, required: ['kind', 'id'], properties: { kind: { const: 'hey_evidence' }, id: jsText(240), note: jsNote }, description: 'A HEY typed evidence id, resolvable at /api/evidence/{id}.' },
    { type: 'object', additionalProperties: false, required: ['kind', 'id'], properties: { kind: { const: 'hey_change_event' }, id: jsText(240), revision: { type: 'integer', minimum: 1 }, note: jsNote }, description: 'A ChangeEvent id from /api/changes. The validator compares revision with the one that stands (exists, or revised with current_revision:<n>); without it the answer says revision_not_verified.' },
    { type: 'object', additionalProperties: false, required: ['kind', 'project', 'asOf'], properties: { kind: { const: 'hey_snapshot' }, project: { type: 'string', pattern: SLUG.source }, asOf: jsInstant, scoringVersion: jsText(40), note: jsNote }, description: 'A project snapshot as read. The validator answers project_exists with as_of_not_verified — HEY does not rebuild the snapshot at asOf — and compares scoringVersion with the current one (matches_current, differs_from_current, not_given).' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'source', 'observedAt'],
      properties: { kind: { const: 'market_observation' }, source: jsText(80), observedAt: jsInstant, field: { enum: ['marketCap', 'fdv', 'price', 'liquidity', 'volume24h', 'other'] }, url: jsUrl, note: jsNote },
      description: 'A market reading with its provider and observation time.',
    },
    { type: 'object', additionalProperties: false, required: ['kind', 'url'], properties: { kind: { const: 'external' }, url: jsUrl, retrievedAt: jsInstant, note: jsNote }, description: 'A public URL and when it was read. HEY never fetches it.' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'capability', 'schemaVersion', 'url', 'asOf'],
      properties: { kind: { const: 'hey_agent_answer' }, capability: { enum: [...RECEIPT_AGENT_CAPABILITIES] }, schemaVersion: { const: '1' }, url: jsUrl, asOf: jsInstant, project: { type: 'string', pattern: SLUG.source }, scoringVersion: jsText(40), note: jsNote },
      description: 'One answer of HEY\'s agent contract (AgentIntelligenceResponse v1) as read: the response\'s own citation object. HEY stores no answers; the validator checks the capability, that the URL is that capability on HEY, and the project.',
    },
  ],
};

/** The published JSON Schema (draft 2020-12). `baseUrl` sets `$id`. */
export function agentResearchReceiptJsonSchema(baseUrl: string): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${baseUrl.replace(/\/+$/, '')}/schemas/agent-research-receipt.v1.json`,
    title: 'AgentResearchReceipt v1',
    description:
      'A neutral, project-agnostic record of one autonomous agent\'s research: the conclusion it reached, from which evidence, as of when. Carries no reasoning trace and no instruction to anyone else. researchState and outcome are the agent\'s own vocabulary; HEY defines the shape only and never endorses a conclusion.',
    type: 'object',
    additionalProperties: false,
    required: ['type', 'version', 'agentId', 'subjectType', 'subject', 'createdAt', 'evidenceCutoff', 'thesisSummary', 'claims', 'risks', 'unknowns', 'researchState', 'reviewConditions', 'sourceSystems'],
    // One rule JSON Schema cannot say, enforced by the validator endpoint: evidenceCutoff is not later than createdAt.
    allOf: [
      { if: { properties: { subjectType: { const: 'project' } } }, then: { properties: { subject: { required: ['projectSlug'] } } } },
      { if: { properties: { subjectType: { const: 'token' } } }, then: { properties: { subject: { required: ['tokenContract'] } } } },
      { if: { properties: { subjectType: { const: 'contract' } } }, then: { properties: { subject: { required: ['contract'] } } } },
    ],
    properties: {
      $schema: jsUrl,
      type: { const: AGENT_RESEARCH_RECEIPT_TYPE },
      version: { const: AGENT_RESEARCH_RECEIPT_VERSION },
      agentId: { ...jsText(200), description: 'The agent\'s own identifier. Not verified by HEY.' },
      operator: jsText(200),
      mandate: jsText(500),
      subjectType: { enum: ['project', 'token', 'contract'] },
      subject: {
        type: 'object',
        additionalProperties: false,
        required: ['chainId'],
        properties: { chainId: { type: 'integer', minimum: 1 }, projectSlug: { type: 'string', pattern: SLUG.source }, tokenContract: { type: 'string', pattern: ADDRESS.source }, contract: { type: 'string', pattern: ADDRESS.source } },
        anyOf: [{ required: ['projectSlug'] }, { required: ['tokenContract'] }, { required: ['contract'] }],
      },
      createdAt: jsInstant,
      evidenceCutoff: { ...jsInstant, description: 'The newest evidence considered; must not be later than createdAt.' },
      thesisSummary: { ...jsText(600), description: 'The concise rationale. Not a reasoning trace.' },
      claims: {
        type: 'array',
        minItems: 1,
        maxItems: 50,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['statement', 'kind'],
          properties: { statement: jsText(500), kind: { enum: ['FACT', 'DERIVED', 'JUDGEMENT'] }, evidence: { type: 'array', maxItems: 20, items: jsEvidenceRef } },
          if: { properties: { kind: { enum: ['FACT', 'DERIVED'] } } },
          then: { required: ['evidence'], properties: { evidence: { minItems: 1 } } },
        },
      },
      risks: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['statement'], properties: { statement: jsText(500), evidence: { type: 'array', maxItems: 20, items: jsEvidenceRef } } } },
      unknowns: { type: 'array', maxItems: 50, items: { type: 'object', additionalProperties: false, required: ['statement'], properties: { statement: jsText(500), coverageDimension: jsText(60), category: { enum: [...RECEIPT_UNKNOWN_CATEGORIES], description: 'HEY\'s own unknown category, when the unknown restates one of HEY\'s.' } } } },
      researchState: { type: 'object', additionalProperties: false, required: ['value', 'definition'], properties: { value: jsText(40), definition: jsText(300), vocabulary: jsText(200) }, description: 'The agent\'s own research state and what it means.' },
      outcome: { type: 'object', additionalProperties: false, required: ['value', 'decidedBy'], properties: { value: jsText(40), decidedBy: { const: 'agent' }, definition: jsText(300) }, description: 'What the agent decided under its own mandate. Never HEY\'s.' },
      confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      reviewConditions: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['condition'], properties: { condition: jsText(300), watch: jsText(300) } } },
      sourceSystems: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: jsText(80), url: jsUrl, apiVersion: jsText(40) } } },
      signature: { type: 'object', additionalProperties: false, required: ['alg', 'value'], properties: { alg: jsText(20), value: jsText(4096), kid: jsText(200), jku: jsUrl }, description: 'Optional; HEY does not verify it.' },
    },
  };
}
