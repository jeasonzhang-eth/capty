<p align="center">
  <img src="docs/assets/banner.png" alt="Capty" width="600" />
</p>

<h1 align="center">Capty</h1>

<p align="center">
  macOS 本地实时语音转文字桌面应用 · 数据完全本地 · 支持 Qwen3-ASR / Whisper
</p>

<p align="center">
  <a href="https://github.com/jeasonzhang-eth/capty/releases/latest">
    <img src="https://img.shields.io/github/v/release/jeasonzhang-eth/capty?style=flat-square&color=f5a623" alt="最新版本" />
  </a>
  <a href="https://github.com/jeasonzhang-eth/capty/releases/latest">
    <img src="https://img.shields.io/badge/platform-macOS%20Apple%20Silicon-black?style=flat-square&logo=apple" alt="平台" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/github/license/jeasonzhang-eth/capty?style=flat-square" alt="License" />
  </a>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

<br />

> **隐私优先**：语音数据不上传云端，ASR 推理完全在本地 Apple GPU 运行。

---

## 功能亮点

### 实时录音转写
麦克风实时采集，VAD 自动检测语音停顿，流式传输至本地 ASR 模型，毫秒级延迟。

### 本地模型市场
内置模型市场，一键下载 Qwen3-ASR（0.6B / 1.7B）或 Whisper Large V3 Turbo，支持 HuggingFace 镜像加速。

### 音频导入 & 下载
- 导入本地音频（WAV / MP3 / M4A / FLAC 等）自动转写
- 从 YouTube、Bilibili、小宇宙等 1800+ 网站下载音频并转写

### LLM 智能分析
转写完成后，接入 OpenAI / DeepSeek / OpenRouter 等，自动生成摘要、追问、背景推测，支持自定义分析维度。

### 字幕翻译
逐段翻译转写内容，支持中英互译，3 路并发，翻译结果持久化保存。

### 音频播放器
历史会话一键播放，wavesurfer.js 波形可视化，支持暂停/恢复、点击跳转、±10 秒快进快退、0.5×–2× 倍速，以及歌词式字幕同步（自动滚动高亮当前段落）。

### 会话管理
按分类（下载内容 / 个人录音 / 会议 / 电话 / 自定义）组织会话，支持拖拽排序和跨分类移动。右键可行内重命名、重新生成字幕、编辑录制时间。AI 一键重命名根据转写内容自动生成标题。

### TTS 语音朗读
任意摘要卡片支持 TTS 朗读（本地或外部 Provider），流式播放，首块音频到达即开始，无需等待全段生成。

### 导出
支持导出为 TXT / SRT / Markdown。

---

## 截图

<!-- TODO: 添加截图 -->
> 截图即将上传，可先下载体验。

---

## 下载安装

**系统要求：macOS · Apple Silicon（M1 及以上）**

1. 前往 [Releases 页面](https://github.com/jeasonzhang-eth/capty/releases/latest) 下载最新 `Capty-x.x.x-arm64.dmg`
2. 打开 DMG，将 Capty 拖入 Applications
3. 首次启动需要安装依赖（Homebrew / ffmpeg / yt-dlp），安装向导会自动引导

> 首次启动时，macOS 可能提示"无法验证开发者"，前往 **系统设置 → 隐私与安全性** 点击「仍要打开」即可。

---

## 本地运行 / 开发

```bash
# 克隆项目
git clone https://github.com/jeasonzhang-eth/capty.git
cd capty

# 安装依赖
npm install

# 创建 Python sidecar 环境
cd sidecar && python3.11 -m venv .venv && source .venv/bin/activate
pip install -e .
cd ..

# 启动开发模式
npm run dev
```

### 构建 DMG

```bash
npm run dist:all   # 先构建 sidecar，再打包 DMG
```

---

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 33 + electron-vite |
| 前端 | React 18 · TypeScript · Zustand |
| 数据库 | SQLite (better-sqlite3) |
| ML 推理 | Python FastAPI + mlx-audio · Apple GPU 加速 |
| 音频处理 | Web Audio API · VAD · ffmpeg |

---

## 参与贡献

欢迎提交 Issue 和 Pull Request！

- 从 `main` 创建 feature 分支（`feat/xxx` / `fix/xxx`）
- 提交 PR 到 `main`，CI 自动运行构建和测试

---

## License

[MIT](LICENSE)
