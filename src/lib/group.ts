/** Buckets items by a string key, preserving each bucket's insertion order. Sorting/ordering of
 * the resulting groups is left to the caller (`[...bucketBy(items, keyFn).entries()].sort(...)`)
 * since different lists want different group orderings (newest-first, alphabetical, etc). */
export function bucketBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return map;
}
