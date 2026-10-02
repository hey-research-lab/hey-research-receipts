/**
 * Receipt text is written by an agent HEY does not know: print it as data, never as terminal
 * control. Removes C0/C1 control characters (ANSI escapes included), bidirectional overrides and
 * zero-width characters, and folds runs of whitespace into one space.
 */
const range = (from: number, to: number): string =>
  `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
// C0 controls, DEL and C1 controls.
const CONTROL = new RegExp(`[${range(0x00, 0x1f)}${range(0x7f, 0x9f)}]`, 'g');
// Zero-width characters and marks, bidi embeddings/overrides/isolates, word joiner, BOM.
const INVISIBLE = new RegExp(
  `[${range(0x200b, 0x200f)}${range(0x202a, 0x202e)}${range(0x2060, 0x2069)}${String.fromCharCode(0xfeff)}]`,
  'g',
);

export function cleanText(value: string, max = 600): string {
  const folded = value.replace(CONTROL, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();
  return folded.length > max ? `${folded.slice(0, max - 1)}…` : folded;
}

/** True when the text holds a C0/C1 control character (used to refuse ids carrying them). */
export const hasControl = (value: string): boolean => {
  CONTROL.lastIndex = 0;
  const found = CONTROL.test(value);
  CONTROL.lastIndex = 0;
  return found;
};
