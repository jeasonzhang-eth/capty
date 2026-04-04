"""Entry point for the Capty ASR sidecar server."""

from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path

import uvicorn

from capty_sidecar.server import create_app


def _detect_data_dir() -> str:
    """Auto-detect the user data directory from Electron's config.json.

    Reads ``~/Library/Application Support/Capty/config.json`` to find the
    ``dataDir`` setting.  Falls back to the Electron default data path if
    the config is missing or unreadable.
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
            return config.get("dataDir") or default_data_dir
        except Exception:
            pass

    return default_data_dir


def _suppress_noisy_warnings() -> None:
    """Suppress known harmless warnings from transformers tokenizer loading."""
    import warnings

    # Qwen3-TTS tokenizer reuses Mistral format with a known regex issue
    warnings.filterwarnings("ignore", message=".*incorrect regex pattern.*")
    # AutoTokenizer model_type mismatch for custom model architectures
    warnings.filterwarnings(
        "ignore", message=".*to instantiate a model of type.*"
    )


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

    _suppress_noisy_warnings()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    log = logging.getLogger(__name__)

    # Resolve models directory: CLI arg > env var > auto-detect from Electron config
    if args.models_dir:
        models_dir = args.models_dir
        data_dir = str(Path(models_dir).resolve().parent.parent)
    elif os.environ.get("CAPTY_MODELS_DIR"):
        models_dir = os.environ["CAPTY_MODELS_DIR"]
        data_dir = str(Path(models_dir).resolve().parent.parent)
    else:
        data_dir = _detect_data_dir()
        models_dir = str(Path(data_dir) / "models" / "asr")

    log.info("Using models directory: %s", models_dir)
    log.info("Using data directory: %s", data_dir)

    app = create_app(models_dir=models_dir, data_dir=data_dir)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
