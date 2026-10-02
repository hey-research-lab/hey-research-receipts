import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

import { AGENT_RESEARCH_RECEIPT_MAX_BYTES } from './schema';

/**
 * Reading one receipt for the CLI: a regular file (never through a symlink) or stdin, never more
 * than the 64 KB limit plus one byte, so an oversized input is refused without reading all of it.
 */
export type InputResult =
  | { ok: true; text: string; label: string }
  | {
      ok: false;
      kind: 'usage';
      code: 'file_not_found' | 'symlink_refused' | 'not_a_file' | 'unreadable';
      message: string;
    }
  | { ok: false; kind: 'document'; code: 'payload_too_large'; message: string; bytes: number };

const LIMIT = AGENT_RESEARCH_RECEIPT_MAX_BYTES;
const tooLarge = (bytes: number): InputResult => ({
  ok: false,
  kind: 'document',
  code: 'payload_too_large',
  message: `A receipt is at most ${LIMIT / 1024} KB of JSON; this input is larger.`,
  bytes,
});

export async function readStdin(stdin: AsyncIterable<Uint8Array | string>): Promise<InputResult> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stdin) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
    total += buf.byteLength;
    if (total > LIMIT) return tooLarge(total);
    chunks.push(buf);
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8'), label: '<stdin>' };
}

export async function readReceiptFile(path: string): Promise<InputResult> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return { ok: false, kind: 'usage', code: 'file_not_found', message: `No such file: ${path}` };
  }
  if (info.isSymbolicLink())
    return {
      ok: false,
      kind: 'usage',
      code: 'symlink_refused',
      message: `Refusing to follow a symbolic link: ${path}`,
    };
  if (!info.isFile())
    return { ok: false, kind: 'usage', code: 'not_a_file', message: `Not a regular file: ${path}` };
  if (info.size > LIMIT) return tooLarge(info.size);

  // O_NOFOLLOW closes the gap between lstat and open where the platform has it.
  const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = await open(path, flags);
  } catch {
    return { ok: false, kind: 'usage', code: 'unreadable', message: `Cannot read: ${path}` };
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      return {
        ok: false,
        kind: 'usage',
        code: 'not_a_file',
        message: `Not a regular file: ${path}`,
      };
    const buffer = Buffer.alloc(LIMIT + 1);
    let read = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
      if (read > LIMIT) return tooLarge(read);
    }
    return { ok: true, text: buffer.subarray(0, read).toString('utf8'), label: path };
  } catch {
    return { ok: false, kind: 'usage', code: 'unreadable', message: `Cannot read: ${path}` };
  } finally {
    await handle.close();
  }
}
