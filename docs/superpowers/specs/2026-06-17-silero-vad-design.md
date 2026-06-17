# Silero VAD (renderer 内联) Design Spec

**Date:** 2026-06-17
**Status:** Approved (design), ready for plan
**Author:** brainstorming session

## 背景与目标

当前 Capty 的语音活动检测在 `src/renderer/hooks/useVAD.ts`,是**纯能量阈值**实现:

```ts
const frameIsSpeech = energy > 0.002; // mean-square ≈ -27dBFS,固定常量
```

它只看响度、不看频谱,也不自适应噪声底。后果:**风扇等稳态宽带噪声只要响度稳定高于阈值,每一帧都被判成"正在说话"**,现有去抖(2 帧起/6 帧止)对持续稳定的噪声无效,唯一会断的地方是 `MAX_SPEECH_FRAMES=120`(≈30s 强制切段),表现为"对着风扇每 30 秒切一段假转录"。`useAudioCapture` 已开 `noiseSuppression: true` 仍漏过。

**目标:** 用 Silero VAD(深度学习模型)替换 per-frame 的"是不是人声"判定,消除风扇这类稳态噪声的误判,同时不改动录音/分段/ASR 的其余架构。

**非目标:**
- 不替换 ASR(Capty ASR 跑在 Apple MLX,GPU/ANE 加速;Eve 的 Qwen3/sherpa 是跨平台 CPU 方案,在 Mac 上是降级)。
- 不引入 native addon(`sherpa-onnx-node`)、不改 IPC 架构、不把 VAD 移到主进程或 sidecar。
- 不做模型按需下载 UI。

## 选型结论(已调研)

| 模型 | 结论 |
|---|---|
| WebRTC VAD | 淘汰。信号处理老方案,本身以误报多著称,换它等于没换。 |
| TEN VAD | 淘汰。准确率/延迟虽最强,但 license 是 Apache2.0 **+ 附加条款**(不得与 Agora 竞争 / field-of-use 限制),非 OSI 标准协议;Capty 准备开源,引入会污染协议叙事;且其卖点"超低 turn-detection 延迟"对段式转录用不上。 |
| **Silero VAD** | **选定。** MIT 协议干净、模型 ~2MB、`onnxruntime-web` 在 renderer 成熟可跑、对稳态噪声鲁棒。准确率对本场景够用,延迟劣势对段式转录无所谓。同类项目 nexmoe/eve 也用 Silero。 |

**运行位置:** renderer 内联。理由:Capty 的 VAD 是录音时实时驱动分段的,逻辑在 renderer;走主进程/sidecar 都要把录音帧实时双向 IPC(帧发过去、speech 事件传回来),架构改动大。renderer 内联是真·drop-in,且纯 JS/wasm 无 native addon,对开源最友好。

## 关键事实(已核实)

- `src/renderer/hooks/useAudioCapture.ts:116` 用 `new AudioContext({ sampleRate: 16000 })` + `createScriptProcessor(4096, 1, 1)` mono → **音频本来就是 16kHz 单声道,4096-sample buffer,无需重采样**。
- Silero v5 ONNX 接口:输入 `input` float32 `[1, 512]`、`state` float32 `[2, 1, 128]`、`sr` int64 标量(16000);输出 `output` float32(语音概率)+ `stateN` float32 `[2, 1, 128]`(需跨帧回传)。
- 一个 4096 buffer 正好切 **8 × 512** 窗口。每窗口 ≈ 32ms。
- `useVAD` 当前对外接口:`{ isSpeaking, isLoaded, feedAudio(Int16Array), markLoaded }` + `{ onSpeechStart?, onSpeechEnd? }` 回调。调用方:`src/renderer/App.tsx`(挂回调)、`src/renderer/hooks/useSessionManagement.ts:248`(`vad.feedAudio(pcm)`,与 `session.feedAudio(pcm)` 并列喂同一帧)。
- `onnxruntime-web` 最新 1.26.0。项目用 electron-vite,renderer 是标准 vite+react;**当前无 toast 系统、无 public 目录**。

## 架构

保留 `useVAD` 对外接口不变,只换内核。新增一个纯推理模块;去抖逻辑迁到 512 窗口(~32ms)粒度并重调常量。能量 VAD 作为加载失败时的 fallback 保留。

```
useAudioCapture (16k/4096 int16)
  └─> useSessionManagement.onAudioData(pcm)
        ├─> session.feedAudio(pcm)        // 录音落盘(不变)
        └─> vad.feedAudio(pcm)            // ↓ 本次改造
              float32 转换 + remainder 累积 → 切 512 窗口
                └─> 顺序异步推理队列 → silero.process(win) → prob
                      └─> prob > 0.5 ? speech : silence
                            └─> 512 粒度去抖(8/32/938 窗口)
                                  └─> onSpeechStart / onSpeechEnd(不变)
                                        └─> 现有"提交段给 MLX ASR"流程(不变)
```

## 组件

### 1. `src/renderer/vad/silero.ts`(新,纯模块,可测)

封装 onnxruntime-web `InferenceSession` + Silero 状态管理。

```ts
export interface SileroVad {
  /** 喂一个 512-sample float32 窗口,返回语音概率 [0,1]。 */
  process(window: Float32Array): Promise<number>;
  /** 重置内部 state tensor(新录音开始时调用)。 */
  reset(): void;
}

/** 加载模型并创建实例;加载失败抛错(由 useVAD 捕获降级)。 */
export async function createSileroVad(modelUrl: string): Promise<SileroVad>;
```

实现要点:
- `InferenceSession.create(modelUrl)`,`ort.env.wasm.wasmPaths` 指向内置 wasm 目录(见打包)。
- 内部维护 `state: Float32Array(2*1*128)` 初始全 0;`sr` 为 `BigInt64Array([16000n])` 的 tensor。
- `process`:构造 `input` tensor `[1,512]` + 当前 `state` + `sr` → `session.run` → 取 `output[0]` 为 prob、把 `stateN` 存回 `state` → 返回 prob。
- `reset`:`state` 清零。
- 窗口长度严格 512;非 512 长度由调用方(useVAD)保证。

### 2. `useVAD.ts`(重写内核,对外接口不变)

新增 state 字段 `degraded: boolean`(Silero 不可用、已回退能量 VAD)。

- **加载:** 挂载时 `createSileroVad(modelUrl)`;成功 → `isLoaded=true`、`degraded=false`;失败 → `isLoaded=true`(避免阻塞)、`degraded=true`、`console.warn`,后续走能量 fallback。
- **`feedAudio(int16: Int16Array)`(4096):**
  1. int16 → float32(`/32768`)。
  2. 若 `degraded`:走保留的能量路径(下述 fallback),return。
  3. 否则:把 float32 追加到 `remainderRef`(Float32Array),按 512 切出整窗口,余数留回 `remainderRef`。
  4. 每个 512 窗口 push 进**顺序异步推理队列**(见下),队列里逐个 `await silero.process(win)`。
- **顺序异步推理队列:** 一个 `processing` 布尔 + 窗口数组。`feedAudio` 只入队并启动 pump(若未运行)。pump 循环 `await process` 保证按序;每窗口得 prob → 算 `frameIsSpeech = prob > THRESHOLD` → 喂去抖。8 窗口/256ms,wasm 单次推理 <几 ms,不会堆积;但仍设一个 backlog 上限(如 64 窗口)防异常堆积,超限丢最旧窗口并 `console.warn`。
- **去抖(512 粒度,重调常量):** 沿用现有"连续 N 窗口才翻转 + 强制切段"结构,常量换算到 32ms 窗口:

| 常量 | 值(窗口) | 时长 | 含义 |
|---|---|---|---|
| `SPEECH_WINDOWS` | 8 | ~0.25s | 连续 speech 窗口数 → 确认说话开始 |
| `SILENCE_WINDOWS` | 32 | ~1.0s | 连续 silence 窗口数 → 确认说话结束 |
| `MAX_SPEECH_WINDOWS` | 938 | ~30s | 连续 speech 上限 → 强制切段(end→start) |
| `THRESHOLD` | 0.5 | — | Silero prob 阈值 |

  去抖触发 `processSample(true/false)` → 调 `onSpeechStart/onSpeechEnd`,逻辑与现状一致。
- **`reset` 时机:** 录音开始时需重置 silero state + remainder + 去抖计数 + 队列,避免跨 session 泄漏。新增并导出 `reset()`(或在 `markLoaded`/录音 start 时机调用)。`useSessionManagement` 在 `handleStart` 调 `vad.reset()`。
- **`markLoaded`:** 保留(向后兼容),不再用于标记 loaded(改由模型加载控制),保留空实现或移除调用方引用——由 plan 决定;**对外类型签名保留**避免破坏 App.tsx。

### 3. 能量 VAD fallback(保留现有逻辑)

把当前 `useVAD` 的能量 + 帧计数去抖逻辑抽成一个内部函数 `feedAudioEnergy(int16)`,仅在 `degraded === true` 时使用。常量保持原值(256ms 帧:2/6/120)。这样模型不可用时录音照常工作。

### 4. 降级提示 UI(轻量,不造 toast 系统)

`useVAD` 暴露 `degraded`。`App.tsx` 在 `degraded === true` 时渲染一行可关闭的内联 banner:「高级降噪 VAD 不可用,已回退基础模式」。用最简 `<div>` + 一个 dismiss state,**不引入 toast 库**。

### 5. 打包(内置、离线)

- **模型:** `silero_vad.onnx`(~2MB,来源 `https://github.com/snakers4/silero-vad` 或 sherpa-onnx releases `silero_vad.onnx`)放入仓库 `src/renderer/assets/silero_vad.onnx`,用 vite `?url` 导入得到打包后 URL 传给 `createSileroVad`。
- **onnxruntime-web wasm/mjs:** 加依赖 `onnxruntime-web@^1.26.0`;用 `vite-plugin-static-copy` 把 `node_modules/onnxruntime-web/dist/*.wasm` 和 `*.mjs` 拷贝到 renderer 输出的固定子目录(如 `ort/`),并设 `ort.env.wasm.wasmPaths` 指向该目录;`ort.env.wasm.numThreads = 1`(避免 SharedArrayBuffer/COOP 头依赖),`ort.env.wasm.simd = true`。
- 全程离线,装完即用。

## 数据流(录音中)

1. `useAudioCapture` 每 ~256ms 回调一个 4096 int16 buffer。
2. `useSessionManagement.onAudioData` 同时喂 `session.feedAudio`(落盘)与 `vad.feedAudio`(VAD)。
3. `vad.feedAudio` 切 8×512 窗口 → 顺序推理 → 去抖 → speech-end 时触发现有 `onSpeechEnd` → 提交该段 PCM 给 MLX ASR(不变)。

## 错误处理

- **模型加载失败 / wasm 初始化失败 / 文件损坏:** 捕获 → `degraded=true` → 走能量 fallback + 显示 banner,录音不中断。
- **单次推理异常:** try/catch 包住 `process`,异常窗口按 **silence** 处理(保守:宁可漏判也不把噪声当语音)+ `console.warn`,不崩录音。
- **队列 backlog 超限:** 丢最旧窗口 + `console.warn`(正常不会触发)。

## 测试

1. **`silero.ts` 单测**(node + onnxruntime-web 或 onnxruntime-node 加载真实模型):
   - 喂一段真人声 wav fixture 的 512 窗口序列,断言至少部分窗口 prob > 0.5。
   - 喂白噪声/静音 512 窗口,断言 prob 明显更低(< 0.5)。
   - `reset()` 后 state 归零(连续两次相同输入序列、reset 后结果可复现)。
2. **去抖逻辑单测**(注入假 prob 源,不依赖模型):把 silero 的 `process` 替换成可控函数,喂 prob 序列,断言:
   - 连续 ≥8 个 >0.5 → `onSpeechStart` 触发一次。
   - 说话中连续 ≥32 个 <0.5 → `onSpeechEnd` 触发一次。
   - 连续 938 个 >0.5 → 触发一次 end+start(强制切段)。
   - 抖动(<8 窗口的孤立 speech)不触发。
3. **fallback 单测:** 模拟 `createSileroVad` 抛错 → `degraded=true`、`feedAudio` 走能量路径(喂高能量帧仍能触发 onSpeechStart)。
4. 全量测试通过(`vitest`),`tsc` clean。注:`tests/main/handlers/audio-handlers.test.ts` 有一条**既有失败**("rolls back the session when ffmpeg conversion fails",clean main 即失败),非本次回归,不修。

## 文件清单

| 文件 | 动作 |
|---|---|
| `src/renderer/vad/silero.ts` | 新建:onnxruntime-web + Silero 封装 |
| `src/renderer/assets/silero_vad.onnx` | 新建:内置模型 |
| `src/renderer/hooks/useVAD.ts` | 重写内核:Silero 队列 + 512 去抖 + 能量 fallback + `degraded` |
| `src/renderer/hooks/useSessionManagement.ts` | `handleStart` 调 `vad.reset()` |
| `src/renderer/App.tsx` | `degraded` banner;适配 useVAD 返回值 |
| `electron.vite.config.ts` | `vite-plugin-static-copy` 拷贝 ort wasm/mjs |
| `package.json` | 加 `onnxruntime-web`、`vite-plugin-static-copy`(dev) |
| `tests/renderer/silero.test.ts` | 新建 |
| `tests/renderer/useVAD-debounce.test.ts` | 新建 |
| `CHANGELOG.md` | [Unreleased] 记录 |

## 复用的现有能力

- `useVAD` 对外接口、`onSpeechStart/End` 桥接(App.tsx)、`useSessionManagement` 的喂帧点 —— 全部不变。
- 现有段式 ASR 提交流程 —— 不变。
- 现有能量 VAD 逻辑 —— 降级为 fallback 保留。

## 风险

1. **onnxruntime-web 在 Electron renderer 的 wasm 路径配置**是常见坑(wasmPaths / mjs / COOP)。`numThreads=1` 规避线程相关头要求;plan 第一步先验证模型能 `InferenceSession.create` 成功。
2. **Silero v5 输入张量名/形状**若与假设不符,以官方模型实际 IO 为准(plan 中先 `console.log(session.inputNames/outputNames)` 核对再写死)。
3. **去抖常量手感**:0.25s/1.0s/30s 为初始值,上线后可按真实录音微调,常量集中在 `useVAD.ts` 顶部便于调整。
