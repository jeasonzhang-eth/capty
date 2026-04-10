<p align="center">
  <img src="docs/assets/banner.png" alt="Capty" width="600" />
</p>

<h1 align="center">Capty</h1>

<p align="center">
  Real-time speech-to-text desktop app for macOS · Fully local · Qwen3-ASR / Whisper
</p>

<p align="center">
  <a href="https://github.com/jeasonzhang-eth/capty/releases/latest">
    <img src="https://img.shields.io/github/v/release/jeasonzhang-eth/capty?style=flat-square&color=f5a623" alt="Latest Release" />
  </a>
  <a href="https://github.com/jeasonzhang-eth/capty/releases/latest">
    <img src="https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-black?style=flat-square&logo=apple" alt="Platform" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/jeasonzhang-eth/capty?style=flat-square" alt="License" />
  </a>
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a>
</p>

<br />

> **Privacy first**: your audio never leaves your machine — ASR runs entirely on the local Apple GPU.

---

## Highlights

### Real-time transcription
Captures microphone audio, detects speech pauses with VAD, and streams to a local ASR model with minimal latency.

### Local model market
Download Qwen3-ASR (0.6B / 1.7B) or Whisper Large V3 Turbo with one click. HuggingFace mirror support for users in China.

### Audio import & download
- Import local audio files (WAV / MP3 / M4A / FLAC / …) for transcription
- Download audio from YouTube, Bilibili, Xiaoyuzhou, and 1800+ other sites

### LLM analysis
Connect to OpenAI / DeepSeek / OpenRouter and auto-generate summaries, follow-up questions, and context — fully customizable.

### Translation
Translate transcripts segment-by-segment with 3-way concurrency. Results are persisted and survive app restarts.

### Playback with waveform
Play back any recorded session with a wavesurfer.js waveform player. Features include pause/resume, click-to-seek, ±10s skip, variable speed (0.5×–2×), and lyrics-style subtitle sync that auto-scrolls and highlights the current segment.

### Session management
Organize sessions into categories (Downloads / Personal / Meeting / Phone / custom). Drag-and-drop to reorder or move between categories. Right-click to rename inline, regenerate subtitles, or edit recorded time. AI auto-rename generates a title from the transcript with one click.

### TTS read-aloud
Have any summary card read aloud using a local or external TTS provider. Streaming playback starts as soon as the first audio chunk arrives — no waiting for the full generation.

### Export
Export transcripts as TXT, SRT, or Markdown.

---

## Screenshots

<!-- TODO: add screenshots -->
> Screenshots coming soon. Download and try it now!

---

## Download

**Requirements: macOS · Apple Silicon (M1 or later)**

1. Go to the [Releases page](https://github.com/jeasonzhang-eth/capty/releases/latest) and download the latest `Capty-x.x.x-arm64.dmg`
2. Open the DMG and drag Capty to Applications
3. On first launch, the setup wizard will guide you through installing dependencies (Homebrew / ffmpeg / yt-dlp)

> If macOS shows "Cannot verify developer", go to **System Settings → Privacy & Security** and click "Open Anyway".

---

## Development

```bash
# Clone
git clone https://github.com/jeasonzhang-eth/capty.git
cd capty

# Install Node dependencies
npm install

# Set up Python sidecar
cd sidecar && python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
cd ..

# Start dev mode
npm run dev
```

### Build DMG

```bash
npm run dist:all   # builds sidecar first, then packages DMG
```

---

## Tech stack

| Layer | Technology |
|---|---|
| Desktop | Electron 33 + electron-vite |
| Frontend | React 18 · TypeScript · Zustand |
| Database | SQLite (better-sqlite3) |
| ML inference | Python FastAPI + mlx-audio · Apple GPU |
| Audio | Web Audio API · VAD · ffmpeg |

---

## Contributing

Issues and pull requests are welcome!

- Branch off `main` with a `feat/xxx` or `fix/xxx` branch
- Open a PR to `main` — CI runs build and tests automatically

---

## License

[MIT](LICENSE)
