/**
 * Husk — VectorFilter type and matcher.
 *
 * A VectorFilter matches a stored item's metadata against a
 * declarative predicate. Used to scope vector searches to a
 * subset of stored items (e.g. "only search emails from the
 * last week" or "only search memories tagged 'project-x'").
 *
 * Operators (nested in the value position of a clause):
 *   - exact value (string/number/boolean) — strict equality
 *   - { $in: [...] } — value is in the array
 *   - { $contains: 'x' } — array metadata contains 'x' (or string contains substring)
 *   - { $exists: true } — key is present (or absent, with false)
 *
 * Multiple clauses in a single filter are ANDed. Missing keys
 * are treated as not-matching.
 *
 * The matchesFilter() function is the canonical implementation;
 * backends can call it directly (for in-memory + tests) or
 * translate to their native query language (sqlite-vec WHERE,
 * cloud provider filter DSL, etc.).
 */

export type VectorFilter = Readonly<Record<string, unknown>>;

/**
 * Returns true if the metadata matches every clause in the filter.
 */
export function matchesFilter(
  metadata: Readonly<Record<string, unknown>>,
  filter: VectorFilter,
): boolean {
  for (const [key, expected] of Object.entries(filter)) {
    const actual = metadata[key];
    if (isOperatorObject(expected)) {
      if ('$in' in expected) {
        const list = expected.$in;
        if (!Array.isArray(list)) return false;
        if (!Array.isArray(actual) || !list.some((v: unknown) => v === actual)) return false;
      } else if ('$contains' in expected) {
        const needle = expected.$contains;
        if (Array.isArray(actual)) {
          if (!actual.includes(needle as never)) return false;
        } else if (typeof actual === 'string') {
          if (!actual.includes(String(needle))) return false;
        } else {
          return false;
        }
      } else if ('$exists' in expected) {
        const present = key in metadata;
        if (Boolean(expected.$exists) !== present) return false;
      } else {
        return false;
      }
    } else {
      // Plain value — strict equality.
      if (actual !== expected) return false;
    }
  }
  return true;
}

function isOperatorObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return '$in' in v || '$contains' in v || '$exists' in v;
}
