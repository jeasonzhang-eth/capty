# Silero VAD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Silero VAD(onnxruntime-web,renderer 内联)替换 `useVAD.ts` 的能量阈值判定,消除风扇等稳态噪声的误判,保留录音/分段/ASR 其余架构不变。

**Architecture:** 新增纯推理模块 `silero.ts`(封装 onnxruntime-web)+ 纯同步去抖模块 `debounce.ts`(从现有 useVAD 抽出并参数化)。`useVAD.ts` 把音频切成 512-sample 窗口 → 顺序异步推理得 prob → `prob>0.5` 喂去抖器 → 触发现有 `onSpeechStart/End`。Silero 加载失败时降级回保留的能量 VAD + 显示 banner。模型与 ort wasm 随包内置,完全离线。

**Tech Stack:** TypeScript, React hooks, onnxruntime-web 1.26, Silero VAD v5 ONNX, vite (electron-vite), vitest。

参考 spec:`docs/superpowers/specs/2026-06-17-silero-vad-design.md`

## 测试命令(本项目约定)

vitest 在 electron-as-node 下跑:

```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run <test-path>
```

tsc 检查:`npx tsc --noEmit`

> 既有失败(非本次回归,**不要修**):`tests/main/handlers/audio-handlers.test.ts` 的 "rolls back the session when ffmpeg conversion fails"(clean main 即失败)。

## 关键既有事实

- 音频已是 16kHz mono / 4096 int16 buffer(`src/renderer/hooks/useAudioCapture.ts:116-121`),无需重采样;4096 = 8 × 512。
- `useVAD` 现接口:`useVAD({onSpeechStart?, onSpeechEnd?})` → `{isSpeaking, isLoaded, feedAudio(Int16Array), markLoaded}`。调用方 `App.tsx:123`、`useSessionManagement.ts:248`。
- Silero v5 ONNX IO:输入 `input`[1,512] float32、`state`[2,1,128] float32、`sr` int64 标量;输出 `output` float32(prob)、`stateN`[2,1,128] float32。

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/renderer/vad/silero.ts` | onnxruntime-web + Silero 封装,`createSileroVad`/`process`/`reset` |
| `src/renderer/vad/debounce.ts` | 纯同步去抖器(speech/silence/max 计数 → speech 起止回调) |
| `src/renderer/assets/silero_vad.onnx` | 内置 v5 模型 |
| `src/renderer/hooks/useVAD.ts` | 重写内核:窗口切分 + silero 队列 + debouncer + 能量 fallback + `degraded` |
| `src/renderer/hooks/useSessionManagement.ts` | `handleStart` 调 `vad.reset()` |
| `src/renderer/App.tsx` | `degraded` banner |
| `electron.vite.config.ts` | static-copy ort wasm/mjs |
| `package.json` | 加 `onnxruntime-web`、`vite-plugin-static-copy` |
| `tests/renderer/silero.test.ts` | silero 模块测试(真实模型) |
| `tests/renderer/debounce.test.ts` | 去抖器测试(纯同步) |
| `tests/renderer/useVAD.test.ts` | useVAD 集成测试(注入 fake silero) |
| `CHANGELOG.md` | 记录 |

---

### Task 1: 依赖 + 模型 + ort 打包 + 加载验证(风险闸)

先把 onnxruntime-web 跑通、把 Silero v5 模型放好、核对张量 IO 名。这是后续所有任务的前提。

**Files:**
- Modify: `package.json`
- Modify: `electron.vite.config.ts`
- Create: `src/renderer/assets/silero_vad.onnx`(下载)
- Create: `tests/renderer/silero-load.test.ts`
- Create: `tests/renderer/vitest-ort-setup.ts`

- [ ] **Step 1: 安装依赖**

```bash
cd "/Users/zhangjie/Documents/Jeason的创作/code/personal/capty"
npm install onnxruntime-web@^1.26.0
npm install -D vite-plugin-static-copy
```

- [ ] **Step 2: 下载 Silero v5 模型到 assets**

```bash
mkdir -p src/renderer/assets
curl -fL -o src/renderer/assets/silero_vad.onnx \
  https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx
ls -la src/renderer/assets/silero_vad.onnx   # 期望 ~2MB(1.5–2.3MB)
```

- [ ] **Step 3: 写测试 setup,让 onnxruntime-web 在 node(electron)下找到 wasm**

Create `tests/renderer/vitest-ort-setup.ts`:

```ts
import * as ort from "onnxruntime-web";
import { resolve } from "path";

// In the electron-as-node test env, point ORT at the wasm files shipped in node_modules.
ort.env.wasm.wasmPaths = resolve(__dirname, "../../node_modules/onnxruntime-web/dist/") + "/";
ort.env.wasm.numThreads = 1;
```

- [ ] **Step 4: 写加载验证测试(先失败)**

Create `tests/renderer/silero-load.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./vitest-ort-setup";
import * as ort from "onnxruntime-web";
import { resolve } from "path";

describe("silero_vad.onnx", () => {
  it("loads and exposes the Silero v5 tensor IO", async () => {
    const modelPath = resolve(__dirname, "../../src/renderer/assets/silero_vad.onnx");
    const session = await ort.InferenceSession.create(modelPath);
    // v5 inputs: input, state, sr (NOT v4's h/c)
    expect(session.inputNames).toEqual(expect.arrayContaining(["input", "state", "sr"]));
    expect(session.outputNames).toEqual(expect.arrayContaining(["output", "stateN"]));
  });
});
```

- [ ] **Step 5: 跑测试**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/silero-load.test.ts
```
Expected: PASS。

> **若 inputNames 显示 `h`/`c`(而非 `state`)** → 下到的是 v4 模型,URL 错。改用 v5:确认从 `snakers4/silero-vad` 的 `src/silero_vad/data/silero_vad.onnx`(master)下载。后续代码全部按 v5(`state`/`stateN`)。
> **若 wasm 加载报错** → 确认 `ort.env.wasm.wasmPaths` 指向 `node_modules/onnxruntime-web/dist/` 且以 `/` 结尾,`numThreads=1`。

- [ ] **Step 6: 配置 renderer 打包拷贝 ort wasm/mjs**

Modify `electron.vite.config.ts` — 在顶部加 import,在 `renderer.plugins` 加 static-copy:

```ts
import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/main" },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: "out/preload" },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [
      react(),
      viteStaticCopy({
        targets: [
          {
            src: "node_modules/onnxruntime-web/dist/*.wasm",
            dest: "ort",
          },
          {
            src: "node_modules/onnxruntime-web/dist/*.mjs",
            dest: "ort",
          },
        ],
      }),
    ],
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
```

- [ ] **Step 7: 验证构建不报错**

Run: `npm run build` (electron-vite build)
Expected: 构建成功,`out/renderer/ort/` 下出现 `*.wasm` 和 `*.mjs`。

```bash
ls out/renderer/ort/ | head
```

- [ ] **Step 8: 更新 CHANGELOG 并提交**

在 `CHANGELOG.md` 的 `## [Unreleased]` 下加(无该 section 则在文件顶部标题后新建):
```markdown
### Added
- Silero VAD: bundle onnxruntime-web + Silero v5 model, copy ORT wasm into renderer build.
```

提交(**add 与 commit 分两条命令,message 不含文件名**):
```bash
git add -A
```
```bash
git commit -m "chore: add onnxruntime-web and Silero v5 model with ORT wasm bundling"
```

---

### Task 2: `silero.ts` 推理封装

**Files:**
- Create: `src/renderer/vad/silero.ts`
- Create: `tests/renderer/silero.test.ts`

- [ ] **Step 1: 写测试(先失败)**

Create `tests/renderer/silero.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "./vitest-ort-setup";
import { resolve } from "path";
import { createSileroVad } from "../../src/renderer/vad/silero";

const MODEL = resolve(__dirname, "../../src/renderer/assets/silero_vad.onnx");

function silenceWindow(): Float32Array {
  return new Float32Array(512); // all zeros
}

describe("createSileroVad", () => {
  it("returns a probability in [0,1] for a window", async () => {
    const vad = await createSileroVad(MODEL);
    const p = await vad.process(silenceWindow());
    expect(typeof p).toBe("number");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it("scores silence as low speech probability", async () => {
    const vad = await createSileroVad(MODEL);
    let last = 1;
    for (let i = 0; i < 10; i++) last = await vad.process(silenceWindow());
    expect(last).toBeLessThan(0.5);
  });

  it("reset() makes the output sequence reproducible", async () => {
    const vad = await createSileroVad(MODEL);
    const noise = new Float32Array(512).map((_, i) => Math.sin(i) * 0.3);
    const a = await vad.process(noise);
    await vad.process(noise);
    vad.reset();
    const b = await vad.process(noise);
    expect(b).toBeCloseTo(a, 5); // same state (zero) → same first output
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/silero.test.ts
```
Expected: FAIL（`createSileroVad` not found）。

- [ ] **Step 3: 实现 `silero.ts`**

Create `src/renderer/vad/silero.ts`:

```ts
import * as ort from "onnxruntime-web";

const STATE_DIMS = [2, 1, 128] as const;
const STATE_SIZE = 2 * 1 * 128;
const WINDOW = 512;
const SR = 16000n;

export interface SileroVad {
  /** Feed one 512-sample float32 window; returns speech probability in [0,1]. */
  process(window: Float32Array): Promise<number>;
  /** Reset internal recurrent state (call at the start of a new recording). */
  reset(): void;
}

/**
 * Load the Silero v5 ONNX model and return a stateful VAD.
 * Throws if the model/wasm fail to load (caller handles fallback).
 */
export async function createSileroVad(modelUrl: string): Promise<SileroVad> {
  const session = await ort.InferenceSession.create(modelUrl);
  let state = new Float32Array(STATE_SIZE);
  const sr = new ort.Tensor("int64", BigInt64Array.from([SR]), []);

  return {
    async process(window: Float32Array): Promise<number> {
      if (window.length !== WINDOW) {
        throw new Error(`Silero window must be ${WINDOW} samples, got ${window.length}`);
      }
      const input = new ort.Tensor("float32", window, [1, WINDOW]);
      const stateTensor = new ort.Tensor("float32", state, [...STATE_DIMS]);
      const out = await session.run({ input, state: stateTensor, sr });
      state = out.stateN.data as Float32Array;
      return (out.output.data as Float32Array)[0];
    },
    reset(): void {
      state = new Float32Array(STATE_SIZE);
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/silero.test.ts
```
Expected: PASS（3 个用例）。

> 若 `out.stateN` / `out.output` 名称报 undefined,用 Task 1 Step 5 打印出的真实 outputNames 替换。

- [ ] **Step 5: 提交**

```bash
git add -A
```
```bash
git commit -m "feat: add Silero VAD onnxruntime-web wrapper"
```

---

### Task 3: `debounce.ts` 纯同步去抖器

把现有 `useVAD.ts` 的去抖逻辑抽成参数化的纯模块,可脱离 onnx 单测。

**Files:**
- Create: `src/renderer/vad/debounce.ts`
- Create: `tests/renderer/debounce.test.ts`

- [ ] **Step 1: 写测试(先失败)**

Create `tests/renderer/debounce.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSpeechDebouncer } from "../../src/renderer/vad/debounce";

function make(overrides = {}) {
  const onSpeechStart = vi.fn();
  const onSpeechEnd = vi.fn();
  const d = createSpeechDebouncer({
    speechFrames: 8,
    silenceFrames: 32,
    maxSpeechFrames: 938,
    onSpeechStart,
    onSpeechEnd,
    ...overrides,
  });
  return { d, onSpeechStart, onSpeechEnd };
}

describe("createSpeechDebouncer", () => {
  it("fires onSpeechStart after speechFrames consecutive speech frames", () => {
    const { d, onSpeechStart } = make();
    for (let i = 0; i < 7; i++) d.push(true);
    expect(onSpeechStart).not.toHaveBeenCalled();
    d.push(true); // 8th
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });

  it("ignores isolated speech blips shorter than speechFrames", () => {
    const { d, onSpeechStart } = make();
    for (let i = 0; i < 5; i++) d.push(true);
    d.push(false); // resets speech counter
    for (let i = 0; i < 5; i++) d.push(true);
    expect(onSpeechStart).not.toHaveBeenCalled();
  });

  it("fires onSpeechEnd after silenceFrames consecutive silence while speaking", () => {
    const { d, onSpeechStart, onSpeechEnd } = make();
    for (let i = 0; i < 8; i++) d.push(true); // start
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 31; i++) d.push(false);
    expect(onSpeechEnd).not.toHaveBeenCalled();
    d.push(false); // 32nd
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
  });

  it("forces a segment break (end+start) at maxSpeechFrames", () => {
    const { d, onSpeechStart, onSpeechEnd } = make({ maxSpeechFrames: 10 });
    for (let i = 0; i < 8; i++) d.push(true); // start (count 1..8)
    // continue speaking; continuous counter hits maxSpeechFrames
    for (let i = 0; i < 10; i++) d.push(true);
    expect(onSpeechEnd).toHaveBeenCalledTimes(1);
    expect(onSpeechStart).toHaveBeenCalledTimes(2); // initial + forced restart
  });

  it("reset() clears state so a new start requires speechFrames again", () => {
    const { d, onSpeechStart } = make();
    for (let i = 0; i < 8; i++) d.push(true);
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    d.reset();
    for (let i = 0; i < 7; i++) d.push(true);
    expect(onSpeechStart).toHaveBeenCalledTimes(1); // not yet
    d.push(true);
    expect(onSpeechStart).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/debounce.test.ts
```
Expected: FAIL（`createSpeechDebouncer` not found）。

- [ ] **Step 3: 实现 `debounce.ts`**

Create `src/renderer/vad/debounce.ts`:

```ts
export interface SpeechDebouncerOptions {
  /** Consecutive speech frames required to confirm speech start. */
  readonly speechFrames: number;
  /** Consecutive silence frames required to confirm speech end. */
  readonly silenceFrames: number;
  /** Max consecutive speech frames before forcing a segment break. */
  readonly maxSpeechFrames: number;
  readonly onSpeechStart?: () => void;
  readonly onSpeechEnd?: () => void;
}

export interface SpeechDebouncer {
  /** Push one frame's speech/silence decision. */
  push(isSpeech: boolean): void;
  /** Reset all counters and speaking state. */
  reset(): void;
}

/**
 * Frame-count debouncer extracted from the original energy VAD, parameterized
 * by frame thresholds so it works at any frame rate (256ms energy frames or
 * 32ms Silero windows).
 */
export function createSpeechDebouncer(opts: SpeechDebouncerOptions): SpeechDebouncer {
  let isSpeaking = false;
  let speechCount = 0;
  let silenceCount = 0;
  let continuousSpeech = 0;

  const start = () => {
    isSpeaking = true;
    opts.onSpeechStart?.();
  };
  const end = () => {
    isSpeaking = false;
    opts.onSpeechEnd?.();
  };

  return {
    push(isSpeech: boolean): void {
      if (isSpeech) {
        silenceCount = 0;
        speechCount++;
        if (isSpeaking) {
          continuousSpeech++;
          if (continuousSpeech >= opts.maxSpeechFrames) {
            continuousSpeech = 0;
            end();
            start();
          }
        } else if (speechCount >= opts.speechFrames) {
          continuousSpeech = 0;
          start();
        }
      } else {
        speechCount = 0;
        silenceCount++;
        if (isSpeaking && silenceCount >= opts.silenceFrames) {
          continuousSpeech = 0;
          end();
        }
      }
    },
    reset(): void {
      isSpeaking = false;
      speechCount = 0;
      silenceCount = 0;
      continuousSpeech = 0;
    },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/debounce.test.ts
```
Expected: PASS（5 个用例）。

- [ ] **Step 5: 提交**

```bash
git add -A
```
```bash
git commit -m "feat: add parameterized speech debouncer extracted from energy VAD"
```

---

### Task 4: 重写 `useVAD.ts`(Silero + 队列 + 能量 fallback + degraded)

**Files:**
- Modify: `src/renderer/hooks/useVAD.ts`(整文件重写)
- Create: `tests/renderer/useVAD.test.ts`

接口契约(必须保持向后兼容 + 新增):
- `useVAD(callbacks?: VADCallbacks, options?: VADOptions)`
- 返回 `{ isSpeaking, isLoaded, degraded, feedAudio(Int16Array), reset(), markLoaded() }`
- `VADOptions`(可注入,用于测试)= `{ modelUrl?: string; createVad?: (url: string) => Promise<SileroVad> }`

- [ ] **Step 1: 写测试(先失败)**

Create `tests/renderer/useVAD.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useVAD } from "../../src/renderer/hooks/useVAD";
import type { SileroVad } from "../../src/renderer/vad/silero";

// A fake Silero whose probability we control via a queue of values.
function fakeVadFactory(probs: number[]) {
  let i = 0;
  const vad: SileroVad = {
    async process() {
      const p = probs[Math.min(i, probs.length - 1)];
      i++;
      return p;
    },
    reset() {
      i = 0;
    },
  };
  return () => Promise.resolve(vad);
}

// 4096-sample int16 buffer = 8 Silero windows.
function buffer4096(): Int16Array {
  return new Int16Array(4096);
}

describe("useVAD with Silero", () => {
  it("fires onSpeechStart once enough speech windows accumulate", async () => {
    const onSpeechStart = vi.fn();
    // 8 windows per buffer, all prob 0.9 → speechFrames=8 reached within one buffer
    const { result } = renderHook(() =>
      useVAD({ onSpeechStart }, { createVad: fakeVadFactory([0.9]) }),
    );
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    await act(async () => {
      result.current.feedAudio(buffer4096());
      // allow the async inference queue to drain
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
    expect(result.current.degraded).toBe(false);
  });

  it("falls back to energy VAD and sets degraded when Silero fails to load", async () => {
    const onSpeechStart = vi.fn();
    const failing = () => Promise.reject(new Error("wasm boom"));
    const { result } = renderHook(() =>
      useVAD({ onSpeechStart }, { createVad: failing }),
    );
    await waitFor(() => expect(result.current.degraded).toBe(true));
    // loud buffer → energy path should fire after SPEECH_FRAMES(2) buffers
    const loud = new Int16Array(4096).fill(8000);
    await act(async () => {
      result.current.feedAudio(loud);
      result.current.feedAudio(loud);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onSpeechStart).toHaveBeenCalledTimes(1);
  });
});
```

> 若项目尚无 `@testing-library/react`,Step 0 先装:`npm install -D @testing-library/react @testing-library/dom`。先检查 `package.json` devDependencies。

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/useVAD.test.ts
```
Expected: FAIL(新接口/选项未实现)。

- [ ] **Step 3: 重写 `useVAD.ts`**

完整替换 `src/renderer/hooks/useVAD.ts`:

```ts
import { useState, useCallback, useRef, useEffect } from "react";
import { createSileroVad, type SileroVad } from "../vad/silero";
import { createSpeechDebouncer, type SpeechDebouncer } from "../vad/debounce";
// Bundled model URL (vite resolves to the hashed asset path at build time).
import sileroModelUrl from "../assets/silero_vad.onnx?url";

interface VADState {
  readonly isSpeaking: boolean;
  readonly isLoaded: boolean;
  /** True when Silero is unavailable and the energy fallback is active. */
  readonly degraded: boolean;
}

interface VADCallbacks {
  readonly onSpeechStart?: () => void;
  readonly onSpeechEnd?: () => void;
}

interface VADOptions {
  readonly modelUrl?: string;
  readonly createVad?: (url: string) => Promise<SileroVad>;
}

// Silero window granularity (512 samples @16kHz ≈ 32ms).
const WINDOW = 512;
const THRESHOLD = 0.5;
const SPEECH_WINDOWS = 8; // ~0.25s
const SILENCE_WINDOWS = 32; // ~1.0s
const MAX_SPEECH_WINDOWS = 938; // ~30s

// Energy fallback granularity (4096-sample buffers ≈ 256ms).
const ENERGY_THRESHOLD = 0.002;
const ENERGY_SPEECH_FRAMES = 2;
const ENERGY_SILENCE_FRAMES = 6;
const ENERGY_MAX_SPEECH_FRAMES = 120;

const MAX_BACKLOG = 64; // drop oldest windows beyond this (should never trigger)

export function useVAD(callbacks: VADCallbacks = {}, options: VADOptions = {}) {
  const [state, setState] = useState<VADState>({
    isSpeaking: false,
    isLoaded: false,
    degraded: false,
  });

  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const setSpeaking = useCallback((speaking: boolean) => {
    setState((prev) =>
      prev.isSpeaking === speaking ? prev : { ...prev, isSpeaking: speaking },
    );
  }, []);

  // Debouncers share the same speech start/end handlers.
  const makeDebouncer = useCallback(
    (speechFrames: number, silenceFrames: number, maxSpeechFrames: number) =>
      createSpeechDebouncer({
        speechFrames,
        silenceFrames,
        maxSpeechFrames,
        onSpeechStart: () => {
          setSpeaking(true);
          callbacksRef.current.onSpeechStart?.();
        },
        onSpeechEnd: () => {
          setSpeaking(false);
          callbacksRef.current.onSpeechEnd?.();
        },
      }),
    [setSpeaking],
  );

  const sileroRef = useRef<SileroVad | null>(null);
  const sileroDebouncerRef = useRef<SpeechDebouncer | null>(null);
  const energyDebouncerRef = useRef<SpeechDebouncer | null>(null);
  const degradedRef = useRef(false);

  // Async inference queue (preserves window order).
  const queueRef = useRef<Float32Array[]>([]);
  const pumpingRef = useRef(false);
  const remainderRef = useRef<Float32Array>(new Float32Array(0));

  if (sileroDebouncerRef.current === null) {
    sileroDebouncerRef.current = makeDebouncer(
      SPEECH_WINDOWS,
      SILENCE_WINDOWS,
      MAX_SPEECH_WINDOWS,
    );
  }
  if (energyDebouncerRef.current === null) {
    energyDebouncerRef.current = makeDebouncer(
      ENERGY_SPEECH_FRAMES,
      ENERGY_SILENCE_FRAMES,
      ENERGY_MAX_SPEECH_FRAMES,
    );
  }

  // Load Silero on mount.
  useEffect(() => {
    let cancelled = false;
    const create = options.createVad ?? createSileroVad;
    const url = options.modelUrl ?? sileroModelUrl;
    create(url)
      .then((vad) => {
        if (cancelled) return;
        sileroRef.current = vad;
        degradedRef.current = false;
        setState((prev) => ({ ...prev, isLoaded: true, degraded: false }));
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("Silero VAD unavailable, falling back to energy VAD:", err);
        degradedRef.current = true;
        setState((prev) => ({ ...prev, isLoaded: true, degraded: true }));
      });
    return () => {
      cancelled = true;
    };
    // options is intentionally read once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (queueRef.current.length > 0) {
        const win = queueRef.current.shift()!;
        const silero = sileroRef.current;
        if (!silero) break;
        let isSpeech = false;
        try {
          const prob = await silero.process(win);
          isSpeech = prob > THRESHOLD;
        } catch (err) {
          // Conservative: treat inference errors as silence.
          console.warn("Silero inference error, treating window as silence:", err);
          isSpeech = false;
        }
        sileroDebouncerRef.current!.push(isSpeech);
      }
    } finally {
      pumpingRef.current = false;
    }
  }, []);

  const feedAudioEnergy = useCallback((int16: Int16Array) => {
    let energy = 0;
    for (let i = 0; i < int16.length; i++) {
      const s = int16[i] / 32768.0;
      energy += s * s;
    }
    energy /= int16.length;
    energyDebouncerRef.current!.push(energy > ENERGY_THRESHOLD);
  }, []);

  const feedAudio = useCallback(
    (int16: Int16Array) => {
      if (degradedRef.current || !sileroRef.current) {
        if (degradedRef.current) feedAudioEnergy(int16);
        // If Silero not loaded yet (and not degraded), drop this buffer.
        return;
      }
      // int16 → float32
      const f = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 32768.0;

      // Concatenate remainder + new samples, slice into 512 windows.
      const prev = remainderRef.current;
      const data = new Float32Array(prev.length + f.length);
      data.set(prev);
      data.set(f, prev.length);

      let offset = 0;
      while (offset + WINDOW <= data.length) {
        queueRef.current.push(data.slice(offset, offset + WINDOW));
        offset += WINDOW;
      }
      remainderRef.current = data.slice(offset);

      // Drop oldest windows if backlog grows unexpectedly.
      if (queueRef.current.length > MAX_BACKLOG) {
        const drop = queueRef.current.length - MAX_BACKLOG;
        queueRef.current.splice(0, drop);
        console.warn(`VAD backlog overflow, dropped ${drop} windows`);
      }
      void pump();
    },
    [feedAudioEnergy, pump],
  );

  const reset = useCallback(() => {
    sileroRef.current?.reset();
    sileroDebouncerRef.current!.reset();
    energyDebouncerRef.current!.reset();
    queueRef.current = [];
    remainderRef.current = new Float32Array(0);
    setSpeaking(false);
  }, [setSpeaking]);

  // Retained for backward compatibility; loading is now driven by the model.
  const markLoaded = useCallback(() => {}, []);

  return {
    ...state,
    feedAudio,
    reset,
    markLoaded,
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run tests/renderer/useVAD.test.ts
```
Expected: PASS（2 个用例）。

- [ ] **Step 5: tsc 检查**

Run: `npx tsc --noEmit`
Expected: 无新增错误(`src/preload/index.ts` 的 "Cannot find name 'window'" 是既有,忽略)。

> 若报 `Cannot find module '*.onnx?url'`,在 `src/renderer/` 下的 vite env 声明文件(如 `src/renderer/vite-env.d.ts`;无则新建)加:
> ```ts
> /// <reference types="vite/client" />
> declare module "*.onnx?url" { const src: string; export default src; }
> ```

- [ ] **Step 6: 提交**

```bash
git add -A
```
```bash
git commit -m "feat: drive VAD with Silero model and keep energy fallback"
```

---

### Task 5: 接线 `reset()` + `degraded` banner

**Files:**
- Modify: `src/renderer/hooks/useSessionManagement.ts`(`handleStart` 调 `vad.reset()`)
- Modify: `src/renderer/App.tsx`(传 `vad.reset`/读 `degraded`,渲染 banner)

- [ ] **Step 1: 在录音开始时重置 VAD**

读 `src/renderer/hooks/useSessionManagement.ts`,定位 `handleStart`(约 196-260 行,内含 `clearSegments()` / `setSummaries([])` 等重置)。在该函数开始处(创建/切换 session 之前)加一行调用注入的 `vad.reset`。

`useSessionManagement` 通过 `p.current.vad` 访问 VAD(见 `:248` 的 `p.current.vad.feedAudio(pcm)`)。在 `handleStart` 内、清理状态那一组语句旁加:

```ts
p.current.vad.reset();
```

确认 `vad` 的传入类型(约 `:56-83` 的 props interface)包含 `reset`。在该 interface 的 `feedAudio` 声明旁补:

```ts
readonly reset: () => void;
```

- [ ] **Step 2: App.tsx 传 reset 并读 degraded**

读 `src/renderer/App.tsx`。`useVAD` 调用在 `:123`。把 `vad` 的 `reset`/`degraded` 传进 `useSessionManagement`(它已接收 `vad` 对象,确认对象里带上了 `reset`——因为 `useVAD` 已返回 `reset`,通常 `vad` 整体传入,无需改动;若是逐字段解构传入,则补 `reset` 字段)。

- [ ] **Step 3: 渲染 degraded banner**

在 `App.tsx` 的顶层返回 JSX 最外层容器内(标题栏附近)加一个条件 banner。先在组件内加 dismiss 状态:

```tsx
const [vadBannerDismissed, setVadBannerDismissed] = useState(false);
```

在主内容渲染处插入:

```tsx
{vad.degraded && !vadBannerDismissed && (
  <div
    style={{
      background: "#5a4a00",
      color: "#ffe08a",
      padding: "6px 12px",
      fontSize: 12,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
    }}
  >
    <span>高级降噪 VAD 不可用,已回退基础模式</span>
    <button
      onClick={() => setVadBannerDismissed(true)}
      style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}
    >
      ✕
    </button>
  </div>
)}
```

> 配色/位置按 `App.tsx` 现有样式风格微调,保持与现有 UI 一致即可,不要引入新样式系统。

- [ ] **Step 4: tsc + 全量测试**

Run: `npx tsc --noEmit`
Expected: 无新增错误。

Run(全量):
```bash
ELECTRON_RUN_AS_NODE=true ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run
```
Expected: 全绿,除既有的 audio-handlers 那条预存失败。

- [ ] **Step 5: 提交**

```bash
git add -A
```
```bash
git commit -m "feat: reset VAD on record start and show fallback banner"
```

---

### Task 6: CHANGELOG + 构建冒烟

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新 CHANGELOG**

在 `## [Unreleased]` 的 `### Added` / 新增 `### Changed` 下补:

```markdown
### Changed
- VAD now uses the Silero v5 neural model (onnxruntime-web, bundled & offline) instead of a fixed energy threshold, eliminating steady-noise (e.g. fan) false positives. Falls back to the energy VAD with a notice banner if the model fails to load.
```

- [ ] **Step 2: 生产构建冒烟**

Run: `npm run build`
Expected: 成功;`out/renderer/ort/*.wasm` 与模型 asset 均存在。

- [ ] **Step 3: 提交**

```bash
git add -A
```
```bash
git commit -m "docs: changelog for Silero VAD"
```

---

## 最终验收(全部任务后)

- [ ] `npx tsc --noEmit` 无新增错误。
- [ ] 全量 vitest 通过(仅既有 audio-handlers 一条预存失败)。
- [ ] `npm run build` 成功,`out/renderer/ort/` 含 wasm。
- [ ] 开 PR(不合并),留待用户早上 review;PR 描述含:选型理由(Silero/MIT、放弃 TEN VAD 的 license 原因)、renderer 内联方案、去抖常量、fallback 行为、**人工验证项**(对着风扇录音应不再持续误判;正常说话分段正常)。

## 人工验证(用户执行,PR 描述里写明)

1. `npm run dev`,对着风扇/空调录一段(无人声)→ 中间转录区不应再每 30s 蹦假转录。
2. 正常说话录一段 → speech 起止分段正常,转录正确。
3. (可选)临时把模型文件改名制造加载失败 → 出现降级 banner,录音仍工作。
