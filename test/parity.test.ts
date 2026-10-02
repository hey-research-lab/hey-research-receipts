import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { z, type ZodTypeAny } from 'zod';

import { EXAMPLE_RECEIPT_HEY, EXAMPLE_RECEIPT_OTHER_PROJECT } from '../src/examples';
import { agentResearchReceiptJsonSchema, agentResearchReceiptSchema } from '../src/schema';
import { ROOT, clone, fixture } from './helpers';

/**
 * Parity with the JSON Schema HEY publishes at
 * https://heyresearch.xyz/schemas/agent-research-receipt.v1.json, committed unchanged as
 * schema/agent-research-receipt.v1.json (read once, never fetched by a test).
 */
const PUBLISHED_TEXT = readFileSync(join(ROOT, 'schema', 'agent-research-receipt.v1.json'), 'utf8');
const PUBLISHED = JSON.parse(PUBLISHED_TEXT) as Record<string, unknown>;

type Json = Record<string, unknown>;

describe('the published JSON Schema', () => {
  it('is byte-for-byte what the extracted generator writes for heyresearch.xyz', () => {
    expect(JSON.stringify(agentResearchReceiptJsonSchema('https://heyresearch.xyz'))).toBe(
      PUBLISHED_TEXT,
    );
  });

  it('names its own canonical URL and draft 2020-12', () => {
    expect(PUBLISHED.$id).toBe('https://heyresearch.xyz/schemas/agent-research-receipt.v1.json');
    expect(PUBLISHED.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('accepts any positive chainId, as v1 does: the Robinhood-only rule lives in the validator', () => {
    const subject = (PUBLISHED.properties as Json).subject as Json;
    expect((subject.properties as Json).chainId).toEqual({ type: 'integer', minimum: 1 });
  });
});

/* ------------------------------------------------ zod ⇄ JSON Schema structure */

const unwrap = (t: ZodTypeAny): { type: ZodTypeAny; optional: boolean; nullable: boolean } => {
  let optional = false;
  let nullable = false;
  let cur = t;
  for (;;) {
    if (cur instanceof z.ZodOptional) {
      optional = true;
      cur = cur.unwrap() as ZodTypeAny;
    } else if (cur instanceof z.ZodDefault) {
      optional = true;
      cur = cur._def.innerType as ZodTypeAny;
    } else if (cur instanceof z.ZodNullable) {
      nullable = true;
      cur = cur.unwrap() as ZodTypeAny;
    } else if (cur instanceof z.ZodEffects) {
      cur = cur.innerType() as ZodTypeAny;
    } else return { type: cur, optional, nullable };
  }
};

/** Walks the zod schema and the JSON Schema together; returns every disagreement found. */
function compare(zodType: ZodTypeAny, js: Json, path: string, problems: string[]): void {
  const { type, nullable } = unwrap(zodType);
  const at = (msg: string) => problems.push(`${path || '(root)'}: ${msg}`);

  if (type instanceof z.ZodObject) {
    if (js.type !== 'object') at(`expected type object, got ${String(js.type)}`);
    if (js.additionalProperties !== false)
      at('expected additionalProperties: false (zod .strict())');
    const shape = type.shape as Record<string, ZodTypeAny>;
    const props = (js.properties ?? {}) as Record<string, Json>;
    const zodKeys = Object.keys(shape).sort();
    const jsKeys = Object.keys(props).sort();
    if (JSON.stringify(zodKeys) !== JSON.stringify(jsKeys))
      at(`properties differ: zod ${zodKeys} vs json ${jsKeys}`);
    const zodRequired = zodKeys.filter((k) => !unwrap(shape[k]!).optional).sort();
    const jsRequired = [...((js.required as string[] | undefined) ?? [])].sort();
    if (JSON.stringify(zodRequired) !== JSON.stringify(jsRequired))
      at(`required differ: zod ${zodRequired} vs json ${jsRequired}`);
    for (const key of zodKeys)
      if (props[key]) compare(shape[key]!, props[key]!, `${path}.${key}`, problems);
    return;
  }
  if (type instanceof z.ZodArray) {
    if (js.type !== 'array') at(`expected type array, got ${String(js.type)}`);
    const def = type._def as {
      minLength: { value: number } | null;
      maxLength: { value: number } | null;
    };
    if ((def.minLength?.value ?? undefined) !== js.minItems)
      at(`minItems zod ${def.minLength?.value} vs json ${String(js.minItems)}`);
    if ((def.maxLength?.value ?? undefined) !== js.maxItems)
      at(`maxItems zod ${def.maxLength?.value} vs json ${String(js.maxItems)}`);
    compare(type.element as ZodTypeAny, js.items as Json, `${path}[]`, problems);
    return;
  }
  if (type instanceof z.ZodDiscriminatedUnion) {
    const variants = (js.oneOf ?? []) as Json[];
    const options = [...(type.options as ZodTypeAny[])];
    if (variants.length !== options.length)
      at(`oneOf has ${variants.length} variants, zod ${options.length}`);
    for (const option of options) {
      const kind = (
        (unwrap(option).type as z.ZodObject<z.ZodRawShape>).shape.kind as z.ZodLiteral<string>
      ).value;
      const variant = variants.find((v) => ((v.properties as Json).kind as Json).const === kind);
      if (!variant) at(`no JSON Schema variant for kind ${kind}`);
      else compare(option, variant, `${path}<${kind}>`, problems);
    }
    return;
  }
  if (type instanceof z.ZodEnum) {
    if (JSON.stringify(type.options) !== JSON.stringify(js.enum))
      at(`enum zod ${type.options} vs json ${String(js.enum)}`);
    return;
  }
  if (type instanceof z.ZodLiteral) {
    if (js.const !== type.value) at(`const zod ${String(type.value)} vs json ${String(js.const)}`);
    return;
  }
  if (type instanceof z.ZodString) {
    if (js.type !== 'string') at(`expected type string, got ${String(js.type)}`);
    for (const check of type._def.checks) {
      if (check.kind === 'min' && js.minLength !== check.value)
        at(`minLength zod ${check.value} vs json ${String(js.minLength)}`);
      if (check.kind === 'max' && js.maxLength !== check.value)
        at(`maxLength zod ${check.value} vs json ${String(js.maxLength)}`);
      if (check.kind === 'regex' && js.pattern !== check.regex.source)
        at(`pattern zod ${check.regex.source} vs json ${String(js.pattern)}`);
    }
    return;
  }
  if (type instanceof z.ZodNumber) {
    const integer = type._def.checks.some((c) => c.kind === 'int');
    const expected = integer ? 'integer' : 'number';
    const jsType = Array.isArray(js.type) ? js.type : [js.type];
    if (!jsType.includes(expected)) at(`expected type ${expected}, got ${String(js.type)}`);
    if (nullable && !jsType.includes('null'))
      at('zod is nullable, JSON Schema does not allow null');
    for (const check of type._def.checks) {
      if (
        check.kind === 'min' &&
        js.minimum !== check.value &&
        !(check.value === 0 && !check.inclusive && js.minimum === 1)
      ) {
        at(`minimum zod ${check.value} vs json ${String(js.minimum)}`);
      }
      if (check.kind === 'max' && js.maximum !== check.value)
        at(`maximum zod ${check.value} vs json ${String(js.maximum)}`);
    }
    return;
  }
  at(`unhandled zod type ${type.constructor.name}`);
}

describe('the zod schema and the published JSON Schema agree', () => {
  it('on every object: properties, required fields, strictness', () => {
    const problems: string[] = [];
    compare(agentResearchReceiptSchema, PUBLISHED, '', problems);
    expect(problems).toEqual([]);
  });

  it('on every enum and constant', () => {
    const props = PUBLISHED.properties as Record<string, Json>;
    expect(props.type).toEqual({ const: 'AgentResearchReceipt' });
    expect(props.version).toEqual({ const: '1.0' });
    expect(props.subjectType).toEqual({ enum: ['project', 'token', 'contract'] });
    const claimItems = (props.claims as Json).items as Json;
    expect(((claimItems.properties as Json).kind as Json).enum).toEqual([
      'FACT',
      'DERIVED',
      'JUDGEMENT',
    ]);
    const kinds = (((claimItems.properties as Json).evidence as Json).items as Json)
      .oneOf as Json[];
    expect(kinds.map((k) => ((k.properties as Json).kind as Json).const)).toEqual([
      'hey_evidence',
      'hey_change_event',
      'hey_snapshot',
      'market_observation',
      'external',
      'hey_agent_answer',
    ]);
    expect(((props.outcome as Json).properties as Json).decidedBy).toEqual({ const: 'agent' });
  });

  it('the structural walk notices a disagreement (it is not vacuous)', () => {
    const tampered = clone(PUBLISHED);
    (tampered.required as string[]).pop();
    ((tampered.properties as Json).subjectType as Json).enum = ['project', 'token'];
    const problems: string[] = [];
    compare(agentResearchReceiptSchema, tampered, '', problems);
    expect(problems.length).toBeGreaterThanOrEqual(2);
  });
});

/* ------------------------------------------- same verdict, fixture by fixture */

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateJson = ajv.compile(PUBLISHED);

const FIXTURES: [string, unknown][] = [
  ['the other-project example', EXAMPLE_RECEIPT_OTHER_PROJECT],
  ['the HEY example', EXAMPLE_RECEIPT_HEY],
  ['the agent-answer fixture', fixture('valid/agent-answer-and-ids.json')],
  ['another chain (v1 accepts it)', fixture('invalid/other-chain.json')],
  ['an unknown top-level field', { ...clone(EXAMPLE_RECEIPT_HEY), reasoning: 'x' }],
  [
    'a FACT with no evidence',
    { ...clone(EXAMPLE_RECEIPT_HEY), claims: [{ statement: 'x', kind: 'FACT', evidence: [] }] },
  ],
  [
    'a JUDGEMENT with no evidence field',
    { ...clone(EXAMPLE_RECEIPT_HEY), claims: [{ statement: 'x', kind: 'JUDGEMENT' }] },
  ],
  [
    'an outcome decided by HEY',
    { ...clone(EXAMPLE_RECEIPT_HEY), outcome: { value: 'PASS', decidedBy: 'hey' } },
  ],
  [
    'a project receipt without a slug',
    {
      ...clone(EXAMPLE_RECEIPT_HEY),
      subjectType: 'project',
      subject: { chainId: 4663, tokenContract: '0x0000000000000000000000000000000000000001' },
    },
  ],
  ['a subject naming nothing', { ...clone(EXAMPLE_RECEIPT_HEY), subject: { chainId: 4663 } }],
  [
    'an http URL',
    { ...clone(EXAMPLE_RECEIPT_HEY), sourceSystems: [{ name: 'x', url: 'http://example.com' }] },
  ],
  ['no source system', { ...clone(EXAMPLE_RECEIPT_HEY), sourceSystems: [] }],
  ['a confidence above 1', { ...clone(EXAMPLE_RECEIPT_HEY), confidence: 1.5 }],
  ['a chainId of 0', { ...clone(EXAMPLE_RECEIPT_HEY), subject: { chainId: 0, projectSlug: 'x' } }],
  ['a wrong version', { ...clone(EXAMPLE_RECEIPT_HEY), version: '2.0' }],
  [
    'an unknown evidence kind',
    {
      ...clone(EXAMPLE_RECEIPT_HEY),
      risks: [{ statement: 'x', evidence: [{ kind: 'rumour', id: 'x' }] }],
    },
  ],
  [
    'an unknown capability',
    {
      ...clone(EXAMPLE_RECEIPT_HEY),
      risks: [
        {
          statement: 'x',
          evidence: [
            {
              kind: 'hey_agent_answer',
              capability: 'price',
              schemaVersion: '1',
              url: 'https://heyresearch.xyz/api/agent/price',
              asOf: '2026-09-28T12:00:00Z',
            },
          ],
        },
      ],
    },
  ],
  [
    'an unknown category',
    { ...clone(EXAMPLE_RECEIPT_HEY), unknowns: [{ statement: 'x', category: 'ZERO' }] },
  ],
];

describe('the JSON Schema and zod answer the same for every fixture', () => {
  it.each(FIXTURES)('%s', (_name, value) => {
    const zod = agentResearchReceiptSchema.safeParse(value).success;
    const json = validateJson(value);
    expect(json, JSON.stringify(validateJson.errors)).toBe(zod);
  });

  it('accepts exactly the well-formed ones', () => {
    const accepted = FIXTURES.filter(
      ([, value]) => agentResearchReceiptSchema.safeParse(value).success,
    ).map(([name]) => name);
    expect(accepted).toEqual([
      'the other-project example',
      'the HEY example',
      'the agent-answer fixture',
      'another chain (v1 accepts it)',
      'a JUDGEMENT with no evidence field',
    ]);
  });

  it('the one rule JSON Schema cannot say is zod’s alone: evidenceCutoff not after createdAt', () => {
    const late = fixture('invalid/shape-cutoff-after-created.json');
    expect(validateJson(late)).toBe(true);
    expect(agentResearchReceiptSchema.safeParse(late).success).toBe(false);
  });
});
