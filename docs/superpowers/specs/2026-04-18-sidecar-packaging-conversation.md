# Brainstorming Conversation — Sidecar Packaging Refactor

**Date:** 2026-04-18
**Skill:** superpowers:brainstorming
**Outcome:** Design approved (see `2026-04-18-sidecar-packaging-refactor-design.md`)

---

## User's opening questions

> 进入 capty 目录，查看当前项目是如何进行打包分发的？现在的实现方式是否优雅？是否利用到了 uv 包管理器进行打包？是否有可以改进的地方？是否可以使用 makefile 来简化流程？

## Claude's audit findings

**Architecture:** Electron (TS/React) + Python sidecar (FastAPI + mlx-audio).

**Current packaging flow:**
1. `sidecar/build.sh` → PyInstaller onedir → `sidecar/dist/capty-sidecar/`
2. electron-builder includes sidecar via `extraResources`
3. Output: arm64 DMG

**Elegance assessment:**

| Aspect | Verdict |
|--------|---------|
| PyInstaller onedir + extraResources | ✅ Standard |
| uv adoption in build | ⚠️ Only dev (uv.lock present); build still uses `source .venv/bin/activate` + `pip install pyinstaller` |
| PyInstaller dependency declaration | ⚠️ Not in pyproject.toml |
| Multi-arch | ⚠️ arm64 only (later: correct for mlx) |
| Signing / notarization | ⚠️ entitlements set but no notarize hook |
| Orchestration | ⚠️ npm scripts + one bash script |

**Makefile recommendation:** No. With only 3-4 tasks, npm scripts suffice. If orchestration grows, prefer `just` over Makefile (no tab traps, friendlier for non-C projects).

**Improvement priorities (ROI):**
1. Use uv to manage PyInstaller (highest ROI)
2. Convert `build.sh` to `uv sync && uv run pyinstaller`
3. Add universal/x64 target (later removed — see decision below)
4. Add notarization

---

## Decision points

### Q1 — Which approach for the uv refactor?

Options presented:
- **A.** Minimal — keep `build.sh`, swap internals to uv
- **B.** Drop `build.sh`, npm script becomes single entry (Claude's recommendation)
- **C.** Introduce `justfile`

**User chose: A**

User also corrected Claude on multi-arch: mlx is Apple Silicon only, so x86_64 / universal builds are not needed. Improvement #3 dropped from scope.

### Q2 — Apple Developer account status?

Options:
- (a) Have account + Developer ID cert installed
- (b) Have account, cert status unclear
- (c) No account
- (d) Skip notarization, ship unsigned

**User answered: (c)** — no Apple Developer account.

### Q3 — How to handle notarization given no account?

Options:
- (a) Defer entirely; TODO in spec
- (b) Scaffold only — config + afterSign script template + docs, inert until env vars set (Claude's recommendation)
- (c) Add ad-hoc local sign (`codesign --sign -`)

**User chose: (b)**

### Additional request

> 你要把我们的谈话内容记录下来

→ This document.

---

## Final scope

1. **§1** Sidecar build refactor — uv + dev group, rewrite `build.sh`
2. **§2** Notarization scaffold — `@electron/notarize` + afterSign hook + docs (inert)
3. **§3** Docs — design doc + this conversation transcript

## Section approval log

- §1 (sidecar build refactor) — approved
- §2 (notarization scaffold) — approved
- §3 (docs) — approved
- Overall design — approved → moving to writing-plans
