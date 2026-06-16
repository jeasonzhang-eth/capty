/**
 * Download a 视频号 video and decrypt its encrypted prefix.
 *
 * The video URL (with encfilekey + token) is itself authorized — no cookie
 * needed. Only the first {@link ENC_LIMIT} bytes are encrypted, so we buffer
 * the response, XOR-decrypt the prefix with the ISAAC keystream, and write a
 * playable MP4 to disk. 视频号 clips are short, so a single buffer is fine.
 */

import { writeFile } from "node:fs/promises";
import { ENC_LIMIT, decryptPrefix } from "./isaac";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export type BinaryFetchLike = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; arrayBuffer(): Promise<ArrayBuffer> }>;

/**
 * Fetch `videoUrl`, decrypt the first 128 KiB with `decodeKey` (0n = not
 * encrypted), and write the resulting MP4 to `destPath`.
 * @returns number of bytes written
 */
export async function downloadAndDecrypt(
  videoUrl: string,
  decodeKey: bigint,
  destPath: string,
  fetchFn: BinaryFetchLike,
): Promise<number> {
  const resp = await fetchFn(videoUrl, { headers: { "user-agent": UA } });
  if (resp.status !== 200 && resp.status !== 206) {
    throw new Error(`视频下载失败 (HTTP ${resp.status})`);
  }
  const buf = new Uint8Array(await resp.arrayBuffer());
  if (buf.length === 0) throw new Error("视频下载为空");
  if (decodeKey !== 0n) {
    decryptPrefix(buf, decodeKey, ENC_LIMIT);
  }
  await writeFile(destPath, buf);
  return buf.length;
}
