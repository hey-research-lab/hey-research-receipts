import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { EXIT, run, type CliIo } from '../src/cli-main';
import { RECEIPT_NOT_PROOF } from '../src/notice';
import { fixture, fixturePath, fixtureText } from './helpers';

const NOW = new Date('2026-10-02T12:00:00Z');

async function cli(argv: string[], options: { stdin?: string; fetchImpl?: typeof fetch } = {}) {
  let stdout = '';
  let stderr = '';
  const io: CliIo = {
    stdout: (t) => (stdout += t),
    stderr: (t) => (stderr += t),
    stdin: (async function* () {
      if (options.stdin !== undefined) yield Buffer.from(options.stdin, 'utf8');
    })(),
    now: () => NOW,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  };
  const code = await run(argv, io);
  return { code, stdout, stderr };
}

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );

const scratch = mkdtempSync(join(tmpdir(), 'hey-receipt-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe('hey-receipt validate', () => {
  it('exits 0 for a valid receipt, offline, and says HEY was not asked', async () => {
    const r = await cli(['validate', fixturePath('valid/other-project.json')]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('VALID');
    expect(r.stdout).toContain('Robinhood Chain (4663)');
    expect(r.stdout).toContain('HEY was not asked');
    expect(r.stdout).toContain(RECEIPT_NOT_PROOF);
  });

  it.each([
    'invalid/shape-reasoning-trace.json',
    'invalid/bad-evidence-ids.json',
    'invalid/other-chain.json',
    'invalid/oversized.json',
    'invalid/proto-key-root.json',
    'invalid/not-json.json',
  ])('exits 1 for %s', async (name) => {
    const r = await cli(['validate', fixturePath(name)]);
    expect(r.code).toBe(EXIT.invalid);
    expect(r.stdout).toContain('INVALID');
  });

  it('reports unsupported_chain as an invalid receipt (exit 1)', async () => {
    const r = await cli(['validate', '--json', fixturePath('invalid/other-chain.json')]);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout) as {
      ok: boolean;
      offline: { errors: { code: string }[]; shapeValid: boolean };
    };
    expect(out.ok).toBe(false);
    expect(out.offline.shapeValid).toBe(true);
    expect(out.offline.errors.map((e) => e.code)).toEqual(['unsupported_chain']);
  });

  it('--json prints exactly one JSON document', async () => {
    const r = await cli(['validate', '--json', fixturePath('valid/hey-token.json')]);
    const out = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(out).toMatchObject({
      schema: 'hey-receipt.validate/v1',
      ok: true,
      chain: { chainId: 4663, caip2: 'eip155:4663' },
      online: null,
      notice: RECEIPT_NOT_PROOF,
      offline: {
        valid: true,
        stored: false,
        endorsement: false,
        fetched: false,
        heyEvidenceStands: null,
      },
    });
    expect((out.offline as Record<string, unknown>).receipt).toBeUndefined();
  });

  it('reads stdin with -', async () => {
    const r = await cli(['validate', '-'], { stdin: fixtureText('valid/hey-token.json') });
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('<stdin>');
  });

  it('refuses oversized stdin without reading it all', async () => {
    const r = await cli(['validate', '--json', '-'], {
      stdin: fixtureText('invalid/oversized.json'),
    });
    expect(r.code).toBe(EXIT.invalid);
    expect(JSON.parse(r.stdout).offline.errors[0].code).toBe('payload_too_large');
  });

  it('--quiet prints nothing', async () => {
    const r = await cli(['validate', '--quiet', fixturePath('invalid/other-chain.json')]);
    expect(r).toEqual({ code: 1, stdout: '', stderr: '' });
  });

  it('never touches the network without --online', async () => {
    const fetchImpl = answering(200, fixture('online/answer-other-project.json'));
    await cli(['validate', fixturePath('valid/other-project.json')], { fetchImpl });
    await cli(['inspect', fixturePath('valid/other-project.json')], { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('hey-receipt validate --online', () => {
  it('asks HEY once and prints its per-reference answer', async () => {
    const fetchImpl = answering(200, fixture('online/answer-other-project.json'));
    const r = await cli(['validate', '--online', fixturePath('valid/other-project.json')], {
      fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://heyresearch.xyz/api/receipts/validate');
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).toContain('project_exists');
    expect(r.stdout).toContain('as_of_not_verified');
    expect(r.stdout).toContain('HEY evidence stands: yes');
    expect(r.stdout).toContain('endorsement: false');
    expect(r.stdout.split('\n')[0]).toMatch(/^VALID \(confirmed by HEY\)/);
  });

  it('exits 1 when HEY says a cited id does not stand', async () => {
    const r = await cli(['validate', '--online', fixturePath('valid/other-project.json')], {
      fetchImpl: answering(200, fixture('online/answer-withdrawn.json')),
    });
    expect(r.code).toBe(EXIT.invalid);
    expect(r.stdout).toContain('withdrawn:retracted');
    // The headline answers the whole run, never a bare offline VALID.
    expect(r.stdout.split('\n')[0]).toMatch(/^NOT CONFIRMED /);
  });

  it('does not send a receipt that is invalid offline', async () => {
    const fetchImpl = answering(200, fixture('online/answer-other-project.json'));
    const r = await cli(
      ['validate', '--online', '--json', fixturePath('invalid/other-chain.json')],
      { fetchImpl },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.code).toBe(EXIT.invalid);
    expect(JSON.parse(r.stdout).online).toEqual({ skipped: 'offline_invalid' });
  });

  it.each([
    [429, fixture('online/error-rate-limited.json'), EXIT.rateLimited],
    [404, { error: 'not_found' }, EXIT.notFound],
    [400, { error: 'invalid_json', message: 'The request body is not valid JSON.' }, EXIT.refused],
    [500, { error: 'internal_error' }, EXIT.network],
  ])('HTTP %i exits %i', async (status, body, expected) => {
    const r = await cli(['validate', '--online', fixturePath('valid/other-project.json')], {
      fetchImpl: answering(status, body),
    });
    expect(r.code).toBe(expected);
  });

  it('prints the delay of a 429', async () => {
    const r = await cli(['validate', '--online', fixturePath('valid/other-project.json')], {
      fetchImpl: answering(429, fixture('online/error-rate-limited.json')),
    });
    expect(r.stdout).toContain('retry after: 42 s');
    expect(r.stdout.split('\n')[0]).toMatch(/^VALID \(offline only; HEY check not completed\)/);
  });
});

describe('hey-receipt inspect', () => {
  it('summarises the question, evidence ids, freshness, content origins and unknowns', async () => {
    const r = await cli(['inspect', fixturePath('valid/other-project.json')]);
    expect(r.code).toBe(EXIT.ok);
    const text = r.stdout;
    expect(text).toContain('Subject:         project hoodlock on Robinhood Chain (4663)');
    expect(text).toContain('(self-declared)');
    expect(text).toContain('ship:3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f');
    expect(text).toContain(
      'resolves at https://heyresearch.xyz/api/evidence/ship%3A3f1c2b1e-4d5a-4c6b-8e7f-9a0b1c2d3e4f',
    );
    expect(text).toContain(
      'Evidence cutoff:  2026-09-28T11:45:00Z (15 min before creation; 4 days before this inspection)',
    );
    expect(text).toContain('oldest 2026-09-26T08:00:00Z, newest 2026-09-28T11:40:00Z');
    expect(text).toContain(
      'Market providers:     geckoterminal (market context, never builder evidence)',
    );
    expect(text).toContain(
      'HEY holds no package registry source for this project. (coverage: package)',
    );
    expect(text).toContain(
      "MONITOR — Evidence of continued development; revisit on the next release or a coverage change. (the agent's own vocabulary)",
    );
    expect(text).toContain(RECEIPT_NOT_PROOF);
    expect(text).toContain('This tool fetched nothing the receipt names.');
  });

  it('keeps an unstated confidence and outcome as "not stated", never 0', async () => {
    const r = await cli(['inspect', '--json', fixturePath('valid/agent-answer-and-ids.json')]);
    const out = JSON.parse(r.stdout);
    expect(out.summary.confidence).toEqual({ value: null, reason: 'not_stated' });
    expect(out.summary.outcome).toEqual({ value: null, reason: 'not_stated' });
    expect(out.summary.unknowns.map((u: { category?: string }) => u.category)).toEqual([
      'NOT_MEASURED',
      'STALE',
    ]);
    expect(out.summary.contentOrigins).toMatchObject({
      heyRecords: 6,
      heyAgentAnswers: 1,
      marketProviders: [],
      externalUrls: 0,
    });
    expect(out.notice).toBe(RECEIPT_NOT_PROOF);
  });

  it('exits 1 and still summarises a well-formed receipt on another chain', async () => {
    const r = await cli(['inspect', fixturePath('invalid/other-chain.json')]);
    expect(r.code).toBe(EXIT.invalid);
    expect(r.stdout).toContain('chain 1 — not supported by this tool');
    expect(r.stdout).toContain('unsupported_chain');
  });

  it('exits 1 on a receipt it cannot summarise', async () => {
    const r = await cli(['inspect', fixturePath('invalid/shape-reasoning-trace.json')]);
    expect(r.code).toBe(EXIT.invalid);
    expect(r.stdout).toContain('could not be summarised');
  });

  it('prints agent text as data: control and bidi characters are removed', async () => {
    const receipt = fixture('valid/other-project.json') as Record<string, unknown>;
    const esc = String.fromCharCode(27);
    const rlo = String.fromCharCode(0x202e);
    receipt.thesisSummary = `Plain ${esc}[2J${esc}]0;title${String.fromCharCode(7)} text ${rlo}reversed`;
    const path = join(scratch, 'controls.json');
    writeFileSync(path, JSON.stringify(receipt));
    const r = await cli(['inspect', path]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.stdout).not.toContain(esc);
    expect(r.stdout).not.toContain(rlo);
    expect(r.stdout).toContain('Thesis summary:  Plain [2J ]0;title text reversed');
  });
});

describe('hey-receipt usage', () => {
  it.each([
    [[], EXIT.usage],
    [['--help'], EXIT.ok],
    [['help'], EXIT.ok],
    [['frobnicate', 'x'], EXIT.usage],
    [['validate'], EXIT.usage],
    [['validate', 'a', 'b'], EXIT.usage],
    [['validate', '--bogus', 'a'], EXIT.usage],
    [['inspect', '--online', 'a'], EXIT.usage],
    [['validate', join(scratch, 'missing.json')], EXIT.usage],
    [['validate', scratch], EXIT.usage],
  ])('%j exits %i', async (argv, expected) => {
    expect((await cli(argv as string[])).code).toBe(expected);
  });

  it('prints the version', async () => {
    expect((await cli(['--version'])).stdout).toBe('0.1.1\n');
  });

  it('refuses to follow a symbolic link', async () => {
    const link = join(scratch, 'link.json');
    symlinkSync(fixturePath('valid/other-project.json'), link);
    const r = await cli(['validate', link]);
    expect(r.code).toBe(EXIT.usage);
    expect(r.stderr).toContain('symbolic link');
  });

  it('help carries the neutrality statement', async () => {
    expect((await cli(['--help'])).stdout).toContain(RECEIPT_NOT_PROOF);
  });
});
