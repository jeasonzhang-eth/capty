# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for capty-sidecar (onedir, macOS arm64).

Produces: dist/capty-sidecar/capty-sidecar

Only collects packages that capty_sidecar actually imports at runtime.
mlx-audio pulls in many optional/transitive deps (spacy, phonemizer,
pillow, torch stubs, etc.) — we exclude everything not needed.
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

# ── Only packages that capty_sidecar code actually uses at runtime ──
_collect_packages = [
    # Core ML
    "mlx",
    "mlx_audio",
    "mlx_lm",
    "numpy",
    # HuggingFace (model loading)
    "transformers",
    "tokenizers",
    "safetensors",
    "huggingface_hub",
    "sentencepiece",
    # Audio processing
    "librosa",
    "soundfile",
    "soxr",
    "audioread",
    "numba",
    "scipy",
    # Web server
    "fastapi",
    "starlette",
    "pydantic",
    "pydantic_core",
    "uvicorn",
    "anyio",
    "httptools",
    "uvloop",
    "h11",
    # TTS text processing (only what supported models actually use)
    # NOTE: misaki, spacy, thinc, jieba, pypinyin, cn2an, num2words are
    # only needed by Kokoro which is excluded — do NOT add them back.
    # STT
    "tiktoken",
    "mistral_common",
]

datas = []
binaries = []
hiddenimports = [
    "capty_sidecar",
    "capty_sidecar.main",
    "capty_sidecar.server",
    "capty_sidecar.engine",
    "capty_sidecar.engine_pool",
    "capty_sidecar.mlx_executor",
    "capty_sidecar.model_registry",
]

for pkg in _collect_packages:
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception:
        pass

# Collect submodules that collect_all may miss
for mod in ["mlx.core", "mlx.nn", "mlx_audio.stt", "mlx_audio.tts"]:
    try:
        hiddenimports += collect_submodules(mod)
    except Exception:
        pass

a = Analysis(
    ["capty_sidecar/main.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # GUI / display — not needed for headless server
        "tkinter", "matplotlib", "PIL", "pillow", "IPython", "jupyter",
        # PyTorch — we use MLX, not torch
        "torch", "torchvision", "torchaudio",
        # Kokoro TTS + its text-processing deps (only Kokoro uses these)
        "mlx_audio.tts.models.kokoro",
        "espeakng_loader", "phonemizer",
        "misaki",
        "spacy", "thinc",
        "jieba", "pypinyin", "cn2an", "num2words",
        # Dev / test (including spacy tests pulled transitively)
        "pytest", "pytest_asyncio",
        "spacy.tests",
        # Unused heavy packages
        "sounddevice", "miniaudio",
        "websockets",
    ],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="capty-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="capty-sidecar",
)
