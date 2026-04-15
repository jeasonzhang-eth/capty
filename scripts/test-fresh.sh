#!/bin/bash
# Temporarily swap out config.json to simulate a fresh install.
# Usage:
#   ./scripts/test-fresh.sh          # swap config and start dev
#   ./scripts/test-fresh.sh restore  # restore original config

CONFIG_DIR="$HOME/Library/Application Support/capty"
CONFIG="$CONFIG_DIR/config.json"
BACKUP="$CONFIG_DIR/config.json.bak"

case "${1:-}" in
  restore)
    if [ -f "$BACKUP" ]; then
      mv "$BACKUP" "$CONFIG"
      echo "Config restored."
    else
      echo "No backup found."
    fi
    ;;
  *)
    if [ -f "$CONFIG" ]; then
      mv "$CONFIG" "$BACKUP"
      echo "Config backed up. App will start fresh."
    fi
    echo "Starting dev server... (Ctrl+C to stop)"
    echo "Run './scripts/test-fresh.sh restore' to restore config."
    cd "$(dirname "$0")/.." && npm run dev
    # Auto-restore when dev server exits
    if [ -f "$BACKUP" ]; then
      mv "$BACKUP" "$CONFIG"
      echo "Config auto-restored."
    fi
    ;;
esac
