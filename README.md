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

## 开发

```bash
# 安装依赖
npm install

# 启动开发模式
npm run dev

# 构建
npm run build
```

Sidecar 需要 Python 环境：

```bash
cd src/sidecar
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
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
