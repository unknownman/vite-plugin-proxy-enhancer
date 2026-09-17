/**
 * Narrow a value to a plain object (non-array, non-null object).
 *
 * @param value The value to test.
 * @returns `true` when `value` is a plain object.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recursively merge `source` into `target`, returning a new object.
 *
 * Nested plain objects are merged recursively; other values are replaced.
 * `undefined` source values are skipped, so partial overrides are safe to pass.
 *
 * @example
 * deepMerge({ a: 1, nested: { x: 1 } }, { nested: { y: 2 } })
 * // => { a: 1, nested: { x: 1, y: 2 } }
 *
 * @param target The base object (not mutated).
 * @param source The overrides to apply.
 * @returns A new merged object.
 */
export function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Partial<T>,
): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const targetVal = result[key];
    const sourceVal = source[key];
    if (isObject(targetVal) && isObject(sourceVal)) {
      (result[key] as Record<string, unknown>) = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[typeof key];
    }
  }
  return result;
}
