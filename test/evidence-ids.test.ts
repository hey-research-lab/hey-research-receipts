import { describe, expect, it } from 'vitest';

import { EVIDENCE_FAMILIES, formatEvidenceId, parseEvidenceId } from '../src/evidence-ids';

const U = '3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f';
const P = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const A = '0x0000000000000000000000000000000000000002';

describe('HEY typed evidence ids', () => {
  it('has the fourteen public families, security and v4hook included', () => {
    expect([...EVIDENCE_FAMILIES]).toEqual([
      'ship',
      'signal',
      'abi',
      'impl',
      'lock',
      'source',
      'claim',
      'state',
      'integrity',
      'narrative',
      'method',
      'sourcechange',
      'security',
      'v4hook',
    ]);
  });

  const WELL_FORMED = [
    `ship:${U}`,
    `signal:${U}`,
    `abi:${U}`,
    `source:${U}`,
    `claim:${U}`,
    `method:${U}`,
    `sourcechange:${U}`,
    `impl:4663:${A}:1234567:3`,
    `impl:4663:${A}:rpc:${U}`,
    'lock:4663:17',
    `state:${P}:activity_status:42`,
    `integrity:${U}:conflict:READINGS_DISAGREE`,
    `narrative:${P}:defi`,
    `security:${P}:audit:0123456789abcdef`,
    `v4hook:4663:${A}`,
  ];

  it.each(WELL_FORMED)('parses and formats %s unchanged', (id) => {
    const parsed = parseEvidenceId(id);
    expect(parsed).toBeDefined();
    expect(formatEvidenceId(parsed!)).toBe(id);
  });

  it('every family has a well-formed example above', () => {
    const covered = new Set(WELL_FORMED.map((id) => parseEvidenceId(id)!.family));
    expect([...covered].sort()).toEqual([...EVIDENCE_FAMILIES].sort());
  });

  it('normalises case: uuids, addresses and the family are read lower-case', () => {
    expect(formatEvidenceId(parseEvidenceId(`SHIP:${U.toUpperCase()}`)!)).toBe(`ship:${U}`);
    expect(
      formatEvidenceId(parseEvidenceId(`v4hook:4663:${A.toUpperCase().replace('0X', '0x')}`)!),
    ).toBe(`v4hook:4663:${A}`);
  });

  it.each([
    ['an event id with a suffix', `source:${U}:added`],
    ['a lock event id with a suffix', 'lock:4663:17:due'],
    ['an unknown family', `rumour:${U}`],
    ['a bare uuid', U],
    ['a ship id that is not a uuid', 'ship:42'],
    ['a slug-based narrative id', 'narrative:hoodlock'],
    ['a bad security kind', `security:${P}:verdict:0123456789abcdef`],
    ['a short security hash', `security:${P}:audit:0123`],
    ['an impl id without a log index', `impl:4663:${A}:1234567`],
    ['a non-numeric chain', `v4hook:base:${A}`],
    ['a short address', 'v4hook:4663:0x1234'],
    ['an unsafe integer', `lock:4663:${'9'.repeat(18)}`],
    ['an upper-case state key', `state:${P}:ActivityStatus:1`],
    ['empty', ''],
    ['too long', `ship:${U}${'0'.repeat(240)}`],
    ['a family only', 'ship:'],
  ])('refuses %s', (_name, id) => {
    expect(parseEvidenceId(id)).toBeUndefined();
  });
});
