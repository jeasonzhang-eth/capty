# Capty

macOS 桌面端实时语音转文字应用，基于 Electron + React + 本地 Whisper 模型。

## 功能

- **实时录音转写** — 捕获系统麦克风音频，全量音频流式传输至 ASR 模型，VAD 检测语音停顿后触发转录
- **会话管理** — 每次录音自动创建会话，历史列表展示所有会话，支持右键删除（含确认弹窗，同时清理音频文件）
- **重新生成字幕** — 对已完成的会话右键选择重新转录，从保存的音频文件重新生成字幕（含进度条），解决 sidecar 故障导致的字幕缺失
- **音频播放** — 历史会话支持一键播放，底部播放器提供暂停/恢复/进度拖拽/时间显示
- **设置页面** — 支持更改数据存储目录、查看/下载/切换 ASR 模型
- **麦克风记忆** — 自动记住上次选择的麦克风，重启后恢复；外接设备拔出时自动回退默认
- **模型市场** — 内置 Qwen3-ASR + 5 个 Whisper 变体（tiny/base/small/medium/large-v3-turbo），支持浏览、下载、切换、删除；远程模型列表自动刷新
- **导出** — 转写结果支持导出为 TXT / SRT / Markdown 格式
- **本地优先** — 所有数据（SQLite 数据库 + WAV 音频）存储在本地，无需联网

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript + Zustand |
| 数据库 | better-sqlite3 (SQLite) |
| ML 推理 | Python sidecar (FastAPI + qwen-asr + transformers/Whisper) |
| 音频处理 | Web Audio API + VAD (voice activity detection) |

## 项目结构

```
src/
├── main/                # Electron 主进程
│   ├── index.ts         # 入口，窗口创建
│   ├── ipc-handlers.ts  # IPC 通信处理
│   ├── database.ts      # SQLite 数据库操作
│   ├── audio-files.ts   # 音频文件读写/删除
│   ├── config.ts        # 应用配置管理
│   ├── export.ts        # TXT/SRT/Markdown 导出
│   ├── sidecar.ts       # Python sidecar 进程管理
│   └── model-downloader.ts
├── preload/             # contextBridge API
│   └── index.ts
├── renderer/            # React 前端
│   ├── App.tsx
│   ├── components/      # UI 组件
│   │   ├── ControlBar.tsx
│   │   ├── HistoryPanel.tsx
│   │   ├── TranscriptArea.tsx
│   │   ├── RecordingControls.tsx
│   │   ├── PlaybackBar.tsx
│   │   ├── SettingsModal.tsx
│   │   └── SetupWizard.tsx
│   ├── hooks/           # 自定义 Hooks
│   │   ├── useAudioCapture.ts
│   │   ├── useVAD.ts
│   │   ├── useTranscription.ts
│   │   ├── useSession.ts
│   │   └── useAudioPlayer.ts
│   └── stores/
│       └── appStore.ts  # Zustand 状态管理
└── sidecar/             # Python ML 后端
    ├── server.py        # FastAPI + WebSocket
    ├── model_registry.py
    └── model_runner.py
```

## 数据存储

Capty 的数据分布在两个目录：**配置目录**（Electron 默认 userData）和**数据目录**（用户可在 Settings 中自定义）。

### 配置目录

位置：`~/Library/Application Support/capty/`（macOS）

```
~/Library/Application Support/capty/
├── config.json          # 应用配置（见下方字段说明）
├── user-models.json     # 模型注册表（单一数据源）
├── Cache/               # ← Electron/Chromium 自动生成，以下均可忽略
├── Code Cache/
├── GPUCache/
├── Cookies
├── Local Storage/
├── Session Storage/
└── ...
```

其中 Electron/Chromium 自动生成的缓存文件（`Cache`、`GPUCache`、`Cookies`、`Local Storage` 等）由框架维护，无需关注。

#### config.json 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `dataDir` | `string \| null` | 用户数据目录路径，首次启动时通过 SetupWizard 设置 |
| `selectedAudioDeviceId` | `string \| null` | 上次选择的麦克风设备 ID，重启后自动恢复 |
| `selectedModelId` | `string \| null` | 当前激活的 ASR 模型 ID |
| `hfMirrorUrl` | `string \| null` | HuggingFace 镜像地址，`null` 时使用官方 `https://huggingface.co` |
| `modelRegistryUrl` | `string \| null` | 预留字段，远程模型注册表 URL |
| `windowBounds` | `{x, y, width, height} \| null` | 窗口位置和大小，移动/缩放后自动保存，重启时恢复 |

#### user-models.json

模型注册表，运行时的唯一数据源。首次启动时从内置 `resources/models.json` 复制生成，之后所有变更（下载、删除、搜索安装）都写入此文件。每条记录包含：

| 字段 | 说明 |
|------|------|
| `id` | 模型唯一标识，同时也是 `models/` 下的目录名 |
| `name` | 显示名称 |
| `type` | 模型类型：`qwen-asr` 或 `whisper` |
| `repo` | HuggingFace 仓库路径，如 `Qwen/Qwen3-ASR-0.6B` |
| `size_gb` | 模型大小（GB），首次启动时从磁盘计算回填 |
| `languages` | 支持的语言列表 |
| `description` | 模型描述 |

### 数据目录

位置：用户自定义（默认 `~/Library/Application Support/capty/data/`）

```
<dataDir>/
├── capty.db             # SQLite 数据库（会话 + 字幕段落）
├── audio/               # 录音音频文件
│   ├── 2026-03-24T04-42-25/   # 每个会话一个目录（以时间戳命名）
│   │   ├── full.wav            # 完整录音文件
│   │   ├── seg_000.wav         # 分段音频（按 VAD 切分）
│   │   ├── seg_001.wav
│   │   └── ...
│   └── ...
└── models/              # 已下载的 ASR 模型
    ├── qwen3-asr-0.6b/         # 内置模型（目录名 = model id）
    │   ├── config.json
    │   ├── model.safetensors
    │   ├── tokenizer.json
    │   └── ...
    ├── whisper-tiny/
    └── Qwen--Qwen3-ASR-1.7B/   # 从 HuggingFace 搜索下载的模型
```

| 路径 | 说明 |
|------|------|
| `capty.db` | SQLite 数据库，存储会话元数据（时间、时长、模型名）和转写字幕段落（时间戳 + 文本） |
| `audio/<session>/` | 每次录音的音频目录，`full.wav` 是完整录音，`seg_NNN.wav` 是 VAD 分段 |
| `models/<model-id>/` | 已下载的模型文件，目录名对应 `user-models.json` 中的 `id` 字段 |

## 开发

```bash
# 安装前端依赖
npm install

# 启动开发模式（Electron + Sidecar 一起启动）
npm run dev

# 仅构建
npm run build
```

### Sidecar（Python ASR 后端）

Sidecar 是一个独立的 FastAPI 服务，负责 ASR 模型加载和语音转写。Electron 主进程会自动启动它，但开发和调试时可以单独运行。

#### 环境安装

```bash
cd sidecar
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

#### 单独启动

```bash
# 基本启动（需指定模型目录）
capty-sidecar --models-dir /path/to/your/models --port 8765

# 或直接用 Python 模块
python -m capty_sidecar.main --models-dir /path/to/your/models --port 8765

# 开启 debug 日志
capty-sidecar --models-dir /path/to/your/models --port 8765 --log-level debug
```

`--models-dir` 指向数据目录下的 `models/` 文件夹，例如 `~/Desktop/capty/models`。

#### 调试

启动后可通过 HTTP 接口验证：

```bash
# 健康检查
curl http://localhost:8765/health

# 查看已注册的模型
curl http://localhost:8765/models

# 切换模型
curl -X POST http://localhost:8765/models/switch \
  -H "Content-Type: application/json" \
  -d '{"model": "qwen3-asr-0.6b"}'
```

WebSocket 转写端点为 `ws://localhost:8765/ws/transcribe`，协议流程：

1. 发送 `{"type": "start", "model": "qwen3-asr-0.6b"}` 开始会话
2. 发送二进制帧（16kHz 16bit PCM 音频数据）
3. 发送 `{"type": "segment_end"}` 触发转写，服务端返回 `{"type": "final", "text": "..."}`
4. 发送 `{"type": "stop"}` 结束会话

#### 运行测试

```bash
cd sidecar
source .venv/bin/activate
pytest
```

## 更新日志

### 2026-03-24 (3)

- 新增模型市场：Settings 中的 Models 区域升级为模型市场 UI
  - 模型卡片展示名称、描述、大小、语言标签、类型标签（Qwen / Whisper）
  - 按钮状态：Download → 下载中（进度条）→ Use → Active
  - 已下载模型支持删除（带确认弹窗，删除本地文件）
  - 底部"Refresh"按钮支持从远程获取最新模型列表（失败时静默降级到本地）
  - 可配置模型源 URL（Model Source URL），支持自定义远程模型注册表地址，Save 后自动刷新
- 新增 Whisper 模型支持：sidecar 新增 transformers 后端
  - 支持 Whisper Tiny / Base / Small / Medium / Large V3 Turbo 五个模型
  - 基于 `model_type` 字段自动选择 qwen-asr 或 whisper 推理引擎
- ControlBar 模型下拉列表显示 [Qwen] / [Whisper] 类型前缀
- `models.json` 模型注册表扩充为 6 个模型，每个模型增加 `type`、`languages`、`description` 字段

### 2026-03-24 (2)

- 新增"重新生成字幕"功能：右键已完成的会话可从保存的音频重新转录，解决 sidecar 故障导致字幕缺失的问题
  - 每 ~10 秒音频自动分段，生成带正确时间戳的多段字幕
  - 重新生成时显示进度条（0-90% 音频发送，90-100% 转录处理）
  - 重新生成期间禁止录音，防止冲突
- 新增设置页面（SettingsModal）：支持更改数据存储目录、查看/下载/切换 ASR 模型
- 新增麦克风选择记忆：选择的麦克风设备 ID 持久化到 config.json，重启后自动恢复；外接麦克风拔出时自动回退到默认设备
- 修复字幕时间戳始终为 0 的问题：录音时改用音频采样计数器（audioSamplesRef）替代 1 秒精度的定时器，VAD 回调直接从实际处理的 PCM 采样数计算时间

### 2026-03-24

- 修复转录仅输出片段的问题：改为全量音频流式传输，VAD 仅触发分段信号，模型获得完整上下文
- 新增历史会话音频播放功能（PlaybackBar 组件 + useAudioPlayer hook）
- 新增模型下载按钮（ControlBar 内，支持进度条显示）
- 模型下载器重写：通过 HuggingFace API 动态获取文件列表
- Sidecar 从 faster-whisper 切换到 qwen-asr（Qwen3-ASR 模型）
- 录音 UI 改为乐观更新，点击即响应
- 修复音量指示条灵敏度不足
- 过滤 macOS 虚拟麦克风设备（default / communications）

### 2026-03-23

- 修复启动黑屏、麦克风设备不显示、sidecar 未自启动等问题
- 修复 better-sqlite3 ABI 不匹配导致的崩溃
- 修复录音时音频文件仅 44 字节（WAV header 写入错误）
- 修复录音进度条不显示、历史时长显示不正确
- 新增右键删除会话功能（含确认弹窗 + 自动清理音频文件）
