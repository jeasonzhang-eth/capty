# Capty

macOS 桌面端实时语音转文字应用，基于 Electron + React + 本地 Whisper 模型。

## 功能

- **实时录音转写** — 捕获系统麦克风音频，通过 VAD（语音活动检测）分段，实时送入 Whisper 模型转写
- **会话管理** — 每次录音自动创建会话，历史列表展示所有会话，支持右键删除（含确认弹窗，同时清理音频文件）
- **多模型支持** — 可选择不同 Whisper 模型，支持在线下载并显示进度
- **导出** — 转写结果支持导出为 TXT / SRT / Markdown 格式
- **本地优先** — 所有数据（SQLite 数据库 + WAV 音频）存储在本地，无需联网

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 33 + electron-vite |
| 前端 | React 18 + TypeScript + Zustand |
| 数据库 | better-sqlite3 (SQLite) |
| ML 推理 | Python sidecar (FastAPI + faster-whisper) |
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
│   │   └── SetupWizard.tsx
│   ├── hooks/           # 自定义 Hooks
│   │   ├── useAudioCapture.ts
│   │   ├── useVAD.ts
│   │   ├── useTranscription.ts
│   │   └── useSession.ts
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

## 近期更新

- 修复启动黑屏、麦克风设备不显示、sidecar 未自启动等问题
- 修复 better-sqlite3 ABI 不匹配导致的崩溃
- 修复录音时音频文件仅 44 字节（WAV header 写入错误）
- 修复录音进度条不显示、历史时长显示不正确
- 新增右键删除会话功能（含确认弹窗 + 自动清理音频文件）
