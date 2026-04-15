# Capty 全面代码审查报告

**日期**: 2026-04-13
**项目**: capty — Electron + TypeScript + React 桌面语音转文字应用 (含 Python sidecar)
**代码量**: ~24,700 行源码 (21 TS/TSX + 7 Python 文件)
**审查方式**: 4 个并行 agent 分别审查安全 / Bug / 代码质量 / 架构

---

## 一、CRITICAL & HIGH 级别问题（必须修复）

### 安全类

| # | 严重度 | 文件 | 问题 |
|---|--------|------|------|
| S1 | HIGH | `src/main/database.ts:602` | **SQL 列名注入** — `updateDownload` / `updateSession` 用 `Object.entries(fields)` 直接拼接列名到 SQL，无白名单校验。`session:update` IPC 接受 `Record<string, unknown>` 直传。修复：加列名白名单 |
| S2 | HIGH | `src/main/ipc-handlers.ts:2477` | **未验证文件路径** — `audio:get-duration` 直接 `fs.openSync(filePath)` 无 `assertPathWithin` 校验，违反全库一致的路径验证模式。修复：加 `assertPathWithin(dataDir, filePath)` |
| S3 | HIGH | `src/main/index.ts:82` | **`shell.openExternal` 无 URL scheme 校验** — LLM 生成的内容中若含 `javascript:`/`file://` 链接可被执行。修复：只允许 `https:` / `http:` 协议 |
| S4 | HIGH | `src/main/ipc-handlers.ts:1222` | **`config:set` 无限制合并** — 渲染进程可覆写 `dataDir`、`hfMirrorUrl`，后者可将模型下载重定向到恶意服务器。修复：白名单可写 key 或 Zod 验证 |
| S5 | HIGH | `sidecar/capty_sidecar/server.py:90` | **Python 路径遍历绕过** — `_validate_file_path` 用 `startswith` 匹配，`/data/capty/audio-evil/` 可绕过 `/data/capty/audio`。修复：改用 `Path.is_relative_to()` 或检查 `+ os.sep` |

### Bug 类

| # | 严重度 | 文件 | 问题 |
|---|--------|------|------|
| B1 | HIGH | `src/renderer/App.tsx:114-142` | **停录后段丢失** — `onFinalCallback` 闭包捕获 `store.currentSessionId`，`handleStop` 后 sessionId 已为 null，迟到的转写结果写入内存但不入库，导致 UI/DB 不一致 |
| B2 | HIGH | `src/renderer/hooks/useTranscription.ts:118` | **`gracefulDisconnect` 不等待在途请求** — `pendingRef` 计数器有跟踪但未被 drain，与 B1 配合导致最后一段语音静默丢失 |
| B3 | HIGH | `src/main/ipc-handlers.ts:3145` | **yt-dlp `stdout` 可能为 null** — `spawn` 未显式设 `stdio: ['ignore','pipe','pipe']`，直接调 `.on("data")` 可能抛 TypeError 崩溃 |

---

## 二、MEDIUM 级别问题（建议修复）

### 安全类

| # | 文件 | 问题 |
|---|------|------|
| S6 | `src/main/ipc-handlers.ts:235` | `execSync` 直接拼接 port 到 shell 命令，改用 `execFileSync` 数组形式 |
| S7 | `src/main/download/model-download-task.ts:336` | 模型下载无 SHA256 校验，恶意镜像可投毒 |
| S8 | `src/main/ipc-handlers.ts:3027` | yt-dlp URL 未验证是否 HTTP/HTTPS，可通过 `--` 注入参数 |
| S9 | sidecar | 默认绑定 `0.0.0.0` 且无鉴权，局域网可直接调用转写 API |

### Bug 类

| # | 文件 | 问题 |
|---|------|------|
| B4 | `src/renderer/App.tsx:1988` | `layoutTimerRef` 两个 handler 共用同一 timer ref，互相覆盖保存；组件卸载时未清除 |
| B5 | `src/renderer/App.tsx:134` | `store.addSegment` 在无活跃录音时仍执行，可能往其他 session 追加幽灵段 |
| B6 | `src/main/ipc-handlers.ts:366` | Xiaoyuzhou 播客下载将整个文件 (100-500MB) 缓存在内存，大文件 OOM 风险 |
| B7 | `src/main/ipc-handlers.ts:3060` | 下载异步 IIFE 无法被 app quit 取消，可能在 DB 关闭后写入崩溃 |

### 架构类

| # | 文件 | 问题 |
|---|------|------|
| A1 | `src/main/ipc-handlers.ts` (3412行) | **单文件 God Module** — 10+ 业务域全在一个闭包，不可测试。建议拆为 `handlers/{session,model,llm,tts,download,...}.ts` |
| A2 | `src/renderer/App.tsx` (2534行) | **God Component** — ~60 个 useState、40 个 useCallback、15 个 useEffect，状态碎片化。建议抽 Zustand slice + 独立 hooks |
| A3 | `src/preload/index.ts` | **IPC 无类型** — 多处 `Record<string, unknown>` + `as any`，编译期不检查参数结构。建议加 `src/shared/ipc-types.ts` |
| A4 | `src/main/database.ts` | **迁移靠 try/catch 吞错误** — ALTER TABLE 重复执行，非 "column exists" 的异常也被静默。建议版本化迁移 |
| A5 | `src/renderer/hooks/useTranscription.ts` | **sidecar 崩溃无监控** — 录音过程中 sidecar 挂掉用户无任何提示。建议加健康轮询 + UI toast |

---

## 三、代码质量问题（重构建议）

### 文件行数（全部超过项目 800 行上限）

| 文件 | 行数 | 超限倍数 |
|------|------|--------|
| `src/renderer/components/SettingsModal.tsx` | 4601 | 5.8x |
| `src/main/ipc-handlers.ts` | 3412 | 4.3x |
| `src/renderer/App.tsx` | 2534 | 3.2x |
| `src/renderer/components/HistoryPanel.tsx` | 2308 | 2.9x |
| `src/renderer/components/SummaryPanel.tsx` | 1841 | 2.3x |
| `src/renderer/components/TranscriptArea.tsx` | 1323 | 1.7x |

### 主要质量问题

| 优先级 | 文件 | 问题 | 建议 |
|--------|------|------|------|
| P1 | `SettingsModal.tsx` | 包含 5 个 Tab + ModelCard + InlineModelMarket + useProviderManagement hook 全塞一起 | 按 tab 拆为 `settings/{GeneralTab,AsrTab,TtsTab,LlmTab,ModelMarket}.tsx` + hooks |
| P2 | `HistoryPanel.tsx` | 混合拖拽/右键菜单/重命名/分类/删除/编辑 5+ 职责 | 每个职责抽独立子组件 |
| P3 | `SummaryPanel.tsx` | 翻译/摘要/TTS 逻辑混合 | 抽 hooks |
| P4 | `App.tsx` | `getConfig()+setConfig()` 读写模式出现 21 次，读-改-写竞态 | 改为原子 `patchConfig(partial)` IPC |
| P5 | `loadAsrModels`/`loadTtsModels` | 两个 60 行函数几乎相同 | 合并为 `loadModels(category: "asr"\|"tts")` |
| P6 | `App.tsx:1010-1143` | `handleRegenerateSubtitles` 单函数 130 行 | 抽 `useSubtitleRegeneration()` hook |
| P7 | `App.tsx:1504-1603` | `handleTranslate` 100 行含手写并发控制 | 抽 `useTranslationPipeline()` hook |
| P8 | `App.tsx:413-683` | `init` useEffect 270 行含 15+ 初始化步骤 | 拆分为独立初始化 hooks |
| P9 | `App.tsx` | 35+ `console.error`/`console.warn` 调用 | 接入结构化日志 + UI toast |
| P10 | `SettingsModal` props | 50+ 个 prop 的 prop drilling | App.tsx 状态抽 Zustand slice 后收窄 |
| P11 | IPC 层 | `Record<string, unknown>` + `as any` 多处 | `src/shared/ipc-types.ts` 定义共享契约 |
| P12 | `ModelInfo` 接口 | 在 3 个文件重复定义 | 抽 `src/renderer/types/models.ts` |

---

## 四、优点（做得好的地方）

- **Electron 安全基础扎实** — `sandbox: true`, `contextIsolation: true`, DOMPurify 清理所有 HTML, `assertPathWithin` 覆盖大部分文件操作
- **下载系统封装良好** — `src/main/download/` 模块化清晰，`DownloadManager` 支持暂停/恢复/取消/断点续传
- **Zustand 状态不可变** — 所有 mutation 使用 spread + readonly 接口
- **Python sidecar 结构清晰** — `server`/`engine`/`engine_pool`/`model_registry` 分层合理，Pydantic schema 验证输入
- **dbProxy 延迟初始化** — 巧妙的 Proxy 模式让 IPC 注册先于 DB 初始化
- **无硬编码密钥** — 全库未发现任何泄露的 API key/token/password
- **VAD 有强制切段** — 30 秒强制结束防止音频缓冲区无限增长

---

## 五、推荐修复优先级

```
紧急修复（开源前必须完成）:
  1. S3  shell.openExternal URL 校验 (5分钟)
  2. S2  audio:get-duration 路径校验 (5分钟)
  3. S5  Python startswith → is_relative_to (5分钟)
  4. S1  SQL 列名白名单 (15分钟)
  5. S4  config:set 白名单 (15分钟)
  6. B1+B2 停录段丢失 + gracefulDisconnect drain (30分钟)
  7. B3  yt-dlp stdio 修复 (5分钟)

短期改善:
  8.  S9  sidecar 绑定 127.0.0.1 + token 鉴权
  9.  S7  模型下载 SHA256 校验
  10. A1  ipc-handlers.ts 拆分（见重构计划）
  11. A4  版本化 DB 迁移

中期重构:
  12. A2  App.tsx 状态抽 Zustand slice
  13. P1  SettingsModal 拆分
  14. A3  IPC 类型安全层
```

---

## 六、统计

| 严重度 | 安全 | Bug | 架构 | 代码质量 | 合计 |
|--------|------|-----|------|---------|------|
| CRITICAL | 0 | 0 | 0 | 0 | **0** |
| HIGH | 5 | 3 | 3 | 8 | **19** |
| MEDIUM | 4 | 4 | 2 | 6 | **16** |
| LOW | 0 | 2 | 0 | 4 | **6** |
| **合计** | **9** | **9** | **5** | **18** | **41** |

**总体结论**: 安全基础稳固，但有 19 个 HIGH 级问题。最大痛点是 `ipc-handlers.ts` 和 `App.tsx` 两个巨文件 + 停录时最后一段语音可能丢失的用户可见 bug。建议分三阶段修复：安全热修 → 架构重构（TDD）→ 代码质量优化。
