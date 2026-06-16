"""WeChat Channels (视频号) video decryption.

Port of the ISAAC64 stream cipher used by 视频号 to encrypt the first
``ENC_LIMIT`` bytes of a video file. The per-video key (``decodeKey``, a
uint64) is returned by the feed API; the rest of the file is plaintext.

Reference (Go): wx_channels_download/pkg/decrypt (originally from
https://github.com/Hanson/WechatSphDecrypt).
"""

from __future__ import annotations

MASK64 = 0xFFFFFFFFFFFFFFFF

# 视频号 encrypts only the first 128 KiB of the stream.
ENC_LIMIT = 131072


def _mix(a: int, b: int, c: int, d: int, e: int, f: int, g: int, h: int):
    """ISAAC64 mixing step (translated statement-for-statement from Go)."""
    a = (a - e) & MASK64
    f = (f ^ (h >> 9)) & MASK64
    h = (h + a) & MASK64
    b = (b - f) & MASK64
    g = (g ^ ((a << 9) & MASK64)) & MASK64
    a = (a + b) & MASK64
    c = (c - g) & MASK64
    h = (h ^ (b >> 23)) & MASK64
    b = (b + c) & MASK64
    d = (d - h) & MASK64
    a = (a ^ ((c << 15) & MASK64)) & MASK64
    c = (c + d) & MASK64
    e = (e - a) & MASK64
    b = (b ^ (d >> 14)) & MASK64
    d = (d + e) & MASK64
    f = (f - b) & MASK64
    c = (c ^ ((e << 20) & MASK64)) & MASK64
    e = (e + f) & MASK64
    g = (g - c) & MASK64
    d = (d ^ (f >> 17)) & MASK64
    f = (f + g) & MASK64
    h = (h - d) & MASK64
    e = (e ^ ((g << 14) & MASK64)) & MASK64
    g = (g + h) & MASK64
    return a, b, c, d, e, f, g, h


class Isaac64:
    """ISAAC64 CSPRNG seeded with a single uint64 key (视频号 convention)."""

    def __init__(self, enc_key: int) -> None:
        self.rand_cnt = 255
        self.seed = [0] * 256
        self.mm = [0] * 256
        self.aa = 0
        self.bb = 0
        self.cc = 0
        self._init(enc_key & MASK64)

    def _init(self, enc_key: int) -> None:
        golden = 0x9E3779B97F4A7C13
        a = b = c = d = e = f = g = h = golden

        self.seed[0] = enc_key
        # seed[1..255] already 0

        for _ in range(4):
            a, b, c, d, e, f, g, h = _mix(a, b, c, d, e, f, g, h)

        for i in range(0, 256, 8):
            a = (a + self.seed[i]) & MASK64
            b = (b + self.seed[i + 1]) & MASK64
            c = (c + self.seed[i + 2]) & MASK64
            d = (d + self.seed[i + 3]) & MASK64
            e = (e + self.seed[i + 4]) & MASK64
            f = (f + self.seed[i + 5]) & MASK64
            g = (g + self.seed[i + 6]) & MASK64
            h = (h + self.seed[i + 7]) & MASK64
            a, b, c, d, e, f, g, h = _mix(a, b, c, d, e, f, g, h)
            self.mm[i], self.mm[i + 1], self.mm[i + 2], self.mm[i + 3] = a, b, c, d
            self.mm[i + 4], self.mm[i + 5], self.mm[i + 6], self.mm[i + 7] = e, f, g, h

        for i in range(0, 256, 8):
            a = (a + self.mm[i]) & MASK64
            b = (b + self.mm[i + 1]) & MASK64
            c = (c + self.mm[i + 2]) & MASK64
            d = (d + self.mm[i + 3]) & MASK64
            e = (e + self.mm[i + 4]) & MASK64
            f = (f + self.mm[i + 5]) & MASK64
            g = (g + self.mm[i + 6]) & MASK64
            h = (h + self.mm[i + 7]) & MASK64
            a, b, c, d, e, f, g, h = _mix(a, b, c, d, e, f, g, h)
            self.mm[i], self.mm[i + 1], self.mm[i + 2], self.mm[i + 3] = a, b, c, d
            self.mm[i + 4], self.mm[i + 5], self.mm[i + 6], self.mm[i + 7] = e, f, g, h

        self._isaac()

    def _isaac(self) -> None:
        self.cc = (self.cc + 1) & MASK64
        self.bb = (self.bb + self.cc) & MASK64
        mm = self.mm
        aa = self.aa
        bb = self.bb
        for i in range(256):
            r = i % 4
            if r == 0:
                aa = (~(aa ^ ((aa << 21) & MASK64))) & MASK64
            elif r == 1:
                aa = (aa ^ (aa >> 5)) & MASK64
            elif r == 2:
                aa = (aa ^ ((aa << 12) & MASK64)) & MASK64
            else:
                aa = (aa ^ (aa >> 33)) & MASK64

            aa = (aa + mm[(i + 128) % 256]) & MASK64
            x = mm[i]
            y = (mm[(x >> 3) % 256] + aa + bb) & MASK64
            mm[i] = y
            bb = (mm[(y >> 11) % 256] + x) & MASK64
            self.seed[i] = bb
        self.aa = aa
        self.bb = bb

    def next(self) -> int:
        """Return the next 64-bit ISAAC output."""
        result = self.seed[self.rand_cnt]
        if self.rand_cnt == 0:
            self._isaac()
            self.rand_cnt = 255
        else:
            self.rand_cnt -= 1
        return result


def decrypt_data(data: bytearray, enc_len: int, key: int) -> None:
    """Decrypt the first ``enc_len`` bytes of ``data`` in place (XOR keystream).

    Mirrors Go ``DecryptData``: keystream blocks are the big-endian bytes of
    successive ISAAC outputs. No-op if ``data`` is shorter than ``enc_len``.
    """
    if len(data) == 0 or len(data) < enc_len:
        return
    inst = Isaac64(key)
    i = 0
    while i < enc_len:
        block = inst.next().to_bytes(8, "big")
        for j in range(8):
            idx = i + j
            if idx >= enc_len:
                return
            data[idx] ^= block[j]
        i += 8


def decrypt_prefix(data: bytearray, key: int, enc_limit: int = ENC_LIMIT) -> None:
    """Decrypt the encrypted prefix of a 视频号 video buffer in place.

    The encrypted region is ``min(len(data), enc_limit)`` bytes. Unlike
    :func:`decrypt_data` this never no-ops on short buffers — it decrypts
    whatever prefix exists, which is what a real (possibly truncated) stream
    needs.
    """
    n = min(len(data), enc_limit)
    if n == 0 or key == 0:
        return
    inst = Isaac64(key)
    i = 0
    while i < n:
        block = inst.next().to_bytes(8, "big")
        for j in range(8):
            idx = i + j
            if idx >= n:
                return
            data[idx] ^= block[j]
        i += 8
