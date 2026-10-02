import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as api from '../src/index';
import { PACKAGE_NAME, PACKAGE_VERSION } from '../src/version';
import { ROOT } from './helpers';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  bin: Record<string, string>;
  files: string[];
};

describe('package', () => {
  it('name and version match the user-agent the online check sends', () => {
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
  });

  it('depends on zod only at runtime', () => {
    expect(Object.keys(pkg.dependencies)).toEqual(['zod']);
  });

  it('ships the hey-receipt bin and the published schema', () => {
    expect(pkg.bin).toEqual({ 'hey-receipt': './dist/cli.js' });
    expect(pkg.files).toContain('schema');
  });

  it('exports the contract and the validator', () => {
    expect(api.agentResearchReceiptSchema.safeParse).toBeTypeOf('function');
    for (const name of [
      'agentResearchReceiptJsonSchema',
      'parseEvidenceId',
      'validateReceipt',
      'validateReceiptJson',
      'checkReceiptOnline',
      'summarizeReceipt',
    ]) {
      expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('the library never fetches except in the one online module', () => {
    const offenders = readdirSync(join(ROOT, 'src'))
      .filter((f) => f.endsWith('.ts') && f !== 'online.ts')
      .filter((f) =>
        /\bfetch\s*\(|https?\.request|node:https?|node:net|node:child_process/.test(
          readFileSync(join(ROOT, 'src', f), 'utf8'),
        ),
      );
    expect(offenders).toEqual([]);
  });
});
