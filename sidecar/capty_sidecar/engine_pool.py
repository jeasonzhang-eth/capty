"""EnginePool: manages ASR and TTS engine instances.

Both engines can coexist in memory simultaneously.  Load/unload operations
are serialized via an asyncio.Lock to prevent concurrent model loading
that could exhaust memory.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from capty_sidecar.engine import ASREngine, BaseEngine, TTSEngine
from capty_sidecar.mlx_executor import run_on_mlx

logger = logging.getLogger(__name__)


class EnginePool:
    """Manages fixed ASR + TTS engine slots."""

    def __init__(self) -> None:
        self._engines: dict[str, BaseEngine] = {
            "asr": ASREngine(),
            "tts": TTSEngine(),
        }
        self._lock = asyncio.Lock()

    def get_engine(self, engine_type: str) -> BaseEngine:
        """Get engine by type. Raises KeyError if unknown type."""
        if engine_type not in self._engines:
            raise KeyError(f"Unknown engine type: {engine_type}")
        return self._engines[engine_type]

    @property
    def asr(self) -> ASREngine:
        return self._engines["asr"]  # type: ignore[return-value]

    @property
    def tts(self) -> TTSEngine:
        return self._engines["tts"]  # type: ignore[return-value]

    async def load_engine(
        self,
        engine_type: str,
        model_id: str,
        model_path: Path,
    ) -> None:
        """Load a model into the specified engine slot.

        Serialized via lock to prevent concurrent loads.
        The engine's load_sync handles unloading any previous model.
        """
        engine = self.get_engine(engine_type)
        async with self._lock:
            await run_on_mlx(lambda: engine.load_sync(model_id, model_path))
        logger.info("Engine '%s' loaded model '%s'", engine_type, model_id)

    async def unload_engine(self, engine_type: str) -> None:
        """Unload the model from the specified engine slot."""
        engine = self.get_engine(engine_type)
        async with self._lock:
            await run_on_mlx(engine.unload_sync)
        logger.info("Engine '%s' unloaded", engine_type)

    def status(self) -> dict:
        """Return status of all engines."""
        return {
            etype: {
                "loaded": engine.is_loaded(),
                "model": engine.model_id,
            }
            for etype, engine in self._engines.items()
        }
