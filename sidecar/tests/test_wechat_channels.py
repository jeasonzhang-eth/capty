"""Tests for 视频号 ISAAC64 decryption, cross-checked against the Go reference.

Golden vectors were produced by running wx_channels_download/pkg/decrypt
``DecryptData`` over all-zero buffers (so the output IS the keystream).
"""

from __future__ import annotations

from capty_sidecar.wechat_channels import (
    ENC_LIMIT,
    decrypt_data,
    decrypt_prefix,
)

# keystream(key, n) == decrypt_data(zeros(n), n, key)  — golden from Go
GOLDEN = {
    (12345, 32): [232, 114, 24, 33, 118, 133, 34, 233, 137, 159, 180, 165, 229, 83,
                  155, 149, 166, 24, 74, 254, 198, 68, 191, 83, 129, 150, 163, 139,
                  155, 166, 74, 231],
    (0, 16): [157, 57, 36, 126, 51, 119, 109, 65, 42, 247, 57, 128, 5, 170, 165, 199],
    (18446744073709551615, 24): [124, 56, 253, 58, 46, 124, 216, 173, 100, 8, 24, 146,
                                 200, 36, 48, 243, 168, 236, 168, 18, 42, 111, 70, 7],
    (1, 40): [225, 158, 213, 210, 202, 152, 175, 45, 167, 161, 141, 7, 202, 179, 155,
              82, 160, 171, 2, 50, 209, 128, 175, 20, 114, 179, 109, 207, 26, 245, 228,
              111, 238, 193, 105, 56, 180, 249, 152, 191],
}


def test_keystream_matches_go_golden():
    for (key, n), expected in GOLDEN.items():
        buf = bytearray(n)
        decrypt_data(buf, n, key)
        assert list(buf) == expected, f"keystream mismatch for key={key} n={n}"


def test_decrypt_is_involution():
    """XOR cipher: decrypting twice returns the original bytes."""
    key = 0xDEADBEEFCAFE1234
    original = bytes(range(256)) * 4  # 1024 bytes
    buf = bytearray(original)
    decrypt_data(buf, len(buf), key)
    assert bytes(buf) != original  # actually transformed
    decrypt_data(buf, len(buf), key)
    assert bytes(buf) == original


def test_decrypt_data_noop_when_shorter_than_enc_len():
    buf = bytearray(b"\x01\x02\x03")
    decrypt_data(buf, 8, 12345)  # enc_len > len -> no-op (matches Go)
    assert bytes(buf) == b"\x01\x02\x03"


def test_decrypt_prefix_only_touches_prefix():
    key = 12345
    enc_limit = 16
    data = bytearray(b"\x00" * 40)
    decrypt_prefix(data, key, enc_limit=enc_limit)
    # first 16 bytes == keystream(12345)[:16]; rest untouched (still zero)
    assert list(data[:16]) == GOLDEN[(12345, 32)][:16]
    assert all(b == 0 for b in data[16:])


def test_decrypt_prefix_handles_buffer_shorter_than_limit():
    key = 1
    data = bytearray(b"\x00" * 10)
    decrypt_prefix(data, key, enc_limit=ENC_LIMIT)
    assert list(data) == GOLDEN[(1, 40)][:10]


def test_decrypt_prefix_key_zero_is_noop():
    data = bytearray(b"\x11" * 20)
    decrypt_prefix(data, 0, enc_limit=ENC_LIMIT)
    assert bytes(data) == b"\x11" * 20


def test_enc_limit_constant():
    assert ENC_LIMIT == 131072
