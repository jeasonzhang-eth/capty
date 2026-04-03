#!/bin/bash
# Build capty-sidecar into a standalone binary (onedir) using PyInstaller.
# Output: dist/capty-sidecar/capty-sidecar

set -euo pipefail
cd "$(dirname "$0")"

echo "==> Activating venv..."
source .venv/bin/activate

echo "==> Installing PyInstaller..."
pip install pyinstaller

echo "==> Building capty-sidecar..."
pyinstaller capty-sidecar.spec --clean --noconfirm

# Verify output
BINARY="dist/capty-sidecar/capty-sidecar"
if [ -f "$BINARY" ]; then
    SIZE=$(du -sh "$BINARY" | cut -f1)
    echo "==> Build complete: $BINARY ($SIZE)"
    echo "==> Test with: $BINARY --port 8766"
else
    echo "ERROR: Binary not found at $BINARY"
    exit 1
fi
