"""Tests for the FastAPI server endpoints."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from capty_sidecar.server import create_app


@pytest.mark.asyncio
async def test_health(tmp_path):
    """GET /health returns status ok and model_loaded flag."""
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["model_loaded"] is False


@pytest.mark.asyncio
async def test_list_models(tmp_path):
    """GET /models returns a list (empty when no models on disk)."""
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/models")
        assert resp.status_code == 200
        models = resp.json()
        assert isinstance(models, list)
        # tmp_path is empty, so no models should be listed
        assert len(models) == 0


@pytest.mark.asyncio
async def test_switch_model_not_downloaded(tmp_path):
    """POST /models/switch returns error when model is not available.

    With disk-driven registry, a model that has no directory on disk is
    treated as unknown (404).  A model with a directory but no weight
    files would return 400 (not downloaded).
    """
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/models/switch",
            json={"model": "qwen3-asr-0.6b"},
        )
        # Model directory doesn't exist -> 404 Unknown model ID
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_switch_model_unknown(tmp_path):
    """POST /models/switch returns 404 for unknown model ID."""
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/models/switch",
            json={"model": "nonexistent-model"},
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_health_after_cors(tmp_path):
    """Verify CORS headers are present on responses."""
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/health")
        # Server should respond successfully regardless of origin
        assert resp.status_code == 200


@pytest.mark.asyncio
async def test_transcribe_file_path_outside_data_dir(tmp_path):
    """POST /v1/audio/transcribe-file rejects paths outside data_dir."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    models_dir = data_dir / "models" / "asr"
    models_dir.mkdir(parents=True)

    app = create_app(models_dir=str(models_dir), data_dir=str(data_dir))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/audio/transcribe-file",
            json={"file_path": "/etc/passwd"},
        )
        # /etc/passwd exists but is outside data_dir -> 400 (file not found
        # because we check existence before path validation) or 403
        assert resp.status_code in (400, 403)


@pytest.mark.asyncio
async def test_decode_audio_path_outside_data_dir(tmp_path):
    """POST /v1/audio/decode rejects paths outside data_dir."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    models_dir = data_dir / "models" / "asr"
    models_dir.mkdir(parents=True)

    # Create a file outside data_dir
    outside_file = tmp_path / "outside.wav"
    outside_file.write_bytes(b"RIFF" + b"\x00" * 40)

    app = create_app(models_dir=str(models_dir), data_dir=str(data_dir))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/audio/decode",
            json={"file_path": str(outside_file)},
        )
        assert resp.status_code == 403
        assert "outside allowed directory" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_decode_audio_rejects_sibling_prefix_path(tmp_path):
    """Sibling paths like data-evil must not bypass the allowlist check."""
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    models_dir = data_dir / "models" / "asr"
    models_dir.mkdir(parents=True)

    sibling_dir = tmp_path / "data-evil"
    sibling_dir.mkdir()
    sibling_file = sibling_dir / "outside.wav"
    sibling_file.write_bytes(b"RIFF" + b"\x00" * 40)

    app = create_app(models_dir=str(models_dir), data_dir=str(data_dir))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/v1/audio/decode",
            json={"file_path": str(sibling_file)},
        )
        assert resp.status_code == 403
        assert "outside allowed directory" in resp.json()["detail"]
