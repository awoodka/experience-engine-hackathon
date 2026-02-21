/**
 * Shared CLI argument parsing utilities.
 */

/** Extract positional arguments, skipping flags and their values. */
export function getPositionals(
  args: string[],
  booleanFlags: string[] = [],
): string[] {
  const boolSet = new Set(booleanFlags);
  const result: string[] = [];
  let i = 0;
  while (i < args.length) {
    if (args[i].startsWith("--")) {
      if (boolSet.has(args[i])) {
        i += 1;
      } else {
        i += 2;
      }
    } else {
      result.push(args[i]);
      i++;
    }
  }
  return result;
}

/** Get the value of a --name flag, or undefined if not present. */
export function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--")
    ? args[i + 1]
    : undefined;
}
