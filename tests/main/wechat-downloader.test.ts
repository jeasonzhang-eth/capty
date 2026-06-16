import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { downloadAndDecrypt, type BinaryFetchLike } from "../../src/main/wechat/downloader";
import { decryptPrefix } from "../../src/main/wechat/isaac";

describe("downloadAndDecrypt", () => {
  let dir: string;
  const dest = () => path.join(dir, "out.mp4");

  function setup() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "capty-wx-"));
  }
  function teardown() {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  it("writes file as-is when decodeKey is 0 (unencrypted)", async () => {
    setup();
    try {
      const payload = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]); // ftyp
      const fetchFn: BinaryFetchLike = async () => ({
        status: 200,
        arrayBuffer: async () => payload.buffer,
      });
      const n = await downloadAndDecrypt("https://v/x", 0n, dest(), fetchFn);
      expect(n).toBe(payload.length);
      expect(Array.from(fs.readFileSync(dest()))).toEqual(Array.from(payload));
    } finally {
      teardown();
    }
  });

  it("decrypts the prefix when decodeKey is set (round-trips to plaintext)", async () => {
    setup();
    try {
      const key = 12345n;
      // server bytes = encrypted(plaintext). Simulate by encrypting a known plaintext.
      const plaintext = new Uint8Array(64).map((_, i) => (i * 7) % 256);
      const encrypted = plaintext.slice();
      decryptPrefix(encrypted, key, 64); // XOR cipher: encrypt == decrypt
      const fetchFn: BinaryFetchLike = async () => ({
        status: 200,
        arrayBuffer: async () => encrypted.buffer,
      });
      await downloadAndDecrypt("https://v/x", key, dest(), fetchFn);
      expect(Array.from(fs.readFileSync(dest()))).toEqual(Array.from(plaintext));
    } finally {
      teardown();
    }
  });

  it("throws on non-2xx", async () => {
    setup();
    try {
      const fetchFn: BinaryFetchLike = async () => ({
        status: 403,
        arrayBuffer: async () => new ArrayBuffer(0),
      });
      await expect(downloadAndDecrypt("https://v/x", 0n, dest(), fetchFn)).rejects.toThrow(/403/);
    } finally {
      teardown();
    }
  });
});
