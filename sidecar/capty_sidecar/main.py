"""Entry point for the Capty ASR sidecar server."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

import uvicorn

from capty_sidecar.server import create_app


def _detect_models_dir() -> str:
    """Auto-detect ASR models directory from Electron's config.json.

    Reads ``~/Library/Application Support/Capty/config.json`` to find the
    ``dataDir`` setting, then returns ``<dataDir>/models/asr``.
    Falls back to the Electron default data path if config is missing.
    """
    config_path = (
        Path.home() / "Library" / "Application Support" / "Capty" / "config.json"
    )
    default_data_dir = str(
        Path.home() / "Library" / "Application Support" / "Capty" / "data"
    )

    if config_path.is_file():
        try:
            with config_path.open("r", encoding="utf-8") as f:
                config = json.load(f)
            data_dir = config.get("dataDir") or default_data_dir
            return str(Path(data_dir) / "models" / "asr")
        except Exception:
            pass

    return str(Path(default_data_dir) / "models" / "asr")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Capty ASR Sidecar - real-time speech-to-text server"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8765,
        help="Port to listen on (default: 8765)",
    )
    parser.add_argument(
        "--models-dir",
        type=str,
        default=None,
        help="Directory containing downloaded ASR models "
        "(auto-detected from Electron config if omitted)",
    )
    parser.add_argument(
        "--log-level",
        type=str,
        default="info",
        choices=["debug", "info", "warning", "error"],
        help="Logging level (default: info)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    models_dir = args.models_dir or os.environ.get("CAPTY_MODELS_DIR") or _detect_models_dir()
    logging.getLogger(__name__).info("Using models directory: %s", models_dir)

    app = create_app(models_dir=models_dir)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
