import { describe, expect, it, vi } from 'vitest';

import { EXAMPLE_RECEIPT_OTHER_PROJECT } from '../src/examples';
import { HEY_RECEIPT_VALIDATOR_URL, checkReceiptOnline } from '../src/online';
import { fixture, fixtureText } from './helpers';

const ANSWER = fixture('online/answer-other-project.json') as Record<string, unknown>;

const respond = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  vi.fn<typeof fetch>(
    async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
      }),
  );

const BODY = JSON.stringify(EXAMPLE_RECEIPT_OTHER_PROJECT);

describe('checkReceiptOnline', () => {
  it('POSTs only the receipt to the one fixed https URL, without following redirects', async () => {
    const fetchImpl = respond(200, ANSWER, { 'x-request-id': 'req-1' });
    const result = await checkReceiptOnline(BODY, { fetchImpl });
    expect(result).toMatchObject({ ok: true, httpStatus: 200, requestId: 'req-1' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://heyresearch.xyz/api/receipts/validate');
    expect(HEY_RECEIPT_VALIDATOR_URL.startsWith('https://')).toBe(true);
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(init?.credentials).toBe('omit');
    expect(init?.body).toBe(BODY);
    const headers = init?.headers as Record<string, string>;
    expect(Object.keys(headers).sort()).toEqual(['accept', 'content-type', 'user-agent']);
    expect(headers['user-agent']).toBe('@hey-research-lab/research-receipts/0.1.1');
  });

  it('keeps HEY’s answer, additive fields included', async () => {
    const result = await checkReceiptOnline(BODY, {
      fetchImpl: respond(200, { ...ANSWER, futureField: 1 }),
    });
    expect(result.ok && result.answer.heyEvidenceStands).toBe(true);
    expect(result.ok && (result.answer as Record<string, unknown>).futureField).toBe(1);
  });

  it('never sends more than 64 KB', async () => {
    const fetchImpl = respond(200, ANSWER);
    const result = await checkReceiptOnline(fixtureText('invalid/oversized.json'), { fetchImpl });
    expect(result).toMatchObject({ ok: false, error: { code: 'payload_too_large' } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a 429 with its delay and does not retry', async () => {
    const fetchImpl = respond(429, fixture('online/error-rate-limited.json'));
    const result = await checkReceiptOnline(BODY, { fetchImpl });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'rate_limited',
        retryAfterSeconds: 42,
        requestId: '00000000-0000-4000-8000-000000000001',
        retryable: true,
        httpStatus: 429,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('reads the retry-after header when the body has no delay', async () => {
    const result = await checkReceiptOnline(BODY, {
      fetchImpl: respond(429, 'slow down', { 'retry-after': '17' }),
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: 17 },
    });
  });

  it('maps HEY’s refusals and failures', async () => {
    expect(
      await checkReceiptOnline(BODY, {
        fetchImpl: respond(413, {
          error: 'payload_too_large',
          message: 'A receipt is at most 64 KB of JSON.',
        }),
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'refused', apiError: 'payload_too_large', retryable: false },
    });
    expect(
      await checkReceiptOnline(BODY, { fetchImpl: respond(404, { error: 'not_found' }) }),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await checkReceiptOnline(BODY, { fetchImpl: respond(503, { error: 'service_unavailable' }) }),
    ).toMatchObject({ ok: false, error: { code: 'server_error', retryable: true } });
  });

  it('refuses a redirect instead of following it', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    );
    const result = await checkReceiptOnline(BODY, { fetchImpl });
    expect(result).toMatchObject({ ok: false, error: { code: 'redirect_refused' } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('caps the answer it reads at 256 KB', async () => {
    const result = await checkReceiptOnline(BODY, {
      fetchImpl: respond(200, 'x'.repeat(300 * 1024)),
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'response_too_large' } });
  });

  it('refuses an answer that is not the documented shape (e.g. one claiming an endorsement)', async () => {
    expect(
      await checkReceiptOnline(BODY, { fetchImpl: respond(200, { ...ANSWER, endorsement: true }) }),
    ).toMatchObject({ ok: false, error: { code: 'unexpected_response' } });
    expect(await checkReceiptOnline(BODY, { fetchImpl: respond(200, '<html>') })).toMatchObject({
      ok: false,
      error: { code: 'unexpected_response' },
    });
  });

  it('reports a network failure and a timeout as retryable', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await checkReceiptOnline(BODY, { fetchImpl: down })).toMatchObject({
      ok: false,
      error: { code: 'network_error', retryable: true },
    });
    const slow = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    expect(await checkReceiptOnline(BODY, { fetchImpl: slow, timeoutMs: 20 })).toMatchObject({
      ok: false,
      error: { code: 'timeout', retryable: true },
    });
  });

  it('uses the blocked global fetch when none is injected (tests never reach the network)', async () => {
    const result = await checkReceiptOnline(BODY);
    expect(result).toMatchObject({ ok: false, error: { code: 'network_error' } });
  });
});
