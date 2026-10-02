import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const fixturePath = (name: string): string => join(ROOT, 'fixtures', name);
export const fixtureText = (name: string): string => readFileSync(fixturePath(name), 'utf8');
export const fixture = (name: string): unknown => JSON.parse(fixtureText(name)) as unknown;
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
