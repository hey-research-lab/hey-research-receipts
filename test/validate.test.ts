import { describe, expect, it, vi } from 'vitest';

import { EXAMPLE_RECEIPT_HEY, EXAMPLE_RECEIPT_OTHER_PROJECT } from '../src/examples';
import { findUnsafeStructure, validateReceipt, validateReceiptJson } from '../src/validate';
import { clone, fixture, fixtureText } from './helpers';

const codes = (result: { errors: { code: string }[] }) => result.errors.map((e) => e.code);

describe('validateReceipt — valid receipts', () => {
  it.each(['valid/other-project.json', 'valid/hey-token.json', 'valid/agent-answer-and-ids.json'])(
    '%s is valid',
    (name) => {
      const result = validateReceiptJson(fixtureText(name));
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
      expect(result.shapeValid).toBe(true);
    },
  );

  it('always says what it did not do: nothing stored, endorsed, fetched or checked against HEY', () => {
    const result = validateReceipt(EXAMPLE_RECEIPT_OTHER_PROJECT);
    expect(result).toMatchObject({
      stored: false,
      endorsement: false,
      fetched: false,
      checkedAgainstHey: false,
      heyEvidenceStands: null,
      heyEvidenceStandsReason: 'nothing_checked',
      chain: { name: 'Robinhood Chain', chainId: 4663, caip2: 'eip155:4663' },
    });
  });

  it('reports every cited reference once, HEY ids as not checked offline, others as not HEY ids', () => {
    const result = validateReceipt(EXAMPLE_RECEIPT_OTHER_PROJECT);
    expect(result.evidence).toEqual({
      total: 3,
      heyReferences: 2,
      results: [
        {
          kind: 'hey_evidence',
          ref: 'ship:3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f',
          status: 'not_checked',
          reason: 'offline',
          family: 'ship',
          canonical: 'ship:3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f',
        },
        { kind: 'hey_snapshot', ref: 'hoodlock', status: 'not_checked', reason: 'offline' },
        {
          kind: 'market_observation',
          ref: 'geckoterminal',
          status: 'not_checked',
          reason: 'not_a_hey_id',
        },
      ],
    });
  });

  it('recognises every typed family in the agent-answer fixture', () => {
    const result = validateReceiptJson(fixtureText('valid/agent-answer-and-ids.json'));
    const families = result.evidence!.results.map((r) => `${r.kind}:${r.family ?? '-'}`);
    expect(families).toEqual([
      'hey_agent_answer:-',
      'hey_evidence:impl',
      'hey_evidence:v4hook',
      'hey_evidence:security',
      'hey_evidence:state',
      'hey_change_event:state',
      'hey_change_event:source',
    ]);
  });

  it('warns, without failing, when a change event is cited without its revision', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    receipt.claims[1]!.evidence = [
      { kind: 'hey_change_event', id: 'ship:0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e' },
    ];
    const result = validateReceipt(receipt);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['change_event_revision_not_given']);
  });

  it('warns when a chain-native evidence id names another chain', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    receipt.claims[0]!.evidence = [
      { kind: 'hey_evidence', id: 'v4hook:8453:0x0000000000000000000000000000000000000002' },
    ];
    const result = validateReceipt(receipt);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toEqual(['evidence_id_other_chain']);
  });
});

describe('validateReceipt — Robinhood Chain only', () => {
  it.each(['invalid/other-chain.json', 'invalid/other-chain-base.json'])(
    '%s: shape valid under v1, refused as unsupported_chain',
    (name) => {
      const result = validateReceiptJson(fixtureText(name));
      expect(result.shapeValid).toBe(true);
      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(['unsupported_chain']);
      expect(result.errors[0]!.message).toMatch(
        /^HEY supports Robinhood Chain \(4663\) only; chain \d+ is not supported\.$/,
      );
    },
  );

  it('reports unsupported_chain beside shape errors when the chain id can be read', () => {
    const receipt = { ...clone(EXAMPLE_RECEIPT_HEY), subject: { chainId: 1 } };
    const result = validateReceipt(receipt);
    expect(codes(result)).toContain('invalid_shape');
    expect(codes(result)).toContain('unsupported_chain');
  });

  it('does not accept 4663 written as a string', () => {
    const result = validateReceipt({
      ...clone(EXAMPLE_RECEIPT_HEY),
      subject: {
        chainId: '4663',
        projectSlug: 'x',
        tokenContract: '0x0000000000000000000000000000000000000001',
      },
    });
    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(['invalid_shape']);
  });
});

describe('validateReceipt — invalid shape', () => {
  it.each([
    ['invalid/shape-reasoning-trace.json', '(root)'],
    ['invalid/shape-fact-without-evidence.json', 'claims.0.evidence'],
    ['invalid/shape-outcome-by-hey.json', 'outcome.decidedBy'],
    ['invalid/shape-http-url.json', 'sourceSystems.0.url'],
    ['invalid/shape-cutoff-after-created.json', 'evidenceCutoff'],
  ])('%s fails at %s', (name, path) => {
    const result = validateReceiptJson(fixtureText(name));
    expect(result.valid).toBe(false);
    expect(result.shapeValid).toBe(false);
    expect(result.errors.every((e) => e.code === 'invalid_shape')).toBe(true);
    expect(result.errors.map((e) => e.path)).toContain(path);
    expect(result.receipt).toBeUndefined();
  });

  it('caps the errors it reports at 50', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY) as Record<string, unknown>;
    receipt.unknowns = Array.from({ length: 50 }, () => ({ statement: '' }));
    receipt.reviewConditions = Array.from({ length: 20 }, () => ({ condition: '' }));
    expect(validateReceipt(receipt).errors.length).toBe(50);
  });
});

describe('validateReceipt — cited id syntax', () => {
  it('refuses malformed HEY evidence ids, each at its own path', () => {
    const result = validateReceiptJson(fixtureText('invalid/bad-evidence-ids.json'));
    expect(result.shapeValid).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => `${e.code}@${e.path}`)).toEqual([
      'invalid_evidence_id@claims.0.evidence.0.id',
      'invalid_evidence_id@claims.1.evidence.0.id',
      'invalid_evidence_id@claims.2.evidence.0.id',
      'invalid_evidence_id@claims.3.evidence.0.id',
    ]);
    expect(result.evidence!.results.filter((r) => r.status === 'invalid_id')).toHaveLength(4);
  });

  it('an event id with a suffix is not an evidence id, but is a change event id', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    const id = 'source:3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f:added';
    receipt.claims[1]!.evidence = [{ kind: 'hey_evidence', id }];
    expect(codes(validateReceipt(receipt))).toEqual(['invalid_evidence_id']);
    receipt.claims[1]!.evidence = [{ kind: 'hey_change_event', id, revision: 1 }];
    expect(validateReceipt(receipt).valid).toBe(true);
  });

  it('refuses a change event id outside HEY’s change families', () => {
    const result = validateReceiptJson(fixtureText('invalid/bad-change-event-id.json'));
    expect(codes(result)).toEqual(['invalid_change_event_id']);
  });

  it('refuses a change event id carrying whitespace or control characters', () => {
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    receipt.claims[1]!.evidence = [{ kind: 'hey_change_event', id: 'ship:abc def', revision: 1 }];
    expect(codes(validateReceipt(receipt))).toEqual(['invalid_change_event_id']);
    receipt.claims[1]!.evidence = [
      { kind: 'hey_change_event', id: `ship:abc${String.fromCharCode(27)}[31m`, revision: 1 },
    ];
    expect(codes(validateReceipt(receipt))).toEqual(['invalid_change_event_id']);
  });

  it('refuses an agent answer that is not that capability on heyresearch.xyz', () => {
    expect(codes(validateReceiptJson(fixtureText('invalid/bad-agent-answer-url.json')))).toEqual([
      'invalid_agent_answer_url',
    ]);
    const receipt = fixture('valid/agent-answer-and-ids.json') as {
      claims: { evidence: { url?: string; capability?: string }[] }[];
    };
    receipt.claims[0]!.evidence[0]!.capability = 'unknowns';
    expect(codes(validateReceipt(receipt))).toEqual(['invalid_agent_answer_url']);
    receipt.claims[0]!.evidence[0]!.capability = 'research_project';
    receipt.claims[0]!.evidence[0]!.url = 'https://heyresearch.xyz/api/agent/research_project_evil';
    expect(codes(validateReceipt(receipt))).toEqual(['invalid_agent_answer_url']);
    receipt.claims[0]!.evidence[0]!.url = 'https://heyresearch.xyz/api/agent/research_project';
    expect(validateReceipt(receipt).valid).toBe(true);
  });
});

describe('validateReceiptJson — hostile input', () => {
  it('refuses more than 64 KB before parsing', () => {
    const text = fixtureText('invalid/oversized.json');
    expect(text.length).toBeGreaterThan(65536);
    const parse = vi.spyOn(JSON, 'parse');
    const result = validateReceiptJson(text);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(codes(result)).toEqual(['payload_too_large']);
  });

  it('counts bytes, not characters', () => {
    const base = JSON.stringify(EXAMPLE_RECEIPT_HEY);
    const padded = `${base.slice(0, -1)}${' '.repeat(65536 - base.length - 2000)}}`;
    expect(validateReceiptJson(padded).valid).toBe(true);
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    receipt.thesisSummary = 'é'.repeat(600);
    const multibyte = `${JSON.stringify(receipt).slice(0, -1)}${' '.repeat(65536 - JSON.stringify(receipt).length - 300)}}`;
    expect(multibyte.length).toBeLessThan(65536);
    expect(codes(validateReceiptJson(multibyte))).toEqual(['payload_too_large']);
  });

  it('refuses text that is not JSON', () => {
    expect(codes(validateReceiptJson(fixtureText('invalid/not-json.json')))).toEqual([
      'invalid_json',
    ]);
    expect(codes(validateReceiptJson(''))).toEqual(['invalid_json']);
  });

  it('accepts a UTF-8 byte-order mark', () => {
    expect(
      validateReceiptJson(`${String.fromCharCode(0xfeff)}${JSON.stringify(EXAMPLE_RECEIPT_HEY)}`)
        .valid,
    ).toBe(true);
  });

  it.each([
    ['invalid/proto-key-root.json', '__proto__'],
    ['invalid/proto-key-nested.json', 'subject.constructor'],
    ['invalid/proto-key-prototype.json', 'claims.0.evidence.0.prototype'],
  ])('%s is refused for its forbidden key, before the schema runs', (name, path) => {
    const result = validateReceiptJson(fixtureText(name));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'forbidden_key', path });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses nesting far deeper than a receipt can need, without recursion', () => {
    let deep: unknown = {};
    for (let i = 0; i < 10_000; i += 1) deep = { a: deep };
    expect(findUnsafeStructure(deep)?.code).toBe('too_deep');
    const text = `${'['.repeat(5000)}${']'.repeat(5000)}`;
    expect(codes(validateReceiptJson(text))).toEqual(['too_deep']);
  });

  it('never reaches the network, whatever URLs the receipt names', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const receipt = clone(EXAMPLE_RECEIPT_HEY);
    receipt.claims[0]!.evidence = [
      { kind: 'external', url: 'https://169.254.169.254.example.org/latest/meta-data' },
      { kind: 'external', url: 'https://example.com/a' },
    ];
    validateReceipt(receipt);
    validateReceiptJson(JSON.stringify(receipt));
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
