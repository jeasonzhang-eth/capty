import { describe, it, expect } from "vitest";
import { Isaac64, decryptPrefix, ENC_LIMIT } from "../../src/main/wechat/isaac";

/**
 * Golden vectors from the Go reference (wx_channels_download/pkg/decrypt):
 * keystream(key, n) == DecryptData(zeros(n), n, key). Decrypting an all-zero
 * buffer yields the raw keystream bytes, so these double as keystream checks.
 */
const GOLDEN: Record<string, { key: bigint; bytes: number[] }> = {
  key12345_32: {
    key: 12345n,
    bytes: [
      232, 114, 24, 33, 118, 133, 34, 233, 137, 159, 180, 165, 229, 83, 155,
      149, 166, 24, 74, 254, 198, 68, 191, 83, 129, 150, 163, 139, 155, 166, 74,
      231,
    ],
  },
  key0_16: {
    key: 0n,
    bytes: [157, 57, 36, 126, 51, 119, 109, 65, 42, 247, 57, 128, 5, 170, 165, 199],
  },
  keyMax_24: {
    key: 18446744073709551615n,
    bytes: [
      124, 56, 253, 58, 46, 124, 216, 173, 100, 8, 24, 146, 200, 36, 48, 243,
      168, 236, 168, 18, 42, 111, 70, 7,
    ],
  },
  key1_40: {
    key: 1n,
    bytes: [
      225, 158, 213, 210, 202, 152, 175, 45, 167, 161, 141, 7, 202, 179, 155,
      82, 160, 171, 2, 50, 209, 128, 175, 20, 114, 179, 109, 207, 26, 245, 228,
      111, 238, 193, 105, 56, 180, 249, 152, 191,
    ],
  },
};

/** Produce raw keystream by decrypting an all-zero buffer (key != 0 path). */
function keystreamViaIsaac(key: bigint, n: number): number[] {
  const inst = new Isaac64(key);
  const out: number[] = [];
  while (out.length < n) {
    let v = inst.next();
    const block: number[] = [];
    for (let i = 7; i >= 0; i--) {
      block[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    out.push(...block);
  }
  return out.slice(0, n);
}

describe("wechat ISAAC64 decryption", () => {
  it("keystream matches Go golden vectors", () => {
    for (const [name, { key, bytes }] of Object.entries(GOLDEN)) {
      expect(keystreamViaIsaac(key, bytes.length), name).toEqual(bytes);
    }
  });

  it("decryptPrefix only touches the prefix", () => {
    const data = new Uint8Array(40); // all zero
    decryptPrefix(data, 12345n, 16);
    expect(Array.from(data.slice(0, 16))).toEqual(GOLDEN.key12345_32.bytes.slice(0, 16));
    expect(Array.from(data.slice(16))).toEqual(new Array(24).fill(0));
  });

  it("decryptPrefix is an involution over the encrypted prefix", () => {
    const original = new Uint8Array(1000).map((_, i) => i % 256);
    const buf = original.slice();
    decryptPrefix(buf, 0xdeadbeefcafe1234n, 256);
    expect(Array.from(buf)).not.toEqual(Array.from(original));
    decryptPrefix(buf, 0xdeadbeefcafe1234n, 256);
    expect(Array.from(buf)).toEqual(Array.from(original));
  });

  it("decryptPrefix handles buffers shorter than the limit", () => {
    const data = new Uint8Array(10);
    decryptPrefix(data, 1n, ENC_LIMIT);
    expect(Array.from(data)).toEqual(GOLDEN.key1_40.bytes.slice(0, 10));
  });

  it("decryptPrefix is a no-op when key is 0 (unencrypted video)", () => {
    const data = new Uint8Array(20).fill(0x11);
    decryptPrefix(data, 0n, ENC_LIMIT);
    expect(Array.from(data)).toEqual(new Array(20).fill(0x11));
  });

  it("ENC_LIMIT is 128 KiB", () => {
    expect(ENC_LIMIT).toBe(131072);
  });
});
