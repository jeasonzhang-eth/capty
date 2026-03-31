"""Tests for EnginePool (without real MLX models)."""

from unittest.mock import AsyncMock, patch

import pytest

from capty_sidecar.engine import ASREngine, TTSEngine
from capty_sidecar.engine_pool import EnginePool


def test_pool_has_two_engines():
    pool = EnginePool()
    assert isinstance(pool.asr, ASREngine)
    assert isinstance(pool.tts, TTSEngine)


def test_pool_status_empty():
    pool = EnginePool()
    status = pool.status()
    assert status["asr"]["loaded"] is False
    assert status["asr"]["model"] is None
    assert status["tts"]["loaded"] is False
    assert status["tts"]["model"] is None


def test_get_engine_unknown_type():
    pool = EnginePool()
    with pytest.raises(KeyError, match="Unknown engine type"):
        pool.get_engine("llm")


@pytest.mark.asyncio
async def test_load_engine_calls_run_on_mlx():
    pool = EnginePool()
    with patch("capty_sidecar.engine_pool.run_on_mlx", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = None
        await pool.load_engine("asr", "test-model", "/tmp/test")
        mock_run.assert_called_once()


@pytest.mark.asyncio
async def test_unload_engine_calls_run_on_mlx():
    pool = EnginePool()
    with patch("capty_sidecar.engine_pool.run_on_mlx", new_callable=AsyncMock) as mock_run:
        mock_run.return_value = None
        await pool.unload_engine("tts")
        mock_run.assert_called_once()
