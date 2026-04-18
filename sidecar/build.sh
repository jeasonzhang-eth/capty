#!/bin/bash
# Build capty-sidecar into a standalone binary (onedir) using PyInstaller.
# Managed via uv — no manual venv activation needed.
# Output: dist/capty-sidecar/capty-sidecar

set -euo pipefail
cd "$(dirname "$0")"

echo "==> Syncing dev dependencies with uv..."
uv sync --extra dev

echo "==> Building capty-sidecar..."
uv run pyinstaller capty-sidecar.spec --clean --noconfirm

BINARY="dist/capty-sidecar/capty-sidecar"
if [ -f "$BINARY" ]; then
    SIZE=$(du -sh "$BINARY" | cut -f1)
    echo "==> Build complete: $BINARY ($SIZE)"
    echo "==> Test with: $BINARY --port 8766"
else
    echo "ERROR: Binary not found at $BINARY"
    exit 1
fi
