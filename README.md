# Capty

macOS 桌面端实时语音转文字应用，基于 Electron + React + 本地 ASR 模型（支持 Qwen3-ASR 和 OpenAI Whisper）。

## 功能

- **实时录音转写** — 捕获系统麦克风音频，全量音频流式传输至 ASR 模型，VAD 检测语音停顿后触发转录
- **会话管理** — 每次录音自动创建会话，历史列表按时间分组（Today / Yesterday / Previous 7 Days / Previous 30 Days / Older），支持折叠/展开，右键重命名（行内编辑，同步重命名磁盘音频目录和主音频文件）/ 删除（含确认弹窗，同时清理音频文件）
- **重新生成字幕** — 对已完成的会话右键选择重新转录，从保存的音频文件重新生成字幕（含进度条），解决 sidecar 故障导致的字幕缺失
- **音频播放** — 历史会话支持一键播放，底部播放器提供 wavesurfer.js 波形可视化（替代纯色进度条）、暂停/恢复/波形点击跳转/时间显示、快进快退 10 秒、倍速播放（0.5x–2.0x 循环切换）、全局键盘快捷键（Space 播放暂停、左右箭头跳转）、Regions 插件标注字幕段落（点击跳转到对应段落）
- **歌词式字幕同步** — 基于 react-lrc 的专业字幕同步，播放时自动高亮当前段落并居中显示（首尾行也能居中）；用户手动滚动后 5 秒自动恢复跟随；点击任意段落跳转到对应音频位置；非播放时行为不变
- **LLM 多维分析** — 接入 OpenAI 兼容 API（OpenAI / DeepSeek / OpenRouter 等），SummaryPanel 支持多 Tab 切换不同分析维度：
  - 内置 3 种类型：Summary（结构化摘要）、Questions（深入追问）、Context（背景推测）
  - 每个 Tab 的生成结果独立存储和展示，支持 Markdown 渲染
  - 可编辑内置类型的提示词（支持 Reset 恢复默认），可添加/编辑/删除自定义 Tab
  - 自定义 Tab 和编辑后的提示词持久化保存，重启后保留
  - SummaryPanel 可选择 provider、拖拽调整宽度
- **设置页面** — 三个 Tab：General（数据目录、配置目录）、Speech Models（模型管理）、Language Models（LLM provider 配置与测试）
- **麦克风记忆** — 自动记住上次选择的麦克风，重启后恢复；外接设备拔出时自动回退默认
- **模型市场** — 内置 Qwen3-ASR + 5 个 Whisper 变体，支持 HuggingFace 搜索、下载、切换、删除；可配置 HuggingFace 镜像地址
- **导出** — 转写结果支持导出为 TXT / SRT / Markdown 格式
- **窗口记忆** — 自动保存窗口位置和大小，重启后恢复
- **界面缩放** — Cmd/Ctrl + = 放大、Cmd/Ctrl + - 缩小、Cmd/Ctrl + 0 重置，缩放比例持久化保存
- **面板宽度记忆** — HistoryPanel 和 SummaryPanel 均支持拖拽调整宽度，宽度设置自动保存，重启后恢复
- **本地优先** — 所有数据（SQLite 数据库 + WAV 音频）存储在本地，ASR 推理完全本地运行

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript + Zustand + react-lrc + wavesurfer.js |
| 数据库 | better-sqlite3 (SQLite) |
| ML 推理 | Python sidecar (FastAPI + mlx-qwen3-asr + mlx-whisper, Apple GPU 加速) |
| 音频处理 | Web Audio API + VAD (voice activity detection) |

## 架构

```
┌─────────────────────────────────────────────────────┐
│  Electron Renderer (React)                          │
│                                                     │
│  useAudioCapture ──→ useVAD ──→ useTranscription    │
│  (麦克风 PCM 采集)   (语音端点检测)  (WebSocket 客户端)  │
│       │                              │    ▲         │
│       │     16kHz PCM 二进制帧         │    │ JSON    │
│       └──────────────────────────────▼    │ 转写结果  │
├──────────── IPC (contextBridge) ─────────────────────┤
│  Electron Main Process                              │
│                                                     │
│  SidecarManager ──→ spawn Python 子进程              │
│  (启动/停止/健康检查)                                  │
│                                                     │
│  ipc-handlers.ts ──→ 模型管理、配置、数据库、文件 I/O   │
├─────────────────────────────────────────────────────┤
│  Python Sidecar (FastAPI + uvicorn)                 │
│                                                     │
│  HTTP:  /health, /models, /models/switch            │
│  WS:    /ws/transcribe                              │
│                                                     │
│  ModelRunner ──→ 根据 model_type 自动选择推理后端：    │
│     • qwen-asr  → Qwen3-ASR 模型 (mlx-qwen3-asr)   │
│     • whisper   → OpenAI Whisper (mlx-whisper)      │
│  ※ 全部通过 MLX 在 Apple GPU 上加速推理              │
└─────────────────────────────────────────────────────┘
```

### 通信流程

**录音转写**（实时）：

1. `useAudioCapture` 通过 Web Audio API 采集麦克风音频，输出 16kHz 16bit PCM
2. PCM 数据同时送入 `useVAD`（语音活动检测）和 `useTranscription`
3. `useTranscription` 维护一个 WebSocket 连接到 Sidecar（`ws://localhost:{port}/ws/transcribe`）
4. 录音开始时发送 `{"type": "start", "model": "xxx"}` 通知 Sidecar 加载模型
5. 音频 PCM 数据以二进制帧持续发送到 Sidecar
6. VAD 检测到语音停顿时，发送 `{"type": "segment_end"}`，Sidecar 对累积的音频执行转写
7. Sidecar 返回 `{"type": "final", "text": "...", "segment_id": N}`，前端追加到字幕列表

**模型管理**（Electron IPC）：

1. 前端通过 `window.capty.listModels()` → IPC → 主进程读取 `user-models.json`
2. 下载模型：主进程通过 HuggingFace API 获取文件列表，逐文件下载到 `models/` 目录，通过 IPC 事件推送进度
3. 切换模型：前端调用 `window.capty` IPC 更新 `config.json`，下次录音时 `useTranscription` 会在 WebSocket `start` 消息中携带新的 model ID，Sidecar 自动加载对应模型

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
│   │   ├── SummaryPanel.tsx
│   │   └── SetupWizard.tsx
│   ├── hooks/           # 自定义 Hooks
│   │   ├── useAudioCapture.ts
│   │   ├── useVAD.ts
│   │   ├── useTranscription.ts
│   │   ├── useSession.ts
│   │   └── useAudioPlayer.ts
│   ├── utils/
│   │   └── lrcConverter.ts  # Segment[] → LRC 格式转换
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
| `windowBounds` | `{x, y, width, height} \| null` | 窗口位置和大小，移动/缩放后自动保存，重启时恢复 |
| `llmProviders` | `LlmProvider[]` | 已配置的 LLM provider 列表（含 id / name / baseUrl / apiKey / model） |
| `selectedLlmProviderId` | `string \| null` | 上次使用的 LLM provider ID，SummaryPanel 默认选中 |
| `promptTypes` | `PromptType[]` | 用户自定义/编辑的 prompt 类型列表，与内置默认合并后使用；每条含 id / label / systemPrompt / isBuiltin |
| `zoomFactor` | `number \| null` | 界面缩放比例，`null` 时使用默认值 1.0；通过 Cmd/Ctrl + =/- 调整 |
| `historyPanelWidth` | `number \| null` | HistoryPanel 宽度（px），`null` 时使用默认值 240，范围 160-400 |
| `summaryPanelWidth` | `number \| null` | SummaryPanel 宽度（px），`null` 时使用默认值 320，范围 220-600 |

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

### 2026-03-26 (8)

- **录音流式写入磁盘** — 防止异常退出丢失音频文件
  - 之前：全部音频缓存在渲染进程 JS 堆中，只有正常停止录音才写入磁盘。程序崩溃/dev reload/强制退出 → 音频全部丢失
  - 现在：录音开始即创建 WAV 文件，每 2 秒将缓冲音频刷到磁盘。最多丢失 2 秒
  - WAV 文件头使用占位符大小，正常停止时修正；异常退出时下次启动自动修复
  - 新增 `repairWavHeaders()` — 启动时扫描 `audio/` 目录，修复所有占位符 WAV 头
  - 不再在内存中拼接完整音频，降低渲染进程内存占用

### 2026-03-26 (7)

- **修复孤儿录音会话** — 程序异常退出导致会话卡在 RECORDING 状态
  - 应用启动时自动检测 `status = 'recording'` 的孤儿会话，将其修复为 `completed`
  - 补填 `ended_at` 时间戳（如果缺失则使用当前时间）
  - 覆盖场景：dev server 重启、崩溃、强制退出等

### 2026-03-26 (6)

- **修复 Sidecar 内存无限增长** — MLX GPU 缓存池未清理
  - 根因：Apple Silicon 统一内存架构下，MLX 的 metal buffer 缓存池默认无上限，每次推理分配的 GPU 缓冲区不会归还系统，只是留在池中等待复用，长时间录音后从 2-3 GB 增长到 30+ GB
  - 修复：启动时 `mx.set_cache_limit(2GB)` 限制缓存池上限
  - 每次推理后 `mx.clear_cache()` + `gc.collect()` 主动释放未使用缓存
  - 使用新版 MLX API（`mx.set_cache_limit` / `mx.clear_cache`），消除 deprecation 警告

### 2026-03-26 (5)

- **修复 Sidecar 录音中崩溃** — MLX 并发推理导致 segfault
  - 根因：`MAX_CONCURRENT = 3` 允许多个 segment 同时在不同线程跑 MLX GPU 推理，MLX 原生 C++ 层非线程安全，并发访问导致 segfault 杀死整个进程
  - 修复：引入 `ThreadPoolExecutor(max_workers=1)` 专用单线程执行器，所有 MLX 操作（模型加载 + 推理）严格串行化到同一线程
  - `MAX_CONCURRENT` 改为 1，确保 asyncio 层面也不会并发进入推理代码
  - 模型加载 (`server.py`) 的 `run_in_executor` 也改为使用 MLX 专用执行器

### 2026-03-26 (4)

- **Sidecar 自动重启** — Python sidecar 进程崩溃后自动重启
  - 非主动停止的退出触发自动重启（指数退避：1s → 2s → 4s → 8s → 16s）
  - 最多连续重启 5 次，稳定运行超过 60 秒后重置计数器
  - 重启复用相同端口，已有连接可自动重连
  - 日志中清晰记录每次重启尝试和结果

### 2026-03-26 (3)

- **LLM 流式输出** — SummaryPanel 的 LLM 生成从阻塞式改为流式输出
  - 后端 `llm:summarize` handler 使用 `stream: true` 调用 OpenAI 兼容 API
  - 实时解析 SSE（Server-Sent Events），逐块通过 `webContents.send` 推送到渲染进程
  - 前端通过 `onSummaryChunk` 监听器累积内容，实时渲染 Markdown
  - 生成过程中显示流式卡片（带闪烁光标），内容到达前显示 spinner
  - 生成完成后流式卡片消失，替换为正常 SummaryCard（已入库）
  - 超时时间从 60 秒延长到 120 秒以适应流式传输
  - 网络错误时正确清理流式状态

### 2026-03-26

- **MLX GPU 加速推理** — 将 PyTorch CPU 推理替换为 MLX GPU 推理，利用 Apple Silicon GPU 大幅加速
  - Qwen-ASR 模型使用 `mlx-qwen3-asr` 库（`Session` API）
  - Whisper 模型使用 `mlx-whisper` 库，自动从 `mlx-community` 下载 MLX 格式权重
  - 移除 transformers、qwen-asr 依赖（torch 仍被 mlx-whisper 间接依赖）
  - 预期 3-10x 推理加速（Apple Silicon GPU vs CPU）
- **并发转录** — WebSocket handler 从阻塞式改为并发式
  - `segment_end` 触发后立即接收下一个 segment，不再等待转录完成
  - 最多 3 个 segment 并发转录（`Semaphore` 控制），避免 GPU 内存溢出
  - 结果按 segment_id 顺序发送（即使 segment 3 先完成，也等 1、2 先发送）
- **异步模型加载** — 模型加载包装在线程池中执行（`run_in_executor`），不再阻塞 event loop，避免 WebSocket 连接在加载大模型时被丢弃
- **Whisper MLX 权重迁移** — `models.json` 和 `model_registry.py` 添加 `mlx_repo` 字段
  - 新下载直接从 `mlx-community` 仓库获取 MLX 格式权重
  - 已下载的 PyTorch 权重会 fallback 到 `mlx_repo` HF 标识符，`mlx-whisper` 自动下载到缓存
  - TypeScript 侧 `isModelDownloaded()` 增加 `.npz` 文件检测（MLX 权重格式）
  - 应用更新时自动为已有 Whisper 模型回填 `mlx_repo` 字段

### 2026-03-26 (2)

- 修复模型下载进度条显示异常百分比（如 1897321312%）
  - 原因：HuggingFace CDN 重定向导致 HEAD 请求对大文件返回 0 大小，但 `globalTotal` 不为 0（小文件 HEAD 成功），下载累积字节远超预计总量
  - 修复：下载时从 GET 响应获取实际 content-length 补充到 `globalTotal`，并 `Math.min` 限制百分比上限为 100%

### 2026-03-25 (10)

- 消除 sidecar 日志中反复出现的 `Setting pad_token_id to eos_token_id` 警告
  - 模型加载时显式设置 `pad_token_id = eos_token_id`，Qwen-ASR 和 Whisper 均已修复

### 2026-03-25 (9)

- 修复实时转录延迟和长音频转录问题
  - VAD 能量阈值从 0.0005 提高到 0.002，避免环境噪音误判为语音导致 segment_end 永远不触发
  - VAD 静默检测帧数从 8 降到 6（~1.5 秒），更快触发分段
  - 新增最大分段时长保护（~30 秒）：连续说话超过 30 秒自动强制分段，防止无限累积
  - Sidecar 新增长音频自动分块：超过 30 秒的音频自动拆分为 30 秒 chunks 逐块转录，兼容 Whisper 30 秒限制
  - 重新生成字幕重写为逐段模式：发送 15 秒音频 → 等转录结果 → 再发下一段，进度条 = 已完成段数/总段数，纯线性增长
  - 解决了进度条瞬间跳到 30% 又长时间卡住、以及音频未被完整转录的问题

### 2026-03-25 (8)

- 集成 wavesurfer.js 替换 PlaybackBar 进度条为波形播放器
  - 使用 wavesurfer.js v7 `media` 选项绑定已有 HTMLAudioElement，仅负责波形渲染
  - 柱状波形风格（barWidth: 2, barGap: 1, barRadius: 2），高度 32px
  - 已播放部分显示 accent 蓝色，未播放部分显示 border 灰色
  - 点击波形任意位置跳转到对应时间
  - Regions 插件标注字幕段落（半透明蓝色区域），点击 Region 跳转到段落起始时间
  - 切换会话时波形和 Regions 自动重建，停止播放时正确销毁
  - 现有控件不变：play/pause、skip ±10s、倍速切换、键盘快捷键

### 2026-03-25 (7)

- 集成 react-lrc 实现专业歌词式字幕同步
  - 播放模式使用 react-lrc `<Lrc>` 组件替换手写滚动逻辑
  - `verticalSpace` 属性实现活跃行真正居中（首尾行也能居中）
  - 用户手动滚动后 5 秒自动恢复跟随（`recoverAutoScrollInterval`）
  - 段落间隙无空档：当前行从 start 持续到下一行 start
  - 新增 `lrcConverter.ts` 工具函数，将 Segment[] 动态转换为 LRC 格式
  - 录音模式和空闲模式完全不受影响

### 2026-03-25 (6)

- 播放增强 + 歌词式字幕联动
  - PlaybackBar 新增快退 10s / 快进 10s 按钮，新增倍速按钮（0.5x → 0.75x → 1.0x → 1.25x → 1.5x → 2.0x 循环切换，非 1x 时高亮显示）
  - 全局键盘快捷键：Space 播放/暂停、← 后退 10 秒、→ 前进 10 秒（输入框聚焦时不触发）
  - 倍速设置在切换歌曲后保持（不会重置为 1x）
  - TranscriptArea 播放时自动高亮当前段落：左侧蓝色边框 + 半透明蓝色背景，非活跃段落降低不透明度
  - 活跃段落切换时自动平滑滚动到视口中央
  - 播放时鼠标悬停段落显示浅底色，点击段落跳转到对应音频时间点
  - 非播放时 TranscriptArea 行为完全不变（无高亮、无指针样式）

### 2026-03-25 (5)

- 移除 HistoryPanel 顶部 "History (N)" 标题（分组标题已包含计数信息，冗余移除）
- 新增会话重命名功能
  - 右键菜单新增 "Rename" 选项，点击后进入行内编辑模式
  - 输入框自动聚焦并选中原标题，Enter 确认、ESC 取消、blur 确认
  - 重命名时同步重命名磁盘上的音频目录和主音频文件（sanitize 非法文件名字符）
  - 数据库 title 和 audio_path 同步更新，播放/导出/打开文件夹等功能不受影响

### 2026-03-25 (4)

- HistoryPanel 会话按时间分组折叠
  - 自动按 Today / Yesterday / Previous 7 Days / Previous 30 Days / Older 分组
  - 每组可独立点击展开/折叠，Today 默认展开，其余默认折叠
  - 选中某个会话时，其所在分组自动展开
  - 空分组不显示，纯前端逻辑无需后端改动

### 2026-03-25 (3)

- 新增界面缩放功能
  - Cmd/Ctrl + = 放大、Cmd/Ctrl + - 缩小、Cmd/Ctrl + 0 重置（范围 0.5x – 3.0x）
  - 缩放比例持久化到 config.json，重启后自动恢复
- HistoryPanel 宽度支持拖拽调节（160px – 400px），右边缘拖动即可
- 面板宽度持久化
  - HistoryPanel 和 SummaryPanel 拖拽后的宽度自动保存到 config.json
  - 重启后恢复上次的面板宽度设置
- config.json 新增 3 个字段：`zoomFactor`、`historyPanelWidth`、`summaryPanelWidth`

### 2026-03-25 (2)

- SummaryPanel 重构为多 Tab 系统
  - 内置 3 个分析维度：Summary（结构化摘要）、Questions（深入追问）、Context（背景推测）
  - Tab 栏横向排列，点击切换，每个 Tab 独立存储和展示生成结果
  - 点击 Tab 旁编辑按钮可修改提示词，内置类型支持 Reset 恢复默认
  - "+" 按钮可添加自定义 Tab（自定义名称 + 提示词），可编辑可删除
  - 自定义 Tab 和编辑后的提示词持久化到 config.json，重启后保留
  - 数据库 summaries 表新增 `prompt_type` 列，兼容旧数据（默认归入 Summary）

### 2026-03-25

- 新增 LLM 摘要功能（SummaryPanel）
  - 接入 OpenAI 兼容 API，对转写内容一键生成结构化摘要
  - 内置 OpenAI / DeepSeek / OpenRouter 三个预设 provider，也可添加自定义 provider
  - 摘要内容以 Markdown 渲染（标题、列表、代码块、表格等）
  - Provider 可在 Settings > Language Models 中配置 API Key / Model，支持 Test 连通性测试
- LLM Provider 选择从 Settings 移至 SummaryPanel
  - Settings > Language Models 页面仅负责配置和测试 provider，移除 "Use" / "Active" 按钮
  - SummaryPanel 顶部新增 provider 下拉选择器，点击 Summarize 前选择使用哪个 provider
  - 自动记忆上次使用的 provider，下次打开时默认选中
- Summary 列表改为最新生成的排在最前面
- SummaryPanel 宽度支持拖拽调节（220px – 600px），左边缘拖动即可
- Settings 重构为三个 Tab：General / Speech Models / Language Models
- 新增 Config Directory 显示（General Tab），可一键打开配置文件目录
- 窗口位置和大小自动保存到 config，重启后恢复
- 模型注册表重构为 `user-models.json` 单一数据源
  - 首次启动从内置 `models.json` 自动初始化
  - 应用更新时自动合并新增的内置模型
  - 自动扫描 models 目录发现孤儿模型并注册
- 模型市场改为 HuggingFace 实时搜索（替代静态远程列表）
  - 搜索结果通过 tree API 获取精确下载大小
  - 支持配置 HuggingFace 镜像地址（Settings > Speech Models）
- 模型列表按类型分组、按大小排序

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
- 新增会话右键"打开文件夹"选项，在 Finder 中打开对应音频目录
- 音频文件名改用时间戳命名，导出默认保存到音频目录
- 修复录音中途点停止时剩余音频未转录的问题
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
