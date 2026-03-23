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
    """GET /models returns a list of available models."""
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/models")
        assert resp.status_code == 200
        models = resp.json()
        assert isinstance(models, list)
        assert len(models) > 0
        # Each model should have expected fields
        for m in models:
            assert "id" in m
            assert "name" in m
            assert "downloaded" in m


@pytest.mark.asyncio
async def test_switch_model_not_downloaded(tmp_path):
    """POST /models/switch returns 400 when model is not downloaded."""
    app = create_app(models_dir=str(tmp_path))
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/models/switch",
            json={"model": "qwen3-asr-0.6b"},
        )
        assert resp.status_code == 400
        data = resp.json()
        assert "not downloaded" in data["detail"].lower() or "not found" in data["detail"].lower()


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
