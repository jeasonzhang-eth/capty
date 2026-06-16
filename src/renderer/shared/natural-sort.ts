/** Sort file paths by basename, numeric-aware, without mutating the input. */
export function sortPathsByName(paths: readonly string[]): string[] {
  const base = (p: string): string => p.split(/[/\\]/).pop() ?? p;
  return [...paths].sort((a, b) =>
    base(a).localeCompare(base(b), undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}
