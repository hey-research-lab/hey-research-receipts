import { describe, expect, it } from 'vitest';

import { EXAMPLE_RECEIPT_HEY, EXAMPLE_RECEIPT_OTHER_PROJECT } from '../src/examples';
import {
  AGENT_RESEARCH_RECEIPT_MAX_BYTES,
  RECEIPT_AGENT_CAPABILITIES,
  RECEIPT_UNKNOWN_CATEGORIES,
  agentResearchReceiptSchema,
  citedEvidence,
} from '../src/schema';
import { clone, fixture } from './helpers';

/**
 * The v1 schema's own tests, as HEY production runs them: the shape is the whole contract, so the
 * tests are about what it lets an agent say and what it refuses to carry.
 */
const valid = (value: unknown) => agentResearchReceiptSchema.safeParse(value).success;

describe('AgentResearchReceipt v1 (production test cases)', () => {
  it('accepts the two examples: one for another project, one for HEY, written the same way', () => {
    expect(valid(EXAMPLE_RECEIPT_OTHER_PROJECT)).toBe(true);
    expect(valid(EXAMPLE_RECEIPT_HEY)).toBe(true);
    expect(EXAMPLE_RECEIPT_OTHER_PROJECT.subject.projectSlug).not.toBe('hey-research-lab');
  });

  it('is project-agnostic: any chain, any project, token or contract subject (schema parity)', () => {
    const contract = {
      ...clone(EXAMPLE_RECEIPT_OTHER_PROJECT),
      subjectType: 'contract',
      subject: { chainId: 1, contract: '0x0000000000000000000000000000000000000002' },
    };
    expect(valid(contract)).toBe(true);
    expect(valid({ ...contract, subjectType: 'project' })).toBe(false);
  });

  it('refuses a field for a reasoning trace, or anything else it does not define', () => {
    expect(valid({ ...clone(EXAMPLE_RECEIPT_OTHER_PROJECT), reasoning: 'step 1: …' })).toBe(false);
    expect(valid({ ...clone(EXAMPLE_RECEIPT_OTHER_PROJECT), chainOfThought: ['…'] })).toBe(false);
  });

  it('requires evidence behind a FACT or DERIVED claim, and not behind a JUDGEMENT', () => {
    const receipt = clone(EXAMPLE_RECEIPT_OTHER_PROJECT);
    receipt.claims = [{ statement: 'Shipped twice.', kind: 'FACT', evidence: [] }];
    expect(valid(receipt)).toBe(false);
    receipt.claims = [{ statement: 'Looks steady.', kind: 'JUDGEMENT', evidence: [] }];
    expect(valid(receipt)).toBe(true);
  });

  it("keeps the outcome the agent's own and the cutoff before the receipt", () => {
    expect(
      valid({ ...clone(EXAMPLE_RECEIPT_HEY), outcome: { value: 'BUY', decidedBy: 'hey' } }),
    ).toBe(false);
    expect(valid({ ...clone(EXAMPLE_RECEIPT_HEY), evidenceCutoff: '2026-09-29T00:00:00Z' })).toBe(
      false,
    );
  });

  it('takes only https URLs and zone-qualified times', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    receipt.claims[0]!.evidence = [{ kind: 'external', url: 'http://127.0.0.1/admin' }];
    expect(valid(receipt)).toBe(false);
    expect(valid({ ...clone(EXAMPLE_RECEIPT_HEY), createdAt: '2026-09-28 12:30' })).toBe(false);
  });

  it('lists the cited evidence once each, claims then risks', () => {
    const refs = citedEvidence(EXAMPLE_RECEIPT_HEY);
    expect(refs.map((ref) => ref.kind)).toEqual([
      'external',
      'hey_change_event',
      'market_observation',
    ]);
  });
});

describe('the extracted contract', () => {
  it('keeps the vocabularies of the ecosystem conventions', () => {
    expect([...RECEIPT_AGENT_CAPABILITIES]).toEqual([
      'research_project',
      'what_changed',
      'builder_status',
      'verify_project',
      'compare_builders',
      'unknowns',
    ]);
    expect([...RECEIPT_UNKNOWN_CATEGORIES]).toEqual([
      'UNKNOWN',
      'NOT_MEASURED',
      'NOT_VERIFIED',
      'STALE',
      'INSUFFICIENT_EVIDENCE',
    ]);
    expect(AGENT_RESEARCH_RECEIPT_MAX_BYTES).toBe(65536);
  });

  it('the JSON fixtures of the examples are the code examples', () => {
    expect(fixture('valid/other-project.json')).toEqual(EXAMPLE_RECEIPT_OTHER_PROJECT);
    expect(fixture('valid/hey-token.json')).toEqual(EXAMPLE_RECEIPT_HEY);
  });

  it('a JUDGEMENT may omit evidence entirely; the schema fills an empty list', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY) as Record<string, unknown>;
    receipt.claims = [{ statement: 'x', kind: 'JUDGEMENT' }];
    const parsed = agentResearchReceiptSchema.parse(receipt);
    expect(parsed.claims[0]!.evidence).toEqual([]);
  });

  it('a stated null confidence stays null, never 0', () => {
    const parsed = agentResearchReceiptSchema.parse(EXAMPLE_RECEIPT_HEY);
    expect(parsed.confidence).toBeNull();
  });
});
