import path from "path";

/**
 * Throw if `targetPath` resolves outside `basePath`.
 * Uses prefix-with-separator check to prevent bypass via sibling dirs sharing prefix.
 */
export function assertPathWithin(basePath: string, targetPath: string): void {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(resolvedBase + path.sep)
  ) {
    throw new Error(`Path traversal detected: ${targetPath} is outside ${basePath}`);
  }
}
