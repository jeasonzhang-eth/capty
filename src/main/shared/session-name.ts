/**
 * Turn a session title into a filesystem-safe folder/file base name.
 *
 * The on-disk audio folder for a session is named after this value so that the
 * directory on disk matches the title shown in the UI. Used by both the rename
 * handler (session-handlers.ts) and the download handler
 * (audio-download-handlers.ts) so every code path produces the same names.
 *
 * Strips characters illegal on common filesystems and any leading dots, then
 * trims surrounding whitespace. Returns an empty string when nothing usable
 * remains — callers should fall back to a timestamp in that case.
 */
export function sanitizeSessionDirName(title: string): string {
  return title
    .replace(/[/\\:*?"<>|]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .trim();
}
