import { CHAIN_ID } from './chain';
import { RECEIPT_NOT_PROOF } from './notice';
import { citedEvidence, type AgentResearchReceipt, type EvidenceRef } from './schema';
import { cleanText } from './text';
import { HEY_ORIGIN } from './validate';

/**
 * A human-readable account of what a receipt says it used — never what it is worth. Every string
 * that came from the receipt is the agent's own text and is cleaned before it is printed.
 */

/** Where a cited reference's content comes from. */
export type ContentOrigin = 'hey_record' | 'hey_agent_answer' | 'market_provider' | 'external_url';

export interface CitedReference {
  kind: EvidenceRef['kind'];
  origin: ContentOrigin;
  /** The id, slug, URL or provider, cleaned. */
  ref: string;
  /** The time this reference was read or observed, as the agent gives it (absent: not given). */
  at?: string;
  atField?: 'asOf' | 'observedAt' | 'retrievedAt';
  detail?: string;
  /** For a HEY evidence id: where HEY resolves it. Printed, never fetched by this tool. */
  resolveAt?: string;
}

export interface ReceiptSummary {
  question: {
    subjectType: AgentResearchReceipt['subjectType'];
    subject: string;
    chainId: number;
    onRobinhoodChain: boolean;
    mandate: { value: string; selfDeclared: true } | { value: null; reason: 'not_stated' };
    thesisSummary: string;
  };
  agent: {
    agentId: string;
    operator?: string;
    selfDeclared: true;
    verifiedByHey: false;
    signature: 'present_not_verified' | 'absent';
  };
  researchState: { value: string; definition: string; vocabulary?: string; theAgentsOwn: true };
  outcome:
    | { value: string; decidedBy: 'agent'; definition?: string }
    | { value: null; reason: 'not_stated' };
  confidence: { value: number; theAgentsOwn: true } | { value: null; reason: 'not_stated' };
  freshness: {
    createdAt: string;
    evidenceCutoff: string;
    cutoffBeforeCreatedSeconds: number;
    inspectedAt: string;
    cutoffAgeSecondsAtInspection: number;
    oldestCitedAt?: string;
    newestCitedAt?: string;
    citedWithoutTime: number;
  };
  claims: {
    total: number;
    FACT: number;
    DERIVED: number;
    JUDGEMENT: number;
    items: { kind: string; statement: string; cites: number }[];
  };
  citedEvidence: CitedReference[];
  contentOrigins: {
    heyRecords: number;
    heyAgentAnswers: number;
    marketProviders: string[];
    externalUrls: number;
    sourceSystems: { name: string; url?: string; apiVersion?: string }[];
  };
  risks: { statement: string; cites: number }[];
  unknowns: { statement: string; category?: string; coverageDimension?: string }[];
  reviewConditions: { condition: string; watch?: string }[];
  notice: string;
}

const originOf = (ref: EvidenceRef): ContentOrigin =>
  ref.kind === 'market_observation'
    ? 'market_provider'
    : ref.kind === 'external'
      ? 'external_url'
      : ref.kind === 'hey_agent_answer'
        ? 'hey_agent_answer'
        : 'hey_record';

function describe(ref: EvidenceRef): CitedReference {
  switch (ref.kind) {
    case 'hey_evidence':
      return {
        kind: ref.kind,
        origin: 'hey_record',
        ref: cleanText(ref.id, 240),
        resolveAt: `${HEY_ORIGIN}/api/evidence/${encodeURIComponent(ref.id.trim())}`,
      };
    case 'hey_change_event':
      return {
        kind: ref.kind,
        origin: 'hey_record',
        ref: cleanText(ref.id, 240),
        detail: ref.revision === undefined ? 'revision not given' : `revision ${ref.revision}`,
      };
    case 'hey_snapshot':
      return {
        kind: ref.kind,
        origin: 'hey_record',
        ref: ref.project,
        at: ref.asOf,
        atField: 'asOf',
        detail: ref.scoringVersion
          ? `scoring ${cleanText(ref.scoringVersion, 40)}`
          : 'scoring version not given',
      };
    case 'hey_agent_answer':
      return {
        kind: ref.kind,
        origin: 'hey_agent_answer',
        ref: cleanText(ref.url, 500),
        at: ref.asOf,
        atField: 'asOf',
        detail: ref.capability + (ref.project ? ` · ${ref.project}` : ''),
      };
    case 'market_observation':
      return {
        kind: ref.kind,
        origin: 'market_provider',
        ref: cleanText(ref.source, 80),
        at: ref.observedAt,
        atField: 'observedAt',
        detail: `${ref.field ?? 'field not given'} · market context, not builder evidence`,
      };
    case 'external':
      return {
        kind: ref.kind,
        origin: 'external_url',
        ref: cleanText(ref.url, 500),
        ...(ref.retrievedAt ? { at: ref.retrievedAt, atField: 'retrievedAt' as const } : {}),
        detail: 'named by the agent; not fetched',
      };
  }
}

export function summarizeReceipt(
  receipt: AgentResearchReceipt,
  now: Date = new Date(),
): ReceiptSummary {
  const refs = citedEvidence(receipt);
  const cited = refs.map(describe);
  const times = cited
    .flatMap((ref) => (ref.at ? [{ at: ref.at, ms: Date.parse(ref.at) }] : []))
    .filter((t) => Number.isFinite(t.ms));
  times.sort((a, b) => a.ms - b.ms);
  const created = Date.parse(receipt.createdAt);
  const cutoff = Date.parse(receipt.evidenceCutoff);
  const subject = receipt.subject;
  const subjectText =
    receipt.subjectType === 'project'
      ? (subject.projectSlug ?? '')
      : receipt.subjectType === 'token'
        ? `${subject.tokenContract ?? ''}${subject.projectSlug ? ` (project ${subject.projectSlug})` : ''}`
        : `${subject.contract ?? ''}${subject.projectSlug ? ` (project ${subject.projectSlug})` : ''}`;
  const count = (kind: 'FACT' | 'DERIVED' | 'JUDGEMENT') =>
    receipt.claims.filter((c) => c.kind === kind).length;

  return {
    question: {
      subjectType: receipt.subjectType,
      subject: subjectText,
      chainId: subject.chainId,
      onRobinhoodChain: subject.chainId === CHAIN_ID,
      mandate: receipt.mandate
        ? { value: cleanText(receipt.mandate, 500), selfDeclared: true }
        : { value: null, reason: 'not_stated' },
      thesisSummary: cleanText(receipt.thesisSummary, 600),
    },
    agent: {
      agentId: cleanText(receipt.agentId, 200),
      ...(receipt.operator ? { operator: cleanText(receipt.operator, 200) } : {}),
      selfDeclared: true,
      verifiedByHey: false,
      signature: receipt.signature ? 'present_not_verified' : 'absent',
    },
    researchState: {
      value: cleanText(receipt.researchState.value, 40),
      definition: cleanText(receipt.researchState.definition, 300),
      ...(receipt.researchState.vocabulary
        ? { vocabulary: cleanText(receipt.researchState.vocabulary, 200) }
        : {}),
      theAgentsOwn: true,
    },
    outcome: receipt.outcome
      ? {
          value: cleanText(receipt.outcome.value, 40),
          decidedBy: 'agent',
          ...(receipt.outcome.definition
            ? { definition: cleanText(receipt.outcome.definition, 300) }
            : {}),
        }
      : { value: null, reason: 'not_stated' },
    confidence:
      typeof receipt.confidence === 'number'
        ? { value: receipt.confidence, theAgentsOwn: true }
        : { value: null, reason: 'not_stated' },
    freshness: {
      createdAt: receipt.createdAt,
      evidenceCutoff: receipt.evidenceCutoff,
      cutoffBeforeCreatedSeconds: Math.round((created - cutoff) / 1000),
      inspectedAt: now.toISOString(),
      cutoffAgeSecondsAtInspection: Math.round((now.getTime() - cutoff) / 1000),
      ...(times[0] ? { oldestCitedAt: times[0].at } : {}),
      ...(times.length > 0 ? { newestCitedAt: times[times.length - 1]!.at } : {}),
      citedWithoutTime: cited.filter((ref) => !ref.at).length,
    },
    claims: {
      total: receipt.claims.length,
      FACT: count('FACT'),
      DERIVED: count('DERIVED'),
      JUDGEMENT: count('JUDGEMENT'),
      items: receipt.claims.map((claim) => ({
        kind: claim.kind,
        statement: cleanText(claim.statement, 500),
        cites: claim.evidence.length,
      })),
    },
    citedEvidence: cited,
    contentOrigins: {
      heyRecords: refs.filter((ref) => originOf(ref) === 'hey_record').length,
      heyAgentAnswers: refs.filter((ref) => originOf(ref) === 'hey_agent_answer').length,
      marketProviders: [
        ...new Set(
          refs.flatMap((ref) =>
            ref.kind === 'market_observation' ? [cleanText(ref.source, 80)] : [],
          ),
        ),
      ],
      externalUrls: refs.filter((ref) => originOf(ref) === 'external_url').length,
      sourceSystems: receipt.sourceSystems.map((s) => ({
        name: cleanText(s.name, 80),
        ...(s.url ? { url: cleanText(s.url, 500) } : {}),
        ...(s.apiVersion ? { apiVersion: cleanText(s.apiVersion, 40) } : {}),
      })),
    },
    risks: receipt.risks.map((risk) => ({
      statement: cleanText(risk.statement, 500),
      cites: risk.evidence?.length ?? 0,
    })),
    unknowns: receipt.unknowns.map((u) => ({
      statement: cleanText(u.statement, 500),
      ...(u.category ? { category: u.category } : {}),
      ...(u.coverageDimension ? { coverageDimension: cleanText(u.coverageDimension, 60) } : {}),
    })),
    reviewConditions: receipt.reviewConditions.map((r) => ({
      condition: cleanText(r.condition, 300),
      ...(r.watch ? { watch: cleanText(r.watch, 300) } : {}),
    })),
    notice: RECEIPT_NOT_PROOF,
  };
}

/** A duration in plain words: "45 s", "15 min", "3 h", "4 days". Negative means "after". */
export function plainDuration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 90) return `${s} s`;
  if (s < 90 * 60) return `${Math.round(s / 60)} min`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} days`;
}
