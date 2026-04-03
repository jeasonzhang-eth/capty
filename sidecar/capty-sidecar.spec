# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for capty-sidecar (onedir, macOS arm64).

Produces: dist/capty-sidecar/capty-sidecar
"""

from PyInstaller.utils.hooks import collect_all, collect_submodules

# Packages that need full collection (data files, dynamic libs, etc.)
_collect_packages = [
    "mlx",
    "mlx_audio",
    "numpy",
    "transformers",
    "tokenizers",
    "safetensors",
    "huggingface_hub",
    "sentencepiece",
    "librosa",
    "soundfile",
    "soxr",
    "audioread",
    "lazy_loader",
    "pydantic",
    "pydantic_core",
    "uvicorn",
    "fastapi",
    "starlette",
    "anyio",
    "sniffio",
    "httptools",
    "uvloop",
    "websockets",
    "click",
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
    excludes=["tkinter", "matplotlib", "PIL", "IPython", "jupyter"],
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
