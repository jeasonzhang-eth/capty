/**
 * WeChat Channels (视频号) video decryption — ISAAC64 stream cipher.
 *
 * 视频号 encrypts only the first {@link ENC_LIMIT} bytes of a video file with
 * an ISAAC64 keystream seeded by the per-video `decodeKey` (a uint64). The rest
 * of the file is plaintext. This is a port of wx_channels_download/pkg/decrypt
 * (originally https://github.com/Hanson/WechatSphDecrypt), verified against the
 * Go reference with golden keystream vectors (see tests).
 *
 * All arithmetic is uint64, emulated with BigInt masked to 64 bits.
 */

const MASK = (1n << 64n) - 1n;

/** 视频号 encrypts only the first 128 KiB of the stream. */
export const ENC_LIMIT = 131072;

type U64x8 = [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

/** ISAAC64 mixing step (translated statement-for-statement from the Go source). */
function mix(s: U64x8): U64x8 {
  let [a, b, c, d, e, f, g, h] = s;
  a = (a - e) & MASK;
  f = (f ^ (h >> 9n)) & MASK;
  h = (h + a) & MASK;
  b = (b - f) & MASK;
  g = (g ^ ((a << 9n) & MASK)) & MASK;
  a = (a + b) & MASK;
  c = (c - g) & MASK;
  h = (h ^ (b >> 23n)) & MASK;
  b = (b + c) & MASK;
  d = (d - h) & MASK;
  a = (a ^ ((c << 15n) & MASK)) & MASK;
  c = (c + d) & MASK;
  e = (e - a) & MASK;
  b = (b ^ (d >> 14n)) & MASK;
  d = (d + e) & MASK;
  f = (f - b) & MASK;
  c = (c ^ ((e << 20n) & MASK)) & MASK;
  e = (e + f) & MASK;
  g = (g - c) & MASK;
  d = (d ^ (f >> 17n)) & MASK;
  f = (f + g) & MASK;
  h = (h - d) & MASK;
  e = (e ^ ((g << 14n) & MASK)) & MASK;
  g = (g + h) & MASK;
  return [a, b, c, d, e, f, g, h];
}

/** ISAAC64 CSPRNG seeded with a single uint64 key (视频号 convention). */
export class Isaac64 {
  private randCnt = 255;
  private seed = new Array<bigint>(256).fill(0n);
  private mm = new Array<bigint>(256).fill(0n);
  private aa = 0n;
  private bb = 0n;
  private cc = 0n;

  constructor(encKey: bigint) {
    this.init(encKey & MASK);
  }

  private init(encKey: bigint): void {
    const golden = 0x9e3779b97f4a7c13n;
    let s: U64x8 = [golden, golden, golden, golden, golden, golden, golden, golden];

    this.seed[0] = encKey;
    // seed[1..255] already 0

    for (let i = 0; i < 4; i++) s = mix(s);

    const fill = (src: bigint[]): void => {
      for (let i = 0; i < 256; i += 8) {
        for (let j = 0; j < 8; j++) s[j] = (s[j] + src[i + j]) & MASK;
        s = mix(s);
        for (let j = 0; j < 8; j++) this.mm[i + j] = s[j];
      }
    };
    fill(this.seed);
    fill(this.mm);

    this.isaac();
  }

  private isaac(): void {
    this.cc = (this.cc + 1n) & MASK;
    this.bb = (this.bb + this.cc) & MASK;
    const mm = this.mm;
    let aa = this.aa;
    let bb = this.bb;
    for (let i = 0; i < 256; i++) {
      switch (i % 4) {
        case 0:
          aa = ~(aa ^ ((aa << 21n) & MASK)) & MASK;
          break;
        case 1:
          aa = (aa ^ (aa >> 5n)) & MASK;
          break;
        case 2:
          aa = (aa ^ ((aa << 12n) & MASK)) & MASK;
          break;
        default:
          aa = (aa ^ (aa >> 33n)) & MASK;
          break;
      }
      aa = (aa + mm[(i + 128) % 256]) & MASK;
      const x = mm[i];
      const y = (mm[Number((x >> 3n) % 256n)] + aa + bb) & MASK;
      mm[i] = y;
      bb = (mm[Number((y >> 11n) % 256n)] + x) & MASK;
      this.seed[i] = bb;
    }
    this.aa = aa;
    this.bb = bb;
  }

  /** Next 64-bit ISAAC output. */
  next(): bigint {
    const result = this.seed[this.randCnt];
    if (this.randCnt === 0) {
      this.isaac();
      this.randCnt = 255;
    } else {
      this.randCnt--;
    }
    return result;
  }
}

function bigToBytesBE(v: bigint): number[] {
  const out = new Array<number>(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Decrypt the encrypted prefix of a 视频号 video buffer in place (XOR keystream).
 * The encrypted region is `min(buf.length, encLimit)` bytes. No-op when the key
 * is 0 (unencrypted video) or the buffer is empty.
 */
export function decryptPrefix(
  buf: Uint8Array,
  key: bigint,
  encLimit: number = ENC_LIMIT,
): void {
  const n = Math.min(buf.length, encLimit);
  if (n === 0 || key === 0n) return;
  const inst = new Isaac64(key);
  let i = 0;
  while (i < n) {
    const block = bigToBytesBE(inst.next());
    for (let j = 0; j < 8; j++) {
      const idx = i + j;
      if (idx >= n) return;
      buf[idx] ^= block[j];
    }
    i += 8;
  }
}
