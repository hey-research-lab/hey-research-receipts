import { z } from 'zod';

import { AGENT_RESEARCH_RECEIPT_MAX_BYTES } from './schema';
import { byteLength } from './validate';
import { PACKAGE_NAME, PACKAGE_VERSION } from './version';

/**
 * The optional online check: one POST of the receipt to HEY's public, stateless validator, which
 * answers whether each HEY id the receipt cites exists and stands on HEY's public record.
 *
 * - Only ever this one fixed https URL; there is no option to point it elsewhere.
 * - The receipt is the only thing sent. Nothing the receipt names is fetched, here or by HEY.
 * - At most 64 KB is sent and 256 KB read back; redirects are refused, not followed; 10 s timeout.
 * - HEY allows 30 checks a minute per client. A 429 is reported with its delay; there is no retry.
 */
export const HEY_RECEIPT_VALIDATOR_URL = 'https://heyresearch.xyz/api/receipts/validate' as const;
export const ONLINE_TIMEOUT_MS = 10_000;
export const ONLINE_MAX_RESPONSE_BYTES = 256 * 1024;

const refStatus = z.enum([
  'exists',
  'revised',
  'project_exists',
  'withdrawn',
  'moved',
  'not_found',
  'invalid_id',
  'not_checked',
]);

/** HEY's validator answer, as documented. Additive fields are kept (`passthrough`). */
export const heyValidatorAnswerSchema = z
  .object({
    schema: z.literal('hey.agent-research-receipt/v1'),
    valid: z.boolean(),
    errors: z.array(z.object({ path: z.string(), message: z.string() }).passthrough()),
    subject: z
      .object({
        chainId: z.number(),
        projectSlug: z.string().optional(),
        status: refStatus,
        reason: z.string().optional(),
      })
      .passthrough()
      .optional(),
    evidence: z
      .object({
        total: z.number(),
        heyChecked: z.number(),
        results: z.array(
          z
            .object({
              kind: z.string(),
              ref: z.string(),
              status: refStatus,
              reason: z.string().optional(),
              scoringVersion: z
                .enum(['matches_current', 'differs_from_current', 'not_given'])
                .optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .optional(),
    heyEvidenceStands: z.union([z.boolean(), z.literal('partial'), z.null()]).optional(),
    heyEvidenceStandsReason: z.enum(['nothing_checked', 'some_not_checked']).optional(),
    stored: z.literal(false),
    endorsement: z.literal(false),
    note: z.string().optional(),
  })
  .passthrough();
export type HeyValidatorAnswer = z.infer<typeof heyValidatorAnswerSchema>;

export type OnlineErrorCode =
  | 'payload_too_large'
  | 'rate_limited'
  | 'not_found'
  | 'refused'
  | 'server_error'
  | 'redirect_refused'
  | 'response_too_large'
  | 'unexpected_response'
  | 'timeout'
  | 'network_error';

export interface OnlineError {
  code: OnlineErrorCode;
  message: string;
  retryable: boolean;
  /** HTTP status, when HEY answered. */
  httpStatus?: number;
  /** HEY's own error code, when it sent one (`payload_too_large`, `invalid_json`, …). */
  apiError?: string;
  requestId?: string;
  retryAfterSeconds?: number;
}

export type OnlineResult =
  | {
      ok: true;
      url: typeof HEY_RECEIPT_VALIDATOR_URL;
      httpStatus: number;
      requestId?: string;
      answer: HeyValidatorAnswer;
    }
  | { ok: false; url: typeof HEY_RECEIPT_VALIDATOR_URL; error: OnlineError };

export interface OnlineOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const fail = (error: OnlineError): OnlineResult => ({
  ok: false,
  url: HEY_RECEIPT_VALIDATOR_URL,
  error,
});

async function readCapped(response: Response, cap: number): Promise<string | undefined> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const errorEnvelope = z
  .object({
    error: z.string().max(80),
    message: z.string().max(500).optional(),
    requestId: z.string().max(120).optional(),
    retryAfterSeconds: z.number().optional(),
  })
  .passthrough();

/** POSTs the receipt's JSON text to HEY's validator. Call it only when the user asked for it. */
export async function checkReceiptOnline(
  receiptJson: string,
  options: OnlineOptions = {},
): Promise<OnlineResult> {
  const bytes = byteLength(receiptJson);
  if (bytes > AGENT_RESEARCH_RECEIPT_MAX_BYTES) {
    return fail({
      code: 'payload_too_large',
      message: `A receipt is at most ${AGENT_RESEARCH_RECEIPT_MAX_BYTES / 1024} KB of JSON; not sent.`,
      retryable: false,
    });
  }
  const url = new URL(HEY_RECEIPT_VALIDATOR_URL);
  if (url.protocol !== 'https:') throw new Error('The online check only uses https.');

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  let response: Response;
  try {
    response = await fetchImpl(url.href, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': `${PACKAGE_NAME}/${PACKAGE_VERSION}`,
      },
      body: receiptJson,
      redirect: 'manual',
      credentials: 'omit',
      signal: AbortSignal.timeout(options.timeoutMs ?? ONLINE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return name === 'TimeoutError' || name === 'AbortError'
      ? fail({
          code: 'timeout',
          message: `HEY did not answer within ${(options.timeoutMs ?? ONLINE_TIMEOUT_MS) / 1000} s.`,
          retryable: true,
        })
      : fail({
          code: 'network_error',
          message: 'Could not reach heyresearch.xyz.',
          retryable: true,
        });
  }

  const requestId = response.headers.get('x-request-id')?.slice(0, 120) ?? undefined;
  const status = response.status;
  if (response.type === 'opaqueredirect' || (status >= 300 && status < 400)) {
    return fail({
      code: 'redirect_refused',
      message: 'HEY answered with a redirect; redirects are not followed.',
      retryable: false,
      httpStatus: status,
      ...(requestId ? { requestId } : {}),
    });
  }

  const text = await readCapped(response, ONLINE_MAX_RESPONSE_BYTES).catch(() => undefined);
  if (text === undefined) {
    return fail({
      code: 'response_too_large',
      message: `HEY's answer was larger than ${ONLINE_MAX_RESPONSE_BYTES / 1024} KB, or could not be read.`,
      retryable: false,
      httpStatus: status,
    });
  }
  const body = safeJson(text);
  const envelope = errorEnvelope.safeParse(body);
  const api = envelope.success ? envelope.data : undefined;
  const common = {
    httpStatus: status,
    ...(api?.error ? { apiError: api.error } : {}),
    ...((api?.requestId ?? requestId) ? { requestId: api?.requestId ?? requestId } : {}),
  };

  if (status === 429) {
    const header = Number(response.headers.get('retry-after'));
    const retryAfterSeconds =
      api?.retryAfterSeconds ?? (Number.isFinite(header) && header >= 0 ? header : undefined);
    return fail({
      code: 'rate_limited',
      message: 'HEY allows 30 receipt checks a minute per client. Try again after the delay.',
      retryable: true,
      ...common,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }
  if (status === 404)
    return fail({
      code: 'not_found',
      message: 'HEY answered 404 for its receipt validator.',
      retryable: false,
      ...common,
    });
  if (status >= 400 && status < 500) {
    return fail({
      code: 'refused',
      message: api?.message ?? `HEY refused the request (HTTP ${status}).`,
      retryable: false,
      ...common,
    });
  }
  if (status >= 500 || status < 200) {
    return fail({
      code: 'server_error',
      message: `HEY answered HTTP ${status}.`,
      retryable: true,
      ...common,
    });
  }

  const answer = heyValidatorAnswerSchema.safeParse(body);
  if (!answer.success) {
    return fail({
      code: 'unexpected_response',
      message: 'HEY’s answer did not have the documented shape.',
      retryable: false,
      ...common,
    });
  }
  return {
    ok: true,
    url: HEY_RECEIPT_VALIDATOR_URL,
    httpStatus: status,
    ...(requestId ? { requestId } : {}),
    answer: answer.data,
  };
}
