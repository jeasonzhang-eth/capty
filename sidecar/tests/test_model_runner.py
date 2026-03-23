"""Tests for ModelRunner with mocked transformers model/processor."""

from __future__ import annotations

import asyncio
import struct
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from capty_sidecar.model_runner import ModelRunner


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_pcm_bytes(samples: int = 16000, value: float = 0.1) -> bytes:
    """Create raw PCM 16-bit mono audio bytes."""
    int16_value = int(value * 32767)
    return struct.pack(f"<{samples}h", *([int16_value] * samples))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestModelRunnerLifecycle:
    """Test load / is_loaded / unload cycle."""

    def test_initial_state(self):
        runner = ModelRunner()
        assert runner.is_loaded() is False

    @patch("capty_sidecar.model_runner.AutoModelForCausalLM")
    @patch("capty_sidecar.model_runner.AutoProcessor")
    def test_load_model(self, mock_processor_cls, mock_model_cls, tmp_path):
        model_dir = tmp_path / "qwen3-asr-0.6b"
        model_dir.mkdir()

        mock_model_cls.from_pretrained.return_value = MagicMock()
        mock_processor_cls.from_pretrained.return_value = MagicMock()

        runner = ModelRunner()
        runner.load("qwen3-asr-0.6b", models_dir=tmp_path)

        assert runner.is_loaded() is True
        mock_model_cls.from_pretrained.assert_called_once()
        mock_processor_cls.from_pretrained.assert_called_once()

    @patch("capty_sidecar.model_runner.AutoModelForCausalLM")
    @patch("capty_sidecar.model_runner.AutoProcessor")
    def test_unload_model(self, mock_processor_cls, mock_model_cls, tmp_path):
        model_dir = tmp_path / "qwen3-asr-0.6b"
        model_dir.mkdir()

        mock_model_cls.from_pretrained.return_value = MagicMock()
        mock_processor_cls.from_pretrained.return_value = MagicMock()

        runner = ModelRunner()
        runner.load("qwen3-asr-0.6b", models_dir=tmp_path)
        runner.unload()

        assert runner.is_loaded() is False

    def test_load_nonexistent_model_raises(self, tmp_path):
        runner = ModelRunner()
        with pytest.raises(FileNotFoundError):
            runner.load("nonexistent", models_dir=tmp_path)


class TestTranscribeStream:
    """Test transcribe_stream async generator with mocked model."""

    @pytest.mark.asyncio
    async def test_transcribe_stream_yields_partial_and_final(self, tmp_path):
        """transcribe_stream should yield partial messages then a final message."""
        model_dir = tmp_path / "test-model"
        model_dir.mkdir()

        runner = ModelRunner()

        # Set up mocks directly on the runner
        mock_model = MagicMock()
        mock_processor = MagicMock()

        # Mock processor to return input tensors
        mock_inputs = MagicMock()
        mock_inputs.input_features = MagicMock()
        mock_processor.return_value = mock_inputs
        mock_processor.feature_extractor = MagicMock()
        mock_processor.feature_extractor.sampling_rate = 16000

        # Mock processor.decode to return text
        mock_processor.decode.return_value = "hello world"

        runner._model = mock_model
        runner._processor = mock_processor
        runner._model_id = "test-model"

        # Simulate model.generate producing token IDs
        # The TextIteratorStreamer will be replaced by our mock streaming logic
        generated_tokens = ["hello", " world"]

        async def mock_generate_stream(audio_pcm, sample_rate):
            for token in generated_tokens:
                yield {"type": "partial", "text": token}
            yield {"type": "final", "text": "hello world"}

        # Patch the internal stream method
        runner._run_inference = mock_generate_stream

        pcm_data = _make_pcm_bytes(16000)
        messages = []
        async for msg in runner.transcribe_stream(pcm_data, sample_rate=16000):
            messages.append(msg)

        # Must have at least one partial and exactly one final
        partials = [m for m in messages if m["type"] == "partial"]
        finals = [m for m in messages if m["type"] == "final"]
        assert len(partials) >= 1
        assert len(finals) == 1
        assert finals[0]["text"] == "hello world"

    @pytest.mark.asyncio
    async def test_transcribe_stream_not_loaded_raises(self):
        """transcribe_stream should raise if no model is loaded."""
        runner = ModelRunner()
        pcm_data = _make_pcm_bytes(16000)
        with pytest.raises(RuntimeError, match="No model loaded"):
            async for _ in runner.transcribe_stream(pcm_data):
                pass
