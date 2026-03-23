"""Entry point for the Capty ASR sidecar server."""

from __future__ import annotations

import argparse
import logging

import uvicorn

from capty_sidecar.server import create_app


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
        required=True,
        help="Directory containing downloaded ASR models",
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

    app = create_app(models_dir=args.models_dir)
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
