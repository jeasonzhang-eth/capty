# Refactor ipc-handlers.ts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Phase 2 uses git worktrees for parallel execution — see Phase 2 dispatch instructions.

**Goal:** Split the 3412-line `src/main/ipc-handlers.ts` God Module into 10 focused handler modules under `src/main/handlers/`, with TDD-driven unit tests for each, while preserving 100% of current behavior.

**Architecture:**
- Phase 1 (sequential): Setup directories, define shared `IpcDeps` interface, extract truly shared helpers (`assertPathWithin`, `spawn` wrapper).
- Phase 2 (parallel via 10 git worktrees): Each subagent creates ONE new handler module under `src/main/handlers/<domain>.ts` with unit tests. **No worktree modifies `src/main/ipc-handlers.ts`** — guaranteed zero conflicts.
- Phase 3 (sequential): Merge all 10 worktree branches into integration branch, then update `ipc-handlers.ts` to delegate to the new modules and delete the extracted code.

**Tech Stack:** TypeScript, Vitest (existing), Electron IPC, git worktrees.

---

## Base Branch & Worktree Layout

**Base branch:** `feat/e2e-playwright-smoke` (must be merged to `main` first OR refactor branches off it directly to inherit E2E protection).

**Decision:** Branch off `main` AFTER merging `feat/e2e-playwright-smoke` to `main`. This avoids stacking unmerged work.

**Worktree directory:** `/Users/zhangjie/Documents/Jeason的创作/code/capty-worktrees/`

```
capty-worktrees/
├── refactor-session/         (branch: refactor/handlers-session)
├── refactor-sidecar/         (branch: refactor/handlers-sidecar)
├── refactor-asr/             (branch: refactor/handlers-asr)
├── refactor-model/           (branch: refactor/handlers-model)
├── refactor-llm/             (branch: refactor/handlers-llm)
├── refactor-tts/             (branch: refactor/handlers-tts)
├── refactor-audio/           (branch: refactor/handlers-audio)
├── refactor-audio-download/  (branch: refactor/handlers-audio-download)
├── refactor-config/          (branch: refactor/handlers-config)
└── refactor-export/          (branch: refactor/handlers-export)
```

Each worktree branch is created from `refactor/ipc-handlers-base` (the integration branch from Phase 1).

---

## File Structure

**Final structure after refactor:**

```
src/main/
├── index.ts                  (unchanged — calls registerIpcHandlers)
├── ipc-handlers.ts           (~150 lines — only orchestration: imports + register calls)
├── handlers/
│   ├── types.ts              (IpcDeps interface — shared by all handler modules)
│   ├── session-handlers.ts   (~350 lines, 14 handlers)
│   ├── sidecar-handlers.ts   (~280 lines, 4 handlers + lifecycle state)
│   ├── asr-handlers.ts       (~150 lines, 4 handlers)
│   ├── model-handlers.ts     (~450 lines, 14 handlers)
│   ├── llm-handlers.ts       (~400 lines, 9 handlers)
│   ├── tts-handlers.ts       (~250 lines, 6 handlers)
│   ├── audio-handlers.ts     (~350 lines, 12 handlers)
│   ├── audio-download-handlers.ts (~400 lines, 5 handlers)
│   ├── config-handlers.ts    (~200 lines, 10 handlers)
│   └── export-handlers.ts    (~120 lines, 5 handlers)
└── shared/
    ├── path.ts               (assertPathWithin — used by audio, audio-download, model)
    └── spawn.ts              (spawn wrapper, getExtendedEnv — used by sidecar, audio-download, asr)

tests/main/
├── handlers/
│   ├── session-handlers.test.ts
│   ├── sidecar-handlers.test.ts
│   ├── asr-handlers.test.ts
│   ├── model-handlers.test.ts
│   ├── llm-handlers.test.ts
│   ├── tts-handlers.test.ts
│   ├── audio-handlers.test.ts
│   ├── audio-download-handlers.test.ts
│   ├── config-handlers.test.ts
│   └── export-handlers.test.ts
└── shared/
    ├── path.test.ts
    └── spawn.test.ts
```

**Handler-to-module mapping (canonical, must not change):**

| Module | IPC channels |
|--------|-------------|
| `session-handlers.ts` | `session:create`, `session:list`, `session:get`, `session:update`, `session:rename`, `session:delete`, `session:reorder`, `session:update-category`, `session-categories:list`, `session-categories:save`, `session-categories:delete`, `segment:add`, `segment:list`, `segment:delete-by-session` |
| `sidecar-handlers.ts` | `sidecar:get-url`, `sidecar:health-check`, `sidecar:start`, `sidecar:stop` (+ owns `sidecarProcess`, `_sidecarPid`, `_cachedSidecarPort`, `_sidecarStarting` module-level state, exports `killSidecar()`) |
| `asr-handlers.ts` | `asr:fetch-models`, `asr:test`, `asr:transcribe`, `audio:transcribe-file` |
| `model-handlers.ts` | `models:list`, `models:download`, `models:search`, `models:delete`, `models:save-meta`, `tts-models:list`, `tts-models:download`, `tts-models:search`, `tts-models:delete`, `tts-models:save-meta`, `download:pause`, `download:resume`, `download:cancel`, `download:list-incomplete` (+ owns `activeDownloads`, exports `migrateModelsDir()`) |
| `llm-handlers.ts` | `llm:fetch-models`, `llm:test`, `llm:summarize`, `llm:translate`, `llm:generate-title`, `summary:list`, `summary:delete`, `translation:list`, `translation:save`, `prompt-types:list`, `prompt-types:save` |
| `tts-handlers.ts` | `tts:check-provider`, `tts:list-voices`, `tts:speak`, `tts:speak-stream`, `tts:cancel-stream`, `tts:test`, `config:save-tts-settings` |
| `audio-handlers.ts` | `audio:stream-open`, `audio:stream-write`, `audio:stream-close`, `audio:save-segment`, `audio:save-full`, `audio:read-file`, `audio:get-file-path`, `audio:get-dir`, `audio:open-folder`, `audio:get-duration`, `audio:decode-file`, `audio:import` |
| `audio-download-handlers.ts` | `audio:download-start`, `audio:download-list`, `audio:download-remove`, `audio:download-cancel`, `audio:download-retry` |
| `config-handlers.ts` | `config:get`, `config:set`, `config:get-default-data-dir`, `app:get-config-dir`, `app:get-data-dir`, `app:open-config-dir`, `app:select-directory`, `layout:save`, `deps:check` |
| `export-handlers.ts` | `export:txt`, `export:srt`, `export:markdown`, `export:save-file`, `export:save-buffer` |

**Total: 84 handlers across 10 modules.** Each module is well under 500 lines (vs. 3412 before).

---

## Module Contract

**Every handler module MUST export a single `register(deps: IpcDeps): void` function.**

Example template (`src/main/handlers/_template.ts`):

```typescript
import { ipcMain } from "electron";
import type { IpcDeps } from "./types";

export function register(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

  ipcMain.handle("channel:name", async (_event, arg: string) => {
    // handler body — copied from ipc-handlers.ts
    return result;
  });

  // ... more ipcMain.handle calls
}
```

**Sidecar module additionally exports `killSidecar(): void` and module-level lifecycle state** (mirroring current behavior).

**Model module additionally exports `migrateModelsDir(dataDir: string): void`** (referenced by `src/main/index.ts`).

After Phase 3, `src/main/ipc-handlers.ts` is reduced to:

```typescript
import { register as registerSession } from "./handlers/session-handlers";
import { register as registerSidecar } from "./handlers/sidecar-handlers";
// ... 8 more imports
import type { IpcDeps } from "./handlers/types";

export function registerIpcHandlers(deps: IpcDeps): void {
  registerSession(deps);
  registerSidecar(deps);
  registerAsr(deps);
  registerModel(deps);
  registerLlm(deps);
  registerTts(deps);
  registerAudio(deps);
  registerAudioDownload(deps);
  registerConfig(deps);
  registerExport(deps);
}

// Re-export for backward compatibility with src/main/index.ts:
export { killSidecar } from "./handlers/sidecar-handlers";
export { migrateModelsDir } from "./handlers/model-handlers";
```

---

# Phase 1: Setup (Sequential)

## Task 1: Merge feat/e2e-playwright-smoke and create base branch

**Files:** none modified — git operations only.

- [ ] **Step 1: Verify E2E branch is clean and tests pass**

```bash
cd "/Users/zhangjie/Documents/Jeason的创作/code/capty"
git checkout feat/e2e-playwright-smoke
git status
```

Expected: `nothing to commit, working tree clean`

```bash
npm run test && npx playwright test
```

Expected: all 32 unit tests + 7 E2E tests pass.

- [ ] **Step 2: Push E2E branch and create PR (manual user action)**

Stop here and ask the user to:
1. `git push -u origin feat/e2e-playwright-smoke`
2. Open a PR on GitHub: `https://github.com/jeasonzhang-eth/capty/compare/main...feat/e2e-playwright-smoke`
3. Merge the PR to main
4. Confirm completion before continuing

(If user wants to skip the PR and just merge locally, that's acceptable too. Either way, `main` must contain the E2E infrastructure before continuing.)

- [ ] **Step 3: Update local main and create base branch**

```bash
git checkout main
git pull origin main
git checkout -b refactor/ipc-handlers-base
```

Expected: on `refactor/ipc-handlers-base` branch, identical to merged `main`.

- [ ] **Step 4: Verify tests still pass on base branch**

```bash
npm run build && npm run test && npx playwright test
```

Expected: all tests pass.

---

## Task 2: Create directory structure + IpcDeps interface

**Files:**
- Create: `src/main/handlers/types.ts`
- Create directories: `src/main/handlers/`, `src/main/shared/`, `tests/main/handlers/`, `tests/main/shared/`

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/main/handlers src/main/shared tests/main/handlers tests/main/shared
```

- [ ] **Step 2: Read current registerIpcHandlers signature**

```bash
grep -n "export function registerIpcHandlers" src/main/ipc-handlers.ts
```

Expected: locate the function signature, currently around line 1019. Read the surrounding ~10 lines to capture the exact `Deps` interface.

- [ ] **Step 3: Create types.ts with IpcDeps**

Create `src/main/handlers/types.ts`:

```typescript
import type Database from "better-sqlite3";
import type { BrowserWindow } from "electron";

/**
 * Shared dependencies passed to every handler module's `register()` function.
 * Mirrors the original `Deps` parameter of `registerIpcHandlers`.
 */
export interface IpcDeps {
  readonly db: Database.Database;
  readonly configDir: string;
  readonly getMainWindow: () => BrowserWindow | null;
}
```

If the original `Deps` interface in `ipc-handlers.ts` has additional fields, copy them verbatim.

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.node.json
```

Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/main/handlers/types.ts
git commit -m "refactor(handlers): add IpcDeps interface for handler modules"
```

Update `CHANGELOG.md` under 2026-04-13 `### Changed`:
```
- Refactor: introducing handler module structure (work in progress)
```

```bash
git add CHANGELOG.md
git commit --amend --no-edit
```

---

## Task 3: Extract shared/path.ts

**Files:**
- Create: `src/main/shared/path.ts`
- Create: `tests/main/shared/path.test.ts`

**Context:** `assertPathWithin` is used by 6+ handlers across 3 future modules (audio, audio-download, model). Extracting it now prevents duplication during parallel extraction.

- [ ] **Step 1: Find the current implementation**

```bash
grep -n "function assertPathWithin" src/main/ipc-handlers.ts
```

Expected: locate at line ~44. Read lines 44-54 to capture the function body.

- [ ] **Step 2: Write the failing test**

Create `tests/main/shared/path.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import path from "path";
import os from "os";
import fs from "fs";
import { assertPathWithin } from "../../../src/main/shared/path";

describe("assertPathWithin", () => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "path-test-"));

  it("allows path inside base", () => {
    const target = path.join(baseDir, "subdir", "file.txt");
    expect(() => assertPathWithin(baseDir, target)).not.toThrow();
  });

  it("allows the base path itself", () => {
    expect(() => assertPathWithin(baseDir, baseDir)).not.toThrow();
  });

  it("rejects path outside base", () => {
    const outside = path.join(os.tmpdir(), "outside.txt");
    expect(() => assertPathWithin(baseDir, outside)).toThrow();
  });

  it("rejects path that uses prefix bypass", () => {
    // /tmp/path-test-abc/../path-test-abc-evil/file.txt
    const evil = `${baseDir}-evil/file.txt`;
    expect(() => assertPathWithin(baseDir, evil)).toThrow();
  });

  it("rejects path with .. traversal", () => {
    const traversal = path.join(baseDir, "..", "..", "etc", "passwd");
    expect(() => assertPathWithin(baseDir, traversal)).toThrow();
  });
});
```

- [ ] **Step 3: Run test (expected to fail)**

```bash
npm run test -- tests/main/shared/path.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create shared/path.ts**

Create `src/main/shared/path.ts` by copying the `assertPathWithin` function from `src/main/ipc-handlers.ts:44-54`:

```typescript
import path from "path";

/**
 * Throw if `targetPath` resolves outside `basePath`.
 * Uses prefix-with-separator check to prevent bypass via sibling dirs sharing prefix.
 */
export function assertPathWithin(basePath: string, targetPath: string): void {
  const resolvedBase = path.resolve(basePath);
  const resolvedTarget = path.resolve(targetPath);
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(resolvedBase + path.sep)
  ) {
    throw new Error(`Path traversal detected: ${targetPath} is outside ${basePath}`);
  }
}
```

**NOTE:** This implementation also fixes Security issue S5 (prefix bypass) — the original used naive `startsWith` which fails the "prefix bypass" test. If the original implementation is naive, the test will catch it AND we get a security fix for free.

- [ ] **Step 5: Run test (expected to pass)**

```bash
npm run test -- tests/main/shared/path.test.ts
```

Expected: 5 PASS.

- [ ] **Step 6: Update ipc-handlers.ts to import from shared**

Edit `src/main/ipc-handlers.ts`:
- DELETE the inline `assertPathWithin` function (lines ~44-54)
- ADD at the top of the imports: `import { assertPathWithin } from "./shared/path";`

- [ ] **Step 7: Verify everything still works**

```bash
npm run build && npm run test
```

Expected: build succeeds, all 37 tests (32 + 5 new) pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/shared/path.ts \
        tests/main/shared/path.test.ts \
        src/main/ipc-handlers.ts \
        CHANGELOG.md
git commit -m "refactor: extract assertPathWithin to shared/path.ts with prefix-bypass fix"
```

---

## Task 4: Extract shared/spawn.ts

**Files:**
- Create: `src/main/shared/spawn.ts`
- Create: `tests/main/shared/spawn.test.ts`

**Context:** `spawn` and `getExtendedEnv` are used by sidecar lifecycle and audio-download. Extracting prevents duplication.

- [ ] **Step 1: Find current implementations**

```bash
grep -n "^function spawn\|^function getExtendedEnv" src/main/ipc-handlers.ts
```

Expected: locate at lines ~24 and ~32. Read lines 24-43 to get both functions.

- [ ] **Step 2: Write tests**

Create `tests/main/shared/spawn.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { getExtendedEnv } from "../../../src/main/shared/spawn";

describe("getExtendedEnv", () => {
  it("returns object with PATH including standard binary dirs", () => {
    const env = getExtendedEnv();
    expect(env.PATH).toBeDefined();
    expect(env.PATH).toContain("/usr/local/bin");
  });

  it("preserves existing PATH from process.env", () => {
    const env = getExtendedEnv();
    if (process.env.PATH) {
      // process.env.PATH should be a substring of the extended PATH
      const segments = process.env.PATH.split(":");
      expect(segments.every((seg) => env.PATH!.includes(seg))).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run test (expected to fail)**

```bash
npm run test -- tests/main/shared/spawn.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Create shared/spawn.ts**

Create `src/main/shared/spawn.ts` by copying both functions from `src/main/ipc-handlers.ts:24-43`. Add `export` to both.

```typescript
import { spawn as rawSpawn, type SpawnOptions, type ChildProcess } from "child_process";

/**
 * Returns process.env extended with standard binary search paths,
 * to ensure spawned processes can find tools like ffmpeg, yt-dlp.
 */
export function getExtendedEnv(): NodeJS.ProcessEnv {
  const extra = ["/usr/local/bin", "/opt/homebrew/bin", "/opt/homebrew/sbin"];
  const existing = process.env.PATH ?? "";
  const PATH = [...new Set([...existing.split(":"), ...extra])].filter(Boolean).join(":");
  return { ...process.env, PATH };
}

/**
 * Wrapper around child_process.spawn that uses extended PATH by default.
 */
export function spawn(
  command: string,
  args: ReadonlyArray<string> = [],
  options: SpawnOptions = {},
): ChildProcess {
  return rawSpawn(command, args as string[], {
    ...options,
    env: { ...getExtendedEnv(), ...(options.env ?? {}) },
  });
}
```

(Adapt to actual function bodies in `ipc-handlers.ts` — the code above is a guide; copy the real implementation.)

- [ ] **Step 5: Run test**

```bash
npm run test -- tests/main/shared/spawn.test.ts
```

Expected: 2 PASS.

- [ ] **Step 6: Update ipc-handlers.ts**

In `src/main/ipc-handlers.ts`:
- DELETE the inline `spawn` and `getExtendedEnv` functions (lines ~24-43)
- ADD to imports: `import { spawn, getExtendedEnv } from "./shared/spawn";`

- [ ] **Step 7: Verify everything still works**

```bash
npm run build && npm run test
```

Expected: all 39 tests (32 + 5 + 2) pass.

- [ ] **Step 8: Commit**

```bash
git add src/main/shared/spawn.ts \
        tests/main/shared/spawn.test.ts \
        src/main/ipc-handlers.ts
git commit -m "refactor: extract spawn helpers to shared/spawn.ts"
```

---

## Task 5: Push base branch and prepare worktrees

**Files:** none — git operations only.

- [ ] **Step 1: Push base branch**

```bash
git push -u origin refactor/ipc-handlers-base
```

- [ ] **Step 2: Create worktree directory**

```bash
mkdir -p "/Users/zhangjie/Documents/Jeason的创作/code/capty-worktrees"
```

- [ ] **Step 3: Create 10 worktrees with branches**

Run each command sequentially:

```bash
cd "/Users/zhangjie/Documents/Jeason的创作/code/capty"

for domain in session sidecar asr model llm tts audio audio-download config export; do
  git worktree add \
    "../capty-worktrees/refactor-${domain}" \
    -b "refactor/handlers-${domain}" \
    refactor/ipc-handlers-base
done
```

Expected: 10 worktrees created.

- [ ] **Step 4: Verify worktrees**

```bash
git worktree list
```

Expected: main worktree + 10 refactor worktrees, all on `refactor/handlers-<domain>` branches based on `refactor/ipc-handlers-base`.

---

# Phase 2: Parallel Extraction (10 Worktrees)

**Dispatch instructions for the controller:**

Use `superpowers:dispatching-parallel-agents`. Spawn 10 subagents in PARALLEL, each working in its own worktree directory. Each subagent gets the **shared task template** below, plus its specific `<DOMAIN>` and handler list.

**Critical constraint for ALL parallel agents:**
- DO NOT modify `src/main/ipc-handlers.ts`
- DO NOT modify `src/main/index.ts`
- ONLY create files in `src/main/handlers/<domain>-handlers.ts` and `tests/main/handlers/<domain>-handlers.test.ts`
- DO NOT modify any file outside `src/main/handlers/` and `tests/main/handlers/`
- This guarantees zero merge conflicts in Phase 3

---

## Shared Task Template (Tasks 6-15, one per domain)

For each domain in the handler-to-module mapping, dispatch a subagent with:

**Working directory:** `/Users/zhangjie/Documents/Jeason的创作/code/capty-worktrees/refactor-<DOMAIN>`

**Branch:** `refactor/handlers-<DOMAIN>` (already checked out in this worktree)

### Step 1: Read source handlers from ipc-handlers.ts

The agent reads `src/main/ipc-handlers.ts` to find each `ipcMain.handle("<channel>", ...)` block listed in the domain's handler set. The agent maps:
- Channel names → handler bodies
- Helpers used by those handlers (functions defined elsewhere in ipc-handlers.ts)
- Imports needed (from existing imports at the top of ipc-handlers.ts)

### Step 2: Write the failing tests

Create `tests/main/handlers/<DOMAIN>-handlers.test.ts`. Tests must:
- Mock `ipcMain` to capture registered handlers
- Mock `IpcDeps` with stub `db`, `configDir`, `getMainWindow`
- For each handler, write at least one test that verifies the channel is registered AND that calling the handler returns expected output for a simple input

Example pattern (using vitest's `vi.mock`):

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ipcMain } from "electron";
import type { IpcDeps } from "../../../src/main/handlers/types";

vi.mock("electron", () => {
  const handlers = new Map<string, Function>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: Function) => {
        handlers.set(channel, fn);
      }),
      __getHandler: (channel: string) => handlers.get(channel),
      __reset: () => handlers.clear(),
    },
  };
});

describe("<DOMAIN>-handlers", () => {
  let deps: IpcDeps;

  beforeEach(() => {
    (ipcMain as any).__reset();
    deps = {
      db: createInMemoryDb(),  // helper that creates a real better-sqlite3 in-memory DB
      configDir: "/tmp/test-config",
      getMainWindow: () => null,
    };
  });

  it("registers all expected channels", async () => {
    const { register } = await import("../../../src/main/handlers/<DOMAIN>-handlers");
    register(deps);
    expect((ipcMain as any).__getHandler("<channel:name>")).toBeDefined();
    // ... assert each channel
  });

  it("<channel:name> handler returns expected result", async () => {
    const { register } = await import("../../../src/main/handlers/<DOMAIN>-handlers");
    register(deps);
    const handler = (ipcMain as any).__getHandler("<channel:name>");
    const result = await handler({}, /* args */);
    expect(result).toEqual(/* expected */);
  });
});
```

For DB-touching handlers, use `createInMemoryDb()` (helper to write in `tests/main/handlers/_test-utils.ts`):

```typescript
import Database from "better-sqlite3";
import { createDatabase } from "../../../src/main/database";

export function createInMemoryDb(): Database.Database {
  return createDatabase(":memory:");
}
```

**Test coverage target per module:** at least one test per handler. Aim for 80% line coverage minimum.

### Step 3: Run tests (expected to fail)

```bash
npm run test -- tests/main/handlers/<DOMAIN>-handlers.test.ts
```

Expected: FAIL — module not found.

### Step 4: Create the handler module

Create `src/main/handlers/<DOMAIN>-handlers.ts`:

```typescript
import { ipcMain } from "electron";
import type { IpcDeps } from "./types";
// ... domain-specific imports (copied from ipc-handlers.ts top)

// ... domain-specific helpers (copied from ipc-handlers.ts, kept private to this module)

export function register(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

  ipcMain.handle("<channel:name>", async (_event, ...args) => {
    // body copied verbatim from ipc-handlers.ts
  });

  // ... all other channels for this domain
}
```

**Special exports:**
- `sidecar-handlers.ts` ALSO exports `killSidecar(): void` (currently exported from ipc-handlers.ts, used by `src/main/index.ts`)
- `model-handlers.ts` ALSO exports `migrateModelsDir(dataDir: string): void` (currently exported from ipc-handlers.ts, used by `src/main/index.ts`)

### Step 5: Run tests (expected to pass)

```bash
npm run test -- tests/main/handlers/<DOMAIN>-handlers.test.ts
```

Expected: all PASS.

### Step 6: Verify build still works

```bash
npm run build
```

Expected: build succeeds. (This compiles the entire app — including the now-duplicated code in both ipc-handlers.ts and handlers/<DOMAIN>-handlers.ts. That's fine; Phase 3 will deduplicate.)

### Step 7: Commit

```bash
git add src/main/handlers/<DOMAIN>-handlers.ts \
        tests/main/handlers/<DOMAIN>-handlers.test.ts \
        tests/main/handlers/_test-utils.ts  # if created/modified
git commit -m "refactor: extract <DOMAIN>-handlers from ipc-handlers.ts"
```

### Step 8: Push branch

```bash
git push -u origin refactor/handlers-<DOMAIN>
```

### Step 9: Report back

Report:
- Channels registered (must match the handler list for this domain)
- Number of tests written + passing
- Lines of code in the new handler file
- Any helpers that were copied (and noted as candidates for future extraction to `shared/`)
- Any concerns (e.g., handler relied on shared module-level state that needs special handling)

---

## Task 6: Extract session-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-session`
**Branch:** `refactor/handlers-session`
**Domain:** `session`
**Handlers:** `session:create`, `session:list`, `session:get`, `session:update`, `session:rename`, `session:delete`, `session:reorder`, `session:update-category`, `session-categories:list`, `session-categories:save`, `session-categories:delete`, `segment:add`, `segment:list`, `segment:delete-by-session`

Follow the **Shared Task Template** above with these specifics. No special exports.

## Task 7: Extract sidecar-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-sidecar`
**Branch:** `refactor/handlers-sidecar`
**Domain:** `sidecar`
**Handlers:** `sidecar:get-url`, `sidecar:health-check`, `sidecar:start`, `sidecar:stop`

**Special:** Also extract module-level state (`sidecarProcess`, `_sidecarPid`, `_cachedSidecarPort`, `_sidecarStarting`) and helper functions (`findSidecarBin`, `parseSidecarPort`, `getSidecarPort`, `getSidecarBaseUrl`, `waitForHealth`, `findSidecarPidsOnPort`). These move into `sidecar-handlers.ts`.

**Special export:** `export function killSidecar(): void` — preserves existing API.

## Task 8: Extract asr-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-asr`
**Branch:** `refactor/handlers-asr`
**Domain:** `asr`
**Handlers:** `asr:fetch-models`, `asr:test`, `asr:transcribe`, `audio:transcribe-file`

## Task 9: Extract model-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-model`
**Branch:** `refactor/handlers-model`
**Domain:** `model`
**Handlers:** `models:list`, `models:download`, `models:search`, `models:delete`, `models:save-meta`, `tts-models:list`, `tts-models:download`, `tts-models:search`, `tts-models:delete`, `tts-models:save-meta`, `download:pause`, `download:resume`, `download:cancel`, `download:list-incomplete`

**Special:** Also extract `activeDownloads` map and helpers (`readRecommendedFile`, `readRecommendedModels`, `readRecommendedTtsModels`, `readModelMeta`, `KNOWN_STT_TYPES`, `KNOWN_TTS_TYPES`, `inferModelTypeFromDir`, `isModelSttSupported`, `writeModelMeta`, `loadAsrModels`, `loadTtsModels`, `inferModelType`, `inferTtsModelType`, `inferSttSupportFromHF`).

**Special export:** `export function migrateModelsDir(dataDir: string): void` — preserves existing API.

## Task 10: Extract llm-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-llm`
**Branch:** `refactor/handlers-llm`
**Domain:** `llm`
**Handlers:** `llm:fetch-models`, `llm:test`, `llm:summarize`, `llm:translate`, `llm:generate-title`, `summary:list`, `summary:delete`, `translation:list`, `translation:save`, `prompt-types:list`, `prompt-types:save`

## Task 11: Extract tts-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-tts`
**Branch:** `refactor/handlers-tts`
**Domain:** `tts`
**Handlers:** `tts:check-provider`, `tts:list-voices`, `tts:speak`, `tts:speak-stream`, `tts:cancel-stream`, `tts:test`, `config:save-tts-settings`

**Special:** `normalizeTtsUrl` helper from ipc-handlers.ts moves into this module.

## Task 12: Extract audio-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-audio`
**Branch:** `refactor/handlers-audio`
**Domain:** `audio`
**Handlers:** `audio:stream-open`, `audio:stream-write`, `audio:stream-close`, `audio:save-segment`, `audio:save-full`, `audio:read-file`, `audio:get-file-path`, `audio:get-dir`, `audio:open-folder`, `audio:get-duration`, `audio:decode-file`, `audio:import`

**Special:** `convertToWav` helper moves into this module. Use `assertPathWithin` from `shared/path.ts`.

## Task 13: Extract audio-download-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-audio-download`
**Branch:** `refactor/handlers-audio-download`
**Domain:** `audio-download`
**Handlers:** `audio:download-start`, `audio:download-list`, `audio:download-remove`, `audio:download-cancel`, `audio:download-retry`

**Special:** Helpers `extractSource`, `parseYtdlpProgress`, `isXiaoyuzhouUrl`, `fetchXiaoyuzhouEpisode`, `httpDownload` move into this module. Use `spawn` from `shared/spawn.ts`.

## Task 14: Extract config-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-config`
**Branch:** `refactor/handlers-config`
**Domain:** `config`
**Handlers:** `config:get`, `config:set`, `config:get-default-data-dir`, `app:get-config-dir`, `app:get-data-dir`, `app:open-config-dir`, `app:select-directory`, `layout:save`, `deps:check`

## Task 15: Extract export-handlers (parallel)

**Worktree:** `capty-worktrees/refactor-export`
**Branch:** `refactor/handlers-export`
**Domain:** `export`
**Handlers:** `export:txt`, `export:srt`, `export:markdown`, `export:save-file`, `export:save-buffer`

---

# Phase 3: Integration (Sequential)

## Task 16: Merge all worktree branches into integration branch

**Files:** `src/main/ipc-handlers.ts`, possibly `CHANGELOG.md`

**Working directory:** `/Users/zhangjie/Documents/Jeason的创作/code/capty` (main worktree)

- [ ] **Step 1: Switch back to base branch**

```bash
cd "/Users/zhangjie/Documents/Jeason的创作/code/capty"
git checkout refactor/ipc-handlers-base
```

- [ ] **Step 2: Merge each handler branch in order**

```bash
for domain in session sidecar asr model llm tts audio audio-download config export; do
  git merge --no-ff -m "merge: refactor/handlers-${domain}" "refactor/handlers-${domain}"
done
```

Expected: all 10 merges succeed without conflicts (since each only added files in `src/main/handlers/` and `tests/main/handlers/`).

If conflicts occur: STOP and report. Most likely cause is two agents creating the same file (`tests/main/handlers/_test-utils.ts`); resolve by accepting the better version.

- [ ] **Step 3: Verify all unit tests pass with both old and new code present**

```bash
npm run test
```

Expected: 32 original + ~80-100 new handler tests pass. (Old ipc-handlers.ts code is still present, so handler logic exists in two places; both call the same DB and produce the same results — they can't both register the same channel without conflict, but at this point only ipc-handlers.ts is wired into `index.ts`, so no double-registration occurs.)

- [ ] **Step 4: Read current ipc-handlers.ts**

```bash
wc -l src/main/ipc-handlers.ts
```

Expected: ~3400 lines.

- [ ] **Step 5: Replace ipc-handlers.ts with delegating version**

Overwrite `src/main/ipc-handlers.ts` with this exact content:

```typescript
import { register as registerSession } from "./handlers/session-handlers";
import { register as registerSidecar } from "./handlers/sidecar-handlers";
import { register as registerAsr } from "./handlers/asr-handlers";
import { register as registerModel } from "./handlers/model-handlers";
import { register as registerLlm } from "./handlers/llm-handlers";
import { register as registerTts } from "./handlers/tts-handlers";
import { register as registerAudio } from "./handlers/audio-handlers";
import { register as registerAudioDownload } from "./handlers/audio-download-handlers";
import { register as registerConfig } from "./handlers/config-handlers";
import { register as registerExport } from "./handlers/export-handlers";
import type { IpcDeps } from "./handlers/types";

/**
 * Register all IPC handlers. Each domain has its own module under handlers/.
 * Add new handlers to the appropriate module, not here.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  registerSession(deps);
  registerSidecar(deps);
  registerAsr(deps);
  registerModel(deps);
  registerLlm(deps);
  registerTts(deps);
  registerAudio(deps);
  registerAudioDownload(deps);
  registerConfig(deps);
  registerExport(deps);
}

// Re-exports for src/main/index.ts:
export { killSidecar } from "./handlers/sidecar-handlers";
export { migrateModelsDir } from "./handlers/model-handlers";
```

- [ ] **Step 6: Verify build works**

```bash
npm run build
```

Expected: succeeds. If TypeScript complains about missing imports in `src/main/index.ts`, check that `killSidecar` and `migrateModelsDir` are correctly re-exported.

- [ ] **Step 7: Run all unit tests**

```bash
npm run test
```

Expected: all tests pass.

- [ ] **Step 8: Run all E2E tests**

```bash
npx playwright test
```

Expected: all 7 E2E tests pass. **This is the critical regression check** — the entire IPC layer was just rewired, and E2E tests verify the renderer can still talk to the main process.

- [ ] **Step 9: Verify line count reduction**

```bash
wc -l src/main/ipc-handlers.ts
wc -l src/main/handlers/*.ts
```

Expected:
- `ipc-handlers.ts`: ~30 lines (was 3412)
- `handlers/*.ts`: 10 files, each 100-500 lines

- [ ] **Step 10: Update CHANGELOG**

Add to `CHANGELOG.md` under 2026-04-13 `### Changed`:

```markdown
- **Architecture refactor**: Split monolithic `src/main/ipc-handlers.ts` (3412 lines) into 10 focused handler modules under `src/main/handlers/`:
  - `session-handlers`, `sidecar-handlers`, `asr-handlers`, `model-handlers`, `llm-handlers`, `tts-handlers`, `audio-handlers`, `audio-download-handlers`, `config-handlers`, `export-handlers`
  - Each module owns its IPC channels + private helpers + has unit tests (~80 new tests)
  - Shared utilities extracted to `src/main/shared/` (`path.ts`, `spawn.ts`)
  - `assertPathWithin` hardened with prefix-bypass fix (security S5)
- IPC handler unit test coverage increased from 13 tests to ~100+
```

- [ ] **Step 11: Commit the integration**

```bash
git add src/main/ipc-handlers.ts CHANGELOG.md
git commit -m "refactor: ipc-handlers.ts now delegates to handlers/* modules"
```

- [ ] **Step 12: Run full test suite one more time**

```bash
npm run build && npm run test && npx playwright test
```

Expected: all green.

- [ ] **Step 13: Push integration branch**

```bash
git push -u origin refactor/ipc-handlers-base
```

- [ ] **Step 14: Open PR (manual user action)**

Stop and ask user to:
1. Open PR: `https://github.com/jeasonzhang-eth/capty/compare/main...refactor/ipc-handlers-base`
2. Review the changes (will be ~3400 line deletion + ~3400 line addition across 13+ new files)
3. Merge when satisfied

---

## Task 17: Cleanup worktrees

**Files:** none — git operations only.

**Run after PR is merged.**

- [ ] **Step 1: Remove worktrees**

```bash
cd "/Users/zhangjie/Documents/Jeason的创作/code/capty"
for domain in session sidecar asr model llm tts audio audio-download config export; do
  git worktree remove "../capty-worktrees/refactor-${domain}"
done
git worktree prune
```

- [ ] **Step 2: Delete merged branches**

```bash
git branch -d refactor/ipc-handlers-base
for domain in session sidecar asr model llm tts audio audio-download config export; do
  git branch -d "refactor/handlers-${domain}"
done
```

Expected: all 11 branches deleted.

- [ ] **Step 3: Remove empty worktree directory**

```bash
rmdir "/Users/zhangjie/Documents/Jeason的创作/code/capty-worktrees" 2>/dev/null || true
```

---

# Self-Review Notes

**Spec coverage check:**
- ✅ All 84 IPC handlers from current `ipc-handlers.ts` mapped to a target module
- ✅ Special exports (`killSidecar`, `migrateModelsDir`) preserved
- ✅ Module-level state (sidecar lifecycle, activeDownloads) assigned to specific modules
- ✅ Shared helpers (`assertPathWithin`, `spawn`) extracted to avoid duplication
- ✅ TDD discipline enforced (tests fail before implementation in every task)
- ✅ E2E suite as final regression gate

**Risk register:**
- **Risk: Two parallel agents create the same `_test-utils.ts`** — Mitigation: Phase 3 Step 2 calls this out, accept the better version.
- **Risk: Worktree branch missed a handler** — Mitigation: Phase 3 Step 7 (E2E) fails if any channel is unregistered (renderer would error on IPC call).
- **Risk: Module-level state initialization order** — Sidecar lifecycle uses module-level vars; the new module must initialize them at import time, not inside `register()`. Spec'd in Task 7.
- **Risk: Helpers used by multiple domains end up duplicated** — Acceptable for first refactor pass; future cleanup task can extract more to `shared/`. Common helpers (`assertPathWithin`, `spawn`) already extracted in Phase 1.

**Out of scope (deferred to later plans):**
- Splitting App.tsx (renderer side)
- IPC type contracts (`src/shared/ipc-types.ts`)
- Database migration versioning fix (A4)
- Security HIGH fixes other than S5 (which is fixed for free in Task 3)
