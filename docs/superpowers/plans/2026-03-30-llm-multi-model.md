# LLM Multi-Model Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each LLM provider to hold multiple models (fetched from /models API or manually added), with a unified model selector for each feature.

**Architecture:** Extend `LlmProvider` interface with `models: string[]`. Add `llm:fetch-models` IPC handler. Replace per-feature `selectedXxxProviderId` with `{ providerId, model }` objects. Build a reusable `UnifiedModelSelector` component and a `FetchModelsDialog` modal.

**Tech Stack:** Electron + React + TypeScript, OpenAI-compatible `/models` API

---

## File Map

| File | Role |
|------|------|
| `src/main/config.ts` | Data model: `LlmProvider.models`, new config fields, migration |
| `src/main/ipc-handlers.ts` | `llm:fetch-models` handler, update `llm:translate`/`llm:summarize`/`llm:generate-title` to accept explicit model param |
| `src/preload/index.ts` | Expose `llmFetchModels`, update `translate`/`summarize`/`generateTitle` signatures |
| `src/renderer/components/SettingsModal.tsx` | Provider edit models list, `FetchModelsDialog`, `UnifiedModelSelector`, `DefaultModelsTab` refactor |
| `src/renderer/App.tsx` | State migration, new selection types, pass model to IPC calls |
| `src/renderer/components/TranscriptArea.tsx` | Update translate menu to use unified model selector |
| `README.md` | Changelog |

---

### Task 1: Update Data Model — `config.ts`

**Files:**
- Modify: `src/main/config.ts:11-18` (LlmProvider interface)
- Modify: `src/main/config.ts:70-90` (AppConfig interface)
- Modify: `src/main/config.ts:112-152` (DEFAULT_CONFIG)
- Modify: `src/main/config.ts:154-220` (readConfig — add migration)

- [ ] **Step 1: Add `models` field to `LlmProvider`**

In `src/main/config.ts`, change the `LlmProvider` interface (lines 11-18):

```typescript
export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;         // kept for migration compat
  readonly models: string[];      // NEW: full model list
  readonly isPreset: boolean;
}
```

- [ ] **Step 2: Add new selection fields to `AppConfig`**

In `src/main/config.ts`, add after line 78 (`selectedLlmProviderId`):

```typescript
readonly selectedSummaryModel: { providerId: string; model: string } | null;
readonly selectedTranslateModel: { providerId: string; model: string } | null;
readonly selectedRapidModel: { providerId: string; model: string } | null;
```

Keep `selectedLlmProviderId` for migration reading.

- [ ] **Step 3: Update DEFAULT_CONFIG**

In `src/main/config.ts`, add to `DEFAULT_CONFIG` (after `selectedLlmProviderId: null`):

```typescript
selectedSummaryModel: null,
selectedTranslateModel: null,
selectedRapidModel: null,
```

- [ ] **Step 4: Add migration logic to `readConfig`**

In `src/main/config.ts`, inside `readConfig`, after the existing ASR migration block (line 211) and before the final return (line 213), add LLM provider migration:

```typescript
// Migrate LLM providers: add models[] from model
const migratedConfig = {
  ...DEFAULT_CONFIG,
  ...(parsed as Partial<AppConfig>),
};
if (migratedConfig.llmProviders) {
  let needsMigration = false;
  const migratedProviders = migratedConfig.llmProviders.map((p: any) => {
    if (!p.models || p.models.length === 0) {
      if (p.model) {
        needsMigration = true;
        return { ...p, models: [p.model] };
      }
      return { ...p, models: [] };
    }
    return p;
  });
  if (needsMigration) {
    migratedConfig.llmProviders = migratedProviders;
  }
}

// Migrate selectedLlmProviderId → selectedSummaryModel
if (
  (parsed as any).selectedLlmProviderId &&
  !migratedConfig.selectedSummaryModel
) {
  const pid = (parsed as any).selectedLlmProviderId as string;
  const prov = migratedConfig.llmProviders.find((p: any) => p.id === pid);
  if (prov) {
    migratedConfig.selectedSummaryModel = {
      providerId: prov.id,
      model: prov.model || prov.models?.[0] || "",
    };
  }
}
if (
  (parsed as any).selectedTranslateLlmProviderId &&
  !migratedConfig.selectedTranslateModel
) {
  const pid = (parsed as any).selectedTranslateLlmProviderId as string;
  const prov = migratedConfig.llmProviders.find((p: any) => p.id === pid);
  if (prov) {
    migratedConfig.selectedTranslateModel = {
      providerId: prov.id,
      model: prov.model || prov.models?.[0] || "",
    };
  }
}
if (
  (parsed as any).selectedRapidLlmProviderId &&
  !migratedConfig.selectedRapidModel
) {
  const pid = (parsed as any).selectedRapidLlmProviderId as string;
  const prov = migratedConfig.llmProviders.find((p: any) => p.id === pid);
  if (prov) {
    migratedConfig.selectedRapidModel = {
      providerId: prov.id,
      model: prov.model || prov.models?.[0] || "",
    };
  }
}

return migratedConfig;
```

Replace the old return statement (`return { ...DEFAULT_CONFIG, ...(parsed as Partial<AppConfig>) };`) with the migration block above.

- [ ] **Step 5: Commit**

```bash
git add src/main/config.ts
git commit -m "feat: add models[] to LlmProvider and selection migration"
```

---

### Task 2: Add `llm:fetch-models` IPC Handler

**Files:**
- Modify: `src/main/ipc-handlers.ts` (add handler after `llm:test` at ~line 1759)
- Modify: `src/preload/index.ts` (add `llmFetchModels`)

- [ ] **Step 1: Add `llm:fetch-models` handler**

In `src/main/ipc-handlers.ts`, add after the `llm:test` handler (after line 1759):

```typescript
  // LLM: fetch available models from provider
  ipcMain.handle(
    "llm:fetch-models",
    async (_event, provider: { baseUrl: string; apiKey: string }) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const headers: Record<string, string> = {};
      if (provider.apiKey)
        headers["Authorization"] = `Bearer ${provider.apiKey}`;

      const endpoints = [`${baseUrl}/v1/models`, `${baseUrl}/models`];

      for (const url of endpoints) {
        try {
          const resp = await net.fetch(url, {
            headers,
            signal: AbortSignal.timeout(15000), // 15s — some providers (OpenRouter) are slow
          });
          if (!resp.ok) continue;
          const data = await resp.json();

          // OpenAI format: {data: [{id, ...}, ...]}
          if (data.data && Array.isArray(data.data)) {
            return data.data.map((m: { id: string }) => ({
              id: m.id,
              name: m.id,
            }));
          }
          // Array format: [{id, name?, ...}, ...]
          if (Array.isArray(data)) {
            return data.map((m: { id: string; name?: string }) => ({
              id: m.id,
              name: m.name || m.id,
            }));
          }
        } catch {
          continue;
        }
      }
      return [];
    },
  );
```

- [ ] **Step 2: Expose in preload**

In `src/preload/index.ts`, add after the `asrFetchModels` entry (line 67):

```typescript
  llmFetchModels: (provider: { baseUrl: string; apiKey: string }) =>
    ipcRenderer.invoke("llm:fetch-models", provider) as Promise<
      Array<{ id: string; name: string }>
    >,
```

- [ ] **Step 3: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload/index.ts
git commit -m "feat: add llm:fetch-models IPC handler"
```

---

### Task 3: Update IPC Handlers to Accept Explicit Model Param

**Files:**
- Modify: `src/main/ipc-handlers.ts:1637-1692` (llm:translate)
- Modify: `src/main/ipc-handlers.ts:1412-1570` (llm:summarize)
- Modify: `src/main/ipc-handlers.ts:1572-1634` (llm:generate-title)
- Modify: `src/preload/index.ts:322-347` (translate, summarize, generateTitle signatures)

- [ ] **Step 1: Update `llm:translate` to accept model param**

In `src/main/ipc-handlers.ts`, change the `llm:translate` handler signature (line 1639-1644) to:

```typescript
    async (
      _event,
      providerId: string,
      model: string,
      text: string,
      targetLanguage: string,
      promptTemplate: string,
    ) => {
```

Remove the `apiKey` check (line 1656-1658: `if (!provider.apiKey) { throw ... }`).

Change the request body (line 1673) from `model: provider.model` to `model: model`.

Update the Authorization header to be conditional (lines 1668-1671):

```typescript
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
```

- [ ] **Step 2: Update `llm:summarize` to accept model param**

In `src/main/ipc-handlers.ts`, change the `llm:summarize` handler signature (line 1415-1419) to:

```typescript
      _event,
      sessionId: number,
      providerId: string,
      model: string,
      promptType: string,
```

Remove the `apiKey` check (line 1432-1434).

Update `model: provider.model` to `model: model` (line 1464).

Update `actualModel = provider.model` to `actualModel = model` (line 1491).

Make Authorization header conditional (same pattern as translate).

- [ ] **Step 3: Update `llm:generate-title` to accept model param**

In `src/main/ipc-handlers.ts`, change the `llm:generate-title` handler signature (line 1575-1579) to:

```typescript
      _event,
      sessionId: number,
      providerId: string,
      model: string,
      systemPrompt: string,
```

Remove the `apiKey` check (line 1591-1593).

Update `model: provider.model` to `model: model` (line 1610).

Make Authorization header conditional.

- [ ] **Step 4: Update preload signatures**

In `src/preload/index.ts`, update `summarize` (line 322):

```typescript
  summarize: (sessionId: number, providerId: string, model: string, promptType: string) =>
    ipcRenderer.invoke("llm:summarize", sessionId, providerId, model, promptType),
```

Update `generateTitle` (line 324):

```typescript
  generateTitle: (
    sessionId: number,
    providerId: string,
    model: string,
    systemPrompt: string,
  ) =>
    ipcRenderer.invoke(
      "llm:generate-title",
      sessionId,
      providerId,
      model,
      systemPrompt,
    ) as Promise<string>,
```

Update `translate` (line 335):

```typescript
  translate: (
    providerId: string,
    model: string,
    text: string,
    targetLanguage: string,
    promptTemplate: string,
  ) =>
    ipcRenderer.invoke(
      "llm:translate",
      providerId,
      model,
      text,
      targetLanguage,
      promptTemplate,
    ) as Promise<string>,
```

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc-handlers.ts src/preload/index.ts
git commit -m "feat: accept explicit model param in LLM IPC handlers"
```

---

### Task 4: Update App.tsx State Management

**Files:**
- Modify: `src/renderer/App.tsx:181-196` (state declarations)
- Modify: `src/renderer/App.tsx:379-409` (config load)
- Modify: `src/renderer/App.tsx:1147-1196` (change handlers)
- Modify: `src/renderer/App.tsx:1198-1270` (handleTranslate)
- Modify: `src/renderer/App.tsx:1323-1365` (handleAiRename)
- Modify: `src/renderer/App.tsx:1592-1614` (handleSummarize)

- [ ] **Step 1: Replace state declarations**

In `src/renderer/App.tsx`, replace the provider ID states (lines 183-190):

```typescript
  // Old: single provider ID per feature
  // const [selectedLlmProviderId, setSelectedLlmProviderId] = useState<string | null>(null);
  // const [selectedRapidLlmProviderId, setSelectedRapidLlmProviderId] = useState<string | null>(null);
  // const [selectedTranslateLlmProviderId, setSelectedTranslateLlmProviderId] = useState<string | null>(null);

  // New: provider + model pair per feature
  type ModelSelection = { providerId: string; model: string } | null;
  const [selectedSummaryModel, setSelectedSummaryModel] =
    useState<ModelSelection>(null);
  const [selectedTranslateModel, setSelectedTranslateModel] =
    useState<ModelSelection>(null);
  const [selectedRapidModel, setSelectedRapidModel] =
    useState<ModelSelection>(null);
```

- [ ] **Step 2: Update config load**

In `src/renderer/App.tsx`, replace the LLM provider restoration block (lines 384-397) with:

```typescript
        // Restore LLM providers
        const savedProviders = config.llmProviders as LlmProvider[] | undefined;
        if (savedProviders?.length) {
          setLlmProviders(savedProviders);
        }
        // Restore model selections (new format)
        if (config.selectedSummaryModel) {
          setSelectedSummaryModel(
            config.selectedSummaryModel as ModelSelection,
          );
        }
        if (config.selectedTranslateModel) {
          setSelectedTranslateModel(
            config.selectedTranslateModel as ModelSelection,
          );
        }
        if (config.selectedRapidModel) {
          setSelectedRapidModel(config.selectedRapidModel as ModelSelection);
        }
```

- [ ] **Step 3: Update change handlers**

Replace `handleChangeLlmProvider`, `handleChangeRapidLlmProvider`, `handleChangeTranslateLlmProvider` (lines 1147-1178):

```typescript
  const handleChangeSummaryModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedSummaryModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedSummaryModel: selection,
      });
    },
    [],
  );

  const handleChangeRapidModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedRapidModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedRapidModel: selection,
      });
    },
    [],
  );

  const handleChangeTranslateModel = useCallback(
    async (selection: { providerId: string; model: string }) => {
      setSelectedTranslateModel(selection);
      const config = await window.capty.getConfig();
      await window.capty.setConfig({
        ...config,
        selectedTranslateModel: selection,
      });
    },
    [],
  );
```

- [ ] **Step 4: Update `handleTranslate`**

In `src/renderer/App.tsx`, update `handleTranslate` (around lines 1206-1236). Replace the provider lookup:

```typescript
      // Resolve provider + model for translation
      const sel = selectedTranslateModel;
      const provider = sel
        ? llmProviders.find((p) => p.id === sel.providerId)
        : llmProviders.find((p) => p.models?.length > 0);
      if (!provider) {
        console.warn("Translate: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;
```

Update the `translate` call (line 1231-1235):

```typescript
          const result = await window.capty.translate(
            provider.id,
            modelToUse,
            seg.text,
            targetLanguage,
            translatePrompt,
          );
```

- [ ] **Step 5: Update `handleAiRename`**

In `src/renderer/App.tsx`, update `handleAiRename` (around lines 1327-1339). Replace provider lookup:

```typescript
      const sel = selectedRapidModel;
      const provider = sel
        ? llmProviders.find((p) => p.id === sel.providerId)
        : llmProviders.find((p) => p.models?.length > 0);
      if (!provider) {
        console.warn("AI rename: no LLM provider configured");
        return;
      }
      const modelToUse = sel?.model || provider.models[0] || provider.model;
```

Update the `generateTitle` call:

```typescript
        const rawTitle = await window.capty.generateTitle(
          sessionId,
          provider.id,
          modelToUse,
          rapidRenamePrompt,
        );
```

- [ ] **Step 6: Update `handleSummarize`**

In `src/renderer/App.tsx`, update `handleSummarize` (around lines 1592-1613). The providerId is passed in from SummaryPanel. Update the call to include model:

The `handleSummarize` callback currently takes `(providerId: string, promptType: string)`. Change it to `(providerId: string, model: string, promptType: string)`:

```typescript
  const handleSummarize = useCallback(
    async (providerId: string, model: string, promptType: string) => {
      if (!store.currentSessionId || isGeneratingSummary) return;
      setStreamingContent("");
      setIsGeneratingSummary(true);
      setGeneratingPromptType(promptType);
      setGenerateError(null);
      try {
        const result = await window.capty.summarize(
          store.currentSessionId,
          providerId,
          model,
          promptType,
        );
        setSummaries((prev) => [...prev, result as Summary]);
        setStreamingContent("");
        // Remember last used model selection
        setSelectedSummaryModel({ providerId, model });
        const config = await window.capty.getConfig();
        await window.capty.setConfig({
          ...config,
          selectedSummaryModel: { providerId, model },
        });
      } catch (err) {
```

- [ ] **Step 7: Update props passed to child components**

Update all prop references from old names to new names throughout the JSX. Replace:
- `selectedLlmProviderId` → `selectedSummaryModel`
- `selectedRapidLlmProviderId` → `selectedRapidModel`
- `selectedTranslateLlmProviderId` → `selectedTranslateModel`
- `onChangeLlmProvider={handleChangeLlmProvider}` → `onChangeSummaryModel={handleChangeSummaryModel}`
- `onChangeRapidLlmProvider` → `onChangeRapidModel={handleChangeRapidModel}`
- `onChangeTranslateLlmProvider` → `onChangeTranslateModel={handleChangeTranslateModel}`

For TranscriptArea props, pass the new model selection:
```typescript
selectedTranslateModel={selectedTranslateModel}
onChangeTranslateModel={handleChangeTranslateModel}
```

For SummaryPanel props:
```typescript
selectedSummaryModel={selectedSummaryModel}
onSummarize={handleSummarize}
```

- [ ] **Step 7b: Handle edge case — selected model removed from provider**

When `llmProviders` changes (e.g., user removes a model from a provider), validate that current selections still exist. Add a `useEffect` in `App.tsx`:

```typescript
  // Validate model selections when providers change
  useEffect(() => {
    const validateSelection = (
      sel: ModelSelection,
      setSel: (s: ModelSelection) => void,
    ): void => {
      if (!sel) return;
      const provider = llmProviders.find((p) => p.id === sel.providerId);
      if (!provider) {
        setSel(null);
        return;
      }
      const models = provider.models?.length ? provider.models : provider.model ? [provider.model] : [];
      if (!models.includes(sel.model)) {
        // Fallback to first model in provider, or clear
        if (models.length > 0) {
          setSel({ providerId: provider.id, model: models[0] });
        } else {
          setSel(null);
        }
      }
    };
    validateSelection(selectedSummaryModel, setSelectedSummaryModel);
    validateSelection(selectedTranslateModel, setSelectedTranslateModel);
    validateSelection(selectedRapidModel, setSelectedRapidModel);
  }, [llmProviders]);
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/App.tsx
git commit -m "feat: update App.tsx state to use provider+model selections"
```

---

### Task 5: Build `FetchModelsDialog` Component

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx` (add new component)

- [ ] **Step 1: Add FetchModelsDialog component**

In `src/renderer/components/SettingsModal.tsx`, add before the `LanguageModelsTab` function:

```typescript
/* ─── Fetch Models Dialog ─── */

function FetchModelsDialog({
  providerName,
  fetchedModels,
  existingModels,
  onAdd,
  onClose,
  onRefresh,
  isRefreshing,
}: {
  readonly providerName: string;
  readonly fetchedModels: readonly { id: string; name: string }[];
  readonly existingModels: readonly string[];
  readonly onAdd: (modelId: string) => void;
  readonly onClose: () => void;
  readonly onRefresh: () => void;
  readonly isRefreshing: boolean;
}): React.ReactElement {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const existingSet = new Set(existingModels);

  // Filter by search
  const filtered = search
    ? fetchedModels.filter(
        (m) =>
          m.id.toLowerCase().includes(search.toLowerCase()) ||
          m.name.toLowerCase().includes(search.toLowerCase()),
      )
    : fetchedModels;

  // Grouping logic
  const shouldGroup = filtered.length > 20;

  const groups: { name: string; models: typeof filtered }[] = [];
  if (shouldGroup) {
    const groupMap = new Map<string, typeof filtered>();
    for (const m of filtered) {
      const slashIdx = m.id.indexOf("/");
      const groupName =
        slashIdx > 0 ? m.id.substring(0, slashIdx) : providerName;
      if (!groupMap.has(groupName)) groupMap.set(groupName, []);
      groupMap.get(groupName)!.push(m);
    }
    for (const [name, models] of groupMap) {
      groups.push({ name, models });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    groups.push({ name: "", models: filtered });
  }

  const toggleGroup = (name: string): void => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const getInitial = (modelId: string): string => {
    const slashIdx = modelId.indexOf("/");
    const name = slashIdx > 0 ? modelId.substring(0, slashIdx) : modelId;
    return name.charAt(0).toUpperCase();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "var(--bg-primary, #1a1a1a)",
          borderRadius: "12px",
          width: "520px",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          border: "1px solid var(--border, #333)",
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 16px",
            borderBottom: "1px solid var(--border, #333)",
          }}
        >
          <span
            style={{
              fontSize: "15px",
              fontWeight: 600,
              color: "var(--text-primary, #ccc)",
            }}
          >
            {providerName} Models
          </span>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted, #888)",
              cursor: "pointer",
              fontSize: "18px",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Search bar */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border, #333)",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: "var(--bg-surface, #222)",
              border: "1px solid var(--border, #333)",
              borderRadius: "8px",
              padding: "8px 12px",
            }}
          >
            <span style={{ color: "var(--text-muted, #666)", fontSize: "14px" }}>
              🔍
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search model ID or name..."
              style={{
                flex: 1,
                background: "none",
                border: "none",
                outline: "none",
                color: "var(--text-primary, #ccc)",
                fontSize: "13px",
              }}
            />
          </div>
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-muted, #888)",
              cursor: isRefreshing ? "default" : "pointer",
              fontSize: "18px",
              padding: "4px",
              opacity: isRefreshing ? 0.5 : 1,
            }}
            title="Refresh"
          >
            ↻
          </button>
        </div>

        {/* Model list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {filtered.length === 0 && (
            <div
              style={{
                padding: "24px",
                textAlign: "center",
                color: "var(--text-muted, #666)",
                fontSize: "13px",
              }}
            >
              {isRefreshing
                ? "Fetching models..."
                : "No models found"}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.name || "__flat"}>
              {/* Group header (only if grouping) */}
              {shouldGroup && (
                <div
                  onClick={() => toggleGroup(group.name)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "10px 16px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--border, #222)",
                  }}
                >
                  <span
                    style={{
                      color: "var(--text-muted, #555)",
                      fontSize: "10px",
                      marginRight: "8px",
                    }}
                  >
                    {collapsedGroups.has(group.name) ? "▶" : "▼"}
                  </span>
                  <span
                    style={{
                      color: "var(--text-primary, #ccc)",
                      fontSize: "13px",
                      fontWeight: 500,
                    }}
                  >
                    {group.name}
                  </span>
                  <span
                    style={{
                      background: "rgba(74,222,128,0.15)",
                      color: "#4ade80",
                      fontSize: "11px",
                      padding: "1px 8px",
                      borderRadius: "10px",
                      marginLeft: "8px",
                    }}
                  >
                    {group.models.length}
                  </span>
                </div>
              )}
              {/* Model rows */}
              {!collapsedGroups.has(group.name) && (
                <div style={{ padding: shouldGroup ? "0 16px 8px" : "0 16px" }}>
                  {group.models.map((m) => {
                    const isAdded = existingSet.has(m.id);
                    return (
                      <div
                        key={m.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          padding: "8px 12px",
                          marginBottom: "4px",
                          background: isAdded
                            ? "rgba(139,139,240,0.08)"
                            : "var(--bg-surface, #1e1e1e)",
                          borderRadius: "8px",
                          opacity: isAdded ? 0.5 : 1,
                        }}
                      >
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "50%",
                            background: "rgba(139,139,240,0.15)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "var(--accent, #8b8bf0)",
                            fontSize: "12px",
                            fontWeight: 700,
                            marginRight: "10px",
                            flexShrink: 0,
                          }}
                        >
                          {getInitial(m.id)}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                            color: "var(--text-primary, #ddd)",
                            fontSize: "13px",
                            fontFamily: "monospace",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {m.id}
                        </div>
                        {isAdded ? (
                          <span
                            style={{
                              color: "var(--text-muted, #555)",
                              fontSize: "11px",
                              marginLeft: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            Added
                          </span>
                        ) : (
                          <button
                            onClick={() => onAdd(m.id)}
                            style={{
                              background: "rgba(139,139,240,0.15)",
                              color: "var(--accent, #8b8bf0)",
                              border: "1px solid rgba(139,139,240,0.3)",
                              borderRadius: "50%",
                              width: "24px",
                              height: "24px",
                              fontSize: "16px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                              lineHeight: 1,
                              marginLeft: "8px",
                            }}
                          >
                            +
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx
git commit -m "feat: add FetchModelsDialog component"
```

---

### Task 6: Update `LanguageModelsTab` — Model List + Fetch

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx` (LanguageModelsTab function, lines 2839-3299)

- [ ] **Step 1: Update editForm and add fetch state**

In `LanguageModelsTab`, update the `editForm` state (line 2848-2853) and add new state:

```typescript
  const [editForm, setEditForm] = useState({
    name: "",
    baseUrl: "",
    apiKey: "",
    models: [] as string[],
  });
  const [showFetchDialog, setShowFetchDialog] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<
    { id: string; name: string }[]
  >([]);
  const [isFetching, setIsFetching] = useState(false);
  const [manualModelInput, setManualModelInput] = useState("");
```

- [ ] **Step 2: Update handleAddPreset and handleAddCustom**

In `handleAddPreset` (line 2872), add `models: []` to `newProvider`:
```typescript
      const newProvider: LlmProvider = {
        id: preset.id,
        name: preset.name,
        baseUrl: preset.baseUrl,
        apiKey: "",
        model: "",
        models: [],
        isPreset: true,
      };
```

And update `setEditForm`:
```typescript
      setEditForm({
        name: newProvider.name,
        baseUrl: newProvider.baseUrl,
        apiKey: "",
        models: [],
      });
```

Same for `handleAddCustom` — add `models: []` to newProvider and editForm.

- [ ] **Step 3: Add fetch and model management handlers**

Add these handlers inside `LanguageModelsTab`:

```typescript
  const handleFetchModels = useCallback(async () => {
    if (!editForm.baseUrl) return;
    setIsFetching(true);
    try {
      const models = await window.capty.llmFetchModels({
        baseUrl: editForm.baseUrl,
        apiKey: editForm.apiKey,
      });
      setFetchedModels(models);
      setShowFetchDialog(true);
    } catch (err) {
      console.warn("Failed to fetch models:", err);
      setFetchedModels([]);
      setShowFetchDialog(true);
    } finally {
      setIsFetching(false);
    }
  }, [editForm.baseUrl, editForm.apiKey]);

  const handleAddModelFromFetch = useCallback(
    (modelId: string) => {
      if (editForm.models.includes(modelId)) return;
      setEditForm((prev) => ({
        ...prev,
        models: [...prev.models, modelId],
      }));
    },
    [editForm.models],
  );

  const handleRemoveModel = useCallback((modelId: string) => {
    setEditForm((prev) => ({
      ...prev,
      models: prev.models.filter((m) => m !== modelId),
    }));
  }, []);

  const handleAddManualModel = useCallback(() => {
    const trimmed = manualModelInput.trim();
    if (!trimmed || editForm.models.includes(trimmed)) return;
    setEditForm((prev) => ({
      ...prev,
      models: [...prev.models, trimmed],
    }));
    setManualModelInput("");
  }, [manualModelInput, editForm.models]);
```

- [ ] **Step 4: Update edit-start to load models from provider**

When editing starts (setting `editingId` + `editForm`), load models. Find where `setEditForm` is called with existing provider data and include `models`:

```typescript
      setEditForm({
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        models: provider.models ?? (provider.model ? [provider.model] : []),
      });
```

- [ ] **Step 5: Update save handler**

When saving (the Save button's `onClick`), update to save `models` and set `model` to first model:

```typescript
const updated = providers.map((p) =>
  p.id === editingId
    ? {
        ...p,
        name: editForm.name,
        baseUrl: editForm.baseUrl,
        apiKey: editForm.apiKey,
        model: editForm.models[0] ?? "",
        models: editForm.models,
      }
    : p,
);
```

- [ ] **Step 6: Replace "Model Name" input with Models section**

Replace the current model text input in the edit form (where `editForm.model` input is) with the Models section UI:

```tsx
{/* Models Section */}
<div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
      <span style={{ fontSize: "14px", color: "var(--text-primary)", fontWeight: 600 }}>Models</span>
      <span style={{ background: "rgba(139,139,240,0.15)", color: "var(--accent)", fontSize: "11px", padding: "1px 8px", borderRadius: "10px" }}>
        {editForm.models.length}
      </span>
    </div>
    <button
      onClick={handleFetchModels}
      disabled={!editForm.baseUrl || isFetching}
      style={{
        background: "rgba(139,139,240,0.1)",
        color: "var(--accent)",
        border: "1px solid rgba(139,139,240,0.3)",
        borderRadius: "4px",
        padding: "3px 12px",
        fontSize: "12px",
        cursor: !editForm.baseUrl || isFetching ? "default" : "pointer",
        opacity: !editForm.baseUrl || isFetching ? 0.5 : 1,
      }}
    >
      {isFetching ? "Fetching..." : "↻ Fetch Models"}
    </button>
  </div>

  {/* Model list */}
  {editForm.models.length > 0 && (
    <div style={{ background: "var(--bg-surface, #1e1e1e)", border: "1px solid var(--border)", borderRadius: "8px", overflow: "hidden", marginBottom: "10px" }}>
      {editForm.models.map((modelId, idx) => (
        <div
          key={modelId}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: idx < editForm.models.length - 1 ? "1px solid var(--border-muted, #2a2a2a)" : undefined,
          }}
        >
          <span style={{ color: "var(--text-primary)", fontSize: "13px", fontFamily: "monospace" }}>{modelId}</span>
          <button
            onClick={() => handleRemoveModel(modelId)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )}

  {/* Manual add */}
  <div style={{ display: "flex", gap: "8px" }}>
    <input
      type="text"
      value={manualModelInput}
      onChange={(e) => setManualModelInput(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") handleAddManualModel(); }}
      placeholder="Type model name to add..."
      style={{
        flex: 1,
        background: "var(--bg-surface, #2a2a2a)",
        border: "1px solid var(--border)",
        borderRadius: "6px",
        padding: "6px 10px",
        color: "var(--text-primary)",
        fontSize: "12px",
        fontFamily: "monospace",
        outline: "none",
      }}
    />
    <button
      onClick={handleAddManualModel}
      disabled={!manualModelInput.trim()}
      style={{
        background: "rgba(139,139,240,0.1)",
        color: "var(--accent)",
        border: "1px solid rgba(139,139,240,0.3)",
        borderRadius: "4px",
        padding: "4px 12px",
        fontSize: "12px",
        cursor: manualModelInput.trim() ? "pointer" : "default",
        opacity: manualModelInput.trim() ? 1 : 0.5,
        whiteSpace: "nowrap",
      }}
    >
      + Add
    </button>
  </div>
</div>
```

- [ ] **Step 7: Add API Key optional label**

Update the API Key label from `"API Key"` to:
```tsx
<span>API Key <span style={{ color: "var(--text-muted)", fontSize: "11px" }}>(optional for local models)</span></span>
```

- [ ] **Step 8: Remove "Configured" / "Not configured" status display**

Find and remove the status badge that shows "Configured" or "Not configured" in the provider list items.

- [ ] **Step 9: Render FetchModelsDialog**

At the end of `LanguageModelsTab`'s return, before the closing `</>`, add:

```tsx
{showFetchDialog && (
  <FetchModelsDialog
    providerName={providers.find((p) => p.id === editingId)?.name ?? ""}
    fetchedModels={fetchedModels}
    existingModels={editForm.models}
    onAdd={handleAddModelFromFetch}
    onClose={() => setShowFetchDialog(false)}
    onRefresh={handleFetchModels}
    isRefreshing={isFetching}
  />
)}
```

- [ ] **Step 10: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx
git commit -m "feat: update LanguageModelsTab with model list and fetch dialog"
```

---

### Task 7: Build `UnifiedModelSelector` and Update `DefaultModelsTab`

**Files:**
- Modify: `src/renderer/components/SettingsModal.tsx`

- [x] **Step 1: Add UnifiedModelSelector component**

Add before `DefaultModelsTab`:

```typescript
/* ─── Unified Model Selector ─── */

function UnifiedModelSelector({
  providers,
  selected,
  onChange,
  onGearClick,
}: {
  readonly providers: readonly LlmProvider[];
  readonly selected: { providerId: string; model: string } | null;
  readonly onChange: (sel: { providerId: string; model: string }) => void;
  readonly onGearClick?: () => void;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearch("");
      }
    };
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Build flat list: all models from all providers that have models
  const allModels: { providerId: string; providerName: string; model: string }[] = [];
  for (const p of providers) {
    const models = p.models?.length ? p.models : p.model ? [p.model] : [];
    for (const m of models) {
      allModels.push({ providerId: p.id, providerName: p.name, model: m });
    }
  }

  // Filter
  const filtered = search
    ? allModels.filter(
        (m) =>
          m.model.toLowerCase().includes(search.toLowerCase()) ||
          m.providerName.toLowerCase().includes(search.toLowerCase()),
      )
    : allModels;

  // Group by provider
  const groups = new Map<string, typeof filtered>();
  for (const m of filtered) {
    if (!groups.has(m.providerName)) groups.set(m.providerName, []);
    groups.get(m.providerName)!.push(m);
  }

  // Find current selection display
  const selectedEntry = selected
    ? allModels.find(
        (m) => m.providerId === selected.providerId && m.model === selected.model,
      )
    : null;

  const getInitial = (name: string): string => name.charAt(0).toUpperCase();

  return (
    <div ref={dropdownRef} style={{ position: "relative", marginRight: onGearClick ? "40px" : 0 }}>
      {/* Closed state */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "var(--bg-primary)",
          border: `1px solid ${isOpen ? "var(--accent)" : "var(--border)"}`,
          borderRadius: isOpen ? "6px 6px 0 0" : "6px",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          cursor: "pointer",
          fontSize: "13px",
        }}
      >
        {selectedEntry ? (
          <>
            <div
              style={{
                width: "18px",
                height: "18px",
                borderRadius: "50%",
                background: "rgba(139,139,240,0.15)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent)",
                fontSize: "9px",
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {getInitial(selectedEntry.providerName)}
            </div>
            <span
              style={{
                color: "var(--text-primary)",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedEntry.model}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "12px", flexShrink: 0 }}>
              {selectedEntry.providerName}
            </span>
          </>
        ) : (
          <span style={{ color: "var(--text-muted)" }}>Select a model...</span>
        )}
        <span style={{ color: "var(--text-muted)", marginLeft: "auto", flexShrink: 0 }}>
          {isOpen ? "▴" : "▾"}
        </span>
      </div>

      {/* Gear button — navigates to Language Models settings tab */}
      {onGearClick && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onGearClick();
          }}
          style={{
            position: "absolute",
            right: "-36px",
            top: "50%",
            transform: "translateY(-50%)",
            background: "var(--bg-primary)",
            border: "1px solid var(--border)",
            borderRadius: "6px",
            padding: "6px",
            cursor: "pointer",
            color: "var(--text-muted)",
            display: "flex",
            alignItems: "center",
          }}
          title="Configure providers"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        </button>
      )}

      {/* Dropdown */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "var(--bg-surface, #1e1e1e)",
            border: "1px solid var(--accent)",
            borderTop: "1px solid var(--border)",
            borderRadius: "0 0 6px 6px",
            maxHeight: "280px",
            overflowY: "auto",
            zIndex: 1000,
          }}
        >
          {/* Search */}
          <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              autoFocus
              style={{
                width: "100%",
                background: "var(--bg-primary, #1a1a1a)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                padding: "4px 8px",
                color: "var(--text-primary)",
                fontSize: "12px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Grouped items */}
          {allModels.length === 0 && (
            <div style={{ padding: "12px", textAlign: "center", color: "var(--text-muted)", fontSize: "12px" }}>
              No models available. Add models in Language Models tab.
            </div>
          )}
          {Array.from(groups).map(([providerName, models]) => (
            <div key={providerName}>
              <div
                style={{
                  padding: "6px 12px 2px",
                  color: "var(--text-muted)",
                  fontSize: "11px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                {providerName}
              </div>
              {models.map((m) => {
                const isSelected =
                  selected?.providerId === m.providerId &&
                  selected?.model === m.model;
                return (
                  <div
                    key={`${m.providerId}-${m.model}`}
                    onClick={() => {
                      onChange({ providerId: m.providerId, model: m.model });
                      setIsOpen(false);
                      setSearch("");
                    }}
                    style={{
                      padding: "6px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      background: isSelected
                        ? "rgba(139,139,240,0.1)"
                        : "transparent",
                    }}
                  >
                    <div
                      style={{
                        width: "18px",
                        height: "18px",
                        borderRadius: "50%",
                        background: "rgba(139,139,240,0.15)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--accent)",
                        fontSize: "9px",
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {getInitial(m.providerName)}
                    </div>
                    <span
                      style={{
                        color: isSelected
                          ? "var(--accent)"
                          : "var(--text-primary)",
                        fontSize: "13px",
                      }}
                    >
                      {m.model}
                    </span>
                    <span
                      style={{
                        color: "var(--text-muted)",
                        fontSize: "11px",
                        marginLeft: "auto",
                      }}
                    >
                      {m.providerName}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 2: Update DefaultModelsTab props and UI**

Update `DefaultModelsTab` props to use new types:

```typescript
function DefaultModelsTab({
  // ... existing ASR/TTS props unchanged ...
  llmProviders,
  selectedSummaryModel,
  onChangeSummaryModel,
  selectedRapidModel,
  onChangeRapidModel,
  rapidRenamePrompt,
  onChangeRapidRenamePrompt,
  selectedTranslateModel,
  onChangeTranslateModel,
  translatePrompt,
  onChangeTranslatePrompt,
}: {
  // ... existing ASR/TTS types unchanged ...
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedSummaryModel: { providerId: string; model: string } | null;
  readonly onChangeSummaryModel: (sel: { providerId: string; model: string }) => void;
  readonly selectedRapidModel: { providerId: string; model: string } | null;
  readonly onChangeRapidModel: (sel: { providerId: string; model: string }) => void;
  readonly rapidRenamePrompt: string;
  readonly onChangeRapidRenamePrompt: (prompt: string) => void;
  readonly selectedTranslateModel: { providerId: string; model: string } | null;
  readonly onChangeTranslateModel: (sel: { providerId: string; model: string }) => void;
  readonly translatePrompt: string;
  readonly onChangeTranslatePrompt: (prompt: string) => void;
})
```

Remove the `configuredLlmProviders` filter (line 3355-3357 — no longer needed).

Replace each `<select>` for Summary, Rapid, and Translate models with `<UnifiedModelSelector>`:

```tsx
{/* Summary Model */}
<div style={cardStyle}>
  <div style={sectionTitleStyle}>Summary Model</div>
  <div style={{ ...sectionDescStyle, marginBottom: "10px" }}>
    Language model for generating summaries and analysis
  </div>
  <UnifiedModelSelector
    providers={llmProviders}
    selected={selectedSummaryModel}
    onChange={onChangeSummaryModel}
    onGearClick={() => onSwitchToTab("languageModels")}
  />
</div>
```

Same pattern for Rapid Model and Translate Model, using their respective props. All three pass `onGearClick={() => onSwitchToTab("languageModels")}` to navigate to the Language Models tab. The `onSwitchToTab` callback should already exist or be added to `DefaultModelsTab` props.

- [x] **Step 3: Commit**

```bash
git add src/renderer/components/SettingsModal.tsx
git commit -m "feat: add UnifiedModelSelector and update DefaultModelsTab"
```

---

### Task 8: Update TranscriptArea Translate Menu

**Files:**
- Modify: `src/renderer/components/TranscriptArea.tsx:20-80` (props and TranslateMenu)

- [ ] **Step 1: Update TranscriptAreaProps**

Replace:
```typescript
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedTranslateProviderId: string | null;
  readonly onChangeTranslateProvider: (providerId: string) => void;
```

With:
```typescript
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedTranslateModel: { providerId: string; model: string } | null;
  readonly onChangeTranslateModel: (sel: { providerId: string; model: string }) => void;
```

- [ ] **Step 2: Update TranslateMenuProps**

Replace:
```typescript
  readonly providers: readonly LlmProvider[];
  readonly selectedProviderId: string;
  readonly onChangeProvider: (providerId: string) => void;
```

With:
```typescript
  readonly providers: readonly LlmProvider[];
  readonly selectedTranslateModel: { providerId: string; model: string } | null;
  readonly onChangeTranslateModel: (sel: { providerId: string; model: string }) => void;
```

- [ ] **Step 3: Update TranslateMenu UI**

Replace the current "Translate Model" submenu (hover submenu with provider list) with a submenu that lists all models from all providers, grouped by provider. The existing hover-submenu pattern for "Target Language" is the reference.

Add a new state: `const [showModelSub, setShowModelSub] = useState(false);`

Replace the existing provider hover-submenu block (the `<div>` with `onMouseEnter={() => setShowProviderSub(true)}` wrapping the "Translate Model" button and its submenu). The full replacement:

```tsx
{/* Translate Model — hover submenu */}
<div
  style={{ position: "relative" }}
  onMouseEnter={() => setShowModelSub(true)}
  onMouseLeave={() => setShowModelSub(false)}
>
  <button
    style={itemStyle}
    onMouseEnter={handleItemHover}
    onMouseLeave={handleItemLeave}
  >
    <span>Model</span>
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "4px",
        color: "var(--text-muted)",
        fontSize: "12px",
      }}
    >
      <span
        style={{
          maxWidth: "120px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {selectedTranslateModel?.model ?? "Not set"}
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
    </span>
  </button>
  {showModelSub && (
    <div
      style={{
        position: "absolute",
        left: "100%",
        top: "-1px",
        marginLeft: "2px",
        minWidth: "220px",
        maxHeight: "320px",
        overflowY: "auto",
        backgroundColor: "var(--bg-surface)",
        backdropFilter: "blur(20px)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        padding: "4px 0",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 101,
      }}
    >
      {providers.map((p) => {
        const models = p.models?.length ? p.models : p.model ? [p.model] : [];
        if (models.length === 0) return null;
        return (
          <React.Fragment key={p.id}>
            <div
              style={{
                padding: "6px 14px 2px",
                color: "var(--text-muted)",
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {p.name}
            </div>
            {models.map((m) => {
              const isSelected =
                selectedTranslateModel?.providerId === p.id &&
                selectedTranslateModel?.model === m;
              return (
                <button
                  key={`${p.id}-${m}`}
                  onClick={() => {
                    onChangeTranslateModel({ providerId: p.id, model: m });
                  }}
                  onMouseEnter={handleItemHover}
                  onMouseLeave={handleItemLeave}
                  style={{
                    ...itemStyle,
                    color: isSelected
                      ? "var(--accent)"
                      : "var(--text-primary)",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    {isSelected ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                    ) : (
                      <span style={{ width: "14px" }} />
                    )}
                    {m}
                  </span>
                </button>
              );
            })}
          </React.Fragment>
        );
      })}
    </div>
  )}
</div>
```

Also remove the old `showProviderSub` state and the old provider submenu code.

- [ ] **Step 4: Update TranscriptArea component body**

Update the destructured props and the `TranslateMenu` rendering to pass new props:

```tsx
  selectedTranslateModel={selectedTranslateModel}
  onChangeTranslateModel={onChangeTranslateModel}
```

Remove `effectiveProviderId` and `configuredProviders` computed values that referenced the old provider-only selection.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TranscriptArea.tsx
git commit -m "feat: update TranslateMenu with provider+model selection"
```

---

### Task 9: Update SummaryPanel to Pass Model

**Files:**
- Modify: `src/renderer/components/SummaryPanel.tsx:44-69` (SummaryPanelProps)
- Modify: `src/renderer/components/SummaryPanel.tsx:112-166` (component init + provider logic)
- Modify: `src/renderer/components/SummaryPanel.tsx:420-480` (provider select + generate button)

- [ ] **Step 1: Update SummaryPanelProps**

In `src/renderer/components/SummaryPanel.tsx`, change lines 52-54 and 64:

Replace:
```typescript
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedLlmProviderId: string | null;
```

With:
```typescript
  readonly llmProviders: readonly LlmProvider[];
  readonly selectedSummaryModel: { providerId: string; model: string } | null;
```

Replace:
```typescript
  readonly onSummarize: (providerId: string, promptType: string) => void;
```

With:
```typescript
  readonly onSummarize: (providerId: string, model: string, promptType: string) => void;
```

- [ ] **Step 2: Update component destructuring and local state**

In `src/renderer/components/SummaryPanel.tsx`, update the destructured props (line 120-121) to use `selectedSummaryModel` instead of `selectedLlmProviderId`.

Remove the `configuredProviders` filter (lines 139-142). Replace with:
```typescript
  // All providers that have at least one model
  const availableProviders = useMemo(
    () => llmProviders.filter((p) => (p.models?.length ?? 0) > 0 || p.model),
    [llmProviders],
  );
```

Replace `localProviderId` state (lines 144-150) with a `localSelection` state:
```typescript
  const [localSelection, setLocalSelection] = useState<{
    providerId: string;
    model: string;
  } | null>(() => {
    if (selectedSummaryModel) return selectedSummaryModel;
    const first = availableProviders[0];
    if (first) {
      const model = first.models?.[0] || first.model || "";
      return { providerId: first.id, model };
    }
    return null;
  });
```

Update the sync `useEffect` (lines 153-162):
```typescript
  useEffect(() => {
    if (availableProviders.length > 0 && !localSelection) {
      if (selectedSummaryModel) {
        setLocalSelection(selectedSummaryModel);
      } else {
        const first = availableProviders[0];
        if (first) {
          const model = first.models?.[0] || first.model || "";
          setLocalSelection({ providerId: first.id, model });
        }
      }
    }
  }, [availableProviders, selectedSummaryModel, localSelection]);
```

Update `hasProvider` and `canGenerate` (lines 164-166):
```typescript
  const hasProvider = localSelection !== null;
  const canGenerate =
    currentSessionId !== null && hasSegments && hasProvider && !isGenerating;
```

- [ ] **Step 3: Replace provider `<select>` with UnifiedModelSelector**

Replace the provider `<select>` element (lines 420-444) with:
```tsx
          {availableProviders.length > 1 && (
            <div style={{ minWidth: "160px", maxWidth: "240px", marginRight: "8px" }}>
              <UnifiedModelSelector
                providers={availableProviders}
                selected={localSelection}
                onChange={(sel) => setLocalSelection(sel)}
              />
            </div>
          )}
```

Import `UnifiedModelSelector` from `./SettingsModal` at the top of the file (or move the component to a shared location).

- [ ] **Step 4: Update Generate button onClick**

Change line 447 from:
```typescript
onClick={() => onSummarize(localProviderId, activePromptType)}
```
To:
```typescript
onClick={() => {
  if (localSelection) {
    onSummarize(localSelection.providerId, localSelection.model, activePromptType);
  }
}}
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/SummaryPanel.tsx
git commit -m "feat: update SummaryPanel to pass model in generate call"
```

---

### Task 10: Update README and Final Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README changelog**

Add a new changelog entry describing the multi-model support feature:

```markdown
### 2026-03-30 (60)
- **Multi-Model Provider Support**: Each LLM provider now supports multiple models
  - Fetch models from `/models` API endpoint with grouped browser dialog
  - Manual model entry for providers without `/models` support
  - Unified model selector (Provider + Model) for Summary, Translate, and Rapid Rename
  - API Key optional (supports Ollama and other local services)
  - Automatic migration from single-model configuration
```

- [ ] **Step 2: Build and verify**

```bash
cd /Users/zhangjie/Documents/Jeason的创作/code/capty && npm run build
```

Fix any TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add multi-model provider support to changelog"
```
