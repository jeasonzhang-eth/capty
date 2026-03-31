"""Global single-thread MLX executor.

MLX is NOT thread-safe (GitHub Issues #2133, #3078).  ALL MLX GPU
operations — model loading, inference, cache management — MUST run on
this single dedicated thread.
"""

from __future__ import annotations

import asyncio
import gc
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, TypeVar

import mlx.core as mx

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Single-thread executor dedicated to MLX operations.
_mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx")

# Limit the MLX metal buffer cache to 2 GB.
_MLX_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB
mx.set_cache_limit(_MLX_CACHE_LIMIT_BYTES)


def mlx_cleanup() -> None:
    """Release MLX cache and collect garbage.  Call from the MLX thread."""
    mx.clear_cache()
    gc.collect()


async def run_on_mlx(fn: Callable[[], T]) -> T:
    """Run *fn* on the MLX thread, cleanup after.

    This is the ONLY way to execute MLX operations safely.
    """
    loop = asyncio.get_running_loop()

    def _wrapped() -> T:
        try:
            return fn()
        finally:
            mlx_cleanup()

    return await loop.run_in_executor(_mlx_executor, _wrapped)
