# LLM Provider Multi-Model Support

## Overview

Enhance the LLM Provider system so each provider holds a list of models (fetched from `/models` API or manually added). Feature-level model selection uses a unified dropdown listing all models from all providers, grouped by provider name.

## Data Model

### LlmProvider Interface

```typescript
interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;      // Optional — empty for local services (Ollama)
  readonly model: string;       // Retained for migration compatibility
  readonly models: string[];    // NEW: list of available models for this provider
  readonly isPreset: boolean;
}
```

### Feature-Level Model Selection

Replace single `selectedXxxProviderId: string` with `{ providerId, model }` pairs:

```typescript
// Config fields
selectedSummaryModel: { providerId: string; model: string } | null;
selectedTranslateModel: { providerId: string; model: string } | null;
selectedRapidModel: { providerId: string; model: string } | null;
```

Each stores the selected provider ID and the specific model within that provider.

## Settings UI — Provider Edit

### Models Section

Replace the single "Model Name" text input with a **Models area**:

- **Header**: "Models" label + count badge + "Fetch Models" button
- **Model List**: Each model as a row with name (monospace) + × delete button
- **Manual Add**: Text input + "+ Add" button at bottom
- **API Key**: Labeled "(optional for local models)" — no longer required for a provider to be usable
- **No "Configured/Not configured" status** — remove this indicator entirely

### Fetch Button

- **Enabled condition**: `baseUrl` is non-empty (API Key NOT required)
- **Action**: Calls `/models` API endpoint, then opens the Fetch Models dialog

## Fetch Models Dialog

A modal dialog (ChatBox-style) for browsing and adding models from the API:

### Layout

- **Title bar**: `"{ProviderName} Models"` + close button
- **Search bar**: Filter by model ID/name + refresh (↻) button
- **Model list**: Grouped by vendor, each model with "+" button to add

### Grouping Logic

- Model IDs containing `/` (e.g., `google/gemini-2.5-pro`): group by prefix before `/`
- Model IDs without `/` (e.g., `gpt-4o`): group under the provider's own name
- **≤ 20 total models**: flat list, no grouping (e.g., Ollama, direct OpenAI)
- **> 20 models**: collapsible groups with vendor name + green count badge

### Model Row

- Circular avatar with first letter of vendor/model
- Model ID text
- **Not added**: "+" button on the right
- **Already added**: dimmed/semi-transparent + "Added" label, no "+" button

### Interaction

- Click "+" to immediately add a model to the provider's `models` list
- Added models instantly update to "Added" state (no confirm button needed)
- Search filters across all groups in real-time
- Refresh button re-fetches from API

## Unified Model Selector (Default Models + Translate Menu)

A single dropdown component used in both Settings "Default Models" tab and the Translate dropdown menu.

### Closed State

```
[Icon] modelName          ProviderName  ▾  [⚙]
```

- Circular first-letter icon (color-coded per provider)
- Model name (truncated with ellipsis if long)
- Provider name (muted color)
- Dropdown arrow
- Gear button (navigates to Language Models settings tab)

### Open State (Dropdown)

- All models from all providers, grouped by provider name
- Group header: provider name in uppercase, muted
- Each item: `Icon + modelName + providerName`
- Currently selected item highlighted
- Search/filter input at top

### Usage Locations

1. **Settings → Default Models tab**: Summary Model, Translate Model, Rapid Rename Model
2. **TranscriptArea → Translate dropdown menu**: Replace current provider-only submenu with unified selector

## IPC Changes

### New: `llm:fetch-models`

```typescript
ipcMain.handle("llm:fetch-models", async (_event, provider: { baseUrl: string; apiKey: string }) => {
  // Same pattern as existing asr:fetch-models
  // Try /models and /v1/models endpoints
  // Return Array<{ id: string; name: string }>
  // Authorization header included only if apiKey is non-empty
  // 5-second timeout
});
```

### Modified: `llm:translate`, `llm:generate`

Change from receiving `providerId` (then looking up provider.model internally) to receiving `providerId + model` explicitly:

```typescript
// Before: window.capty.translate(providerId, text, lang, prompt)
// After:  window.capty.translate(providerId, model, text, lang, prompt)
```

This allows the caller to specify exactly which model to use.

## Migration Strategy

On config load, if a provider has `model` but no `models` array:

```typescript
// Auto-migrate
if (provider.model && (!provider.models || provider.models.length === 0)) {
  provider.models = [provider.model];
}
```

For feature selections:

```typescript
// Migrate selectedLlmProviderId → selectedSummaryModel
if (config.selectedLlmProviderId && !config.selectedSummaryModel) {
  const provider = providers.find(p => p.id === config.selectedLlmProviderId);
  if (provider) {
    config.selectedSummaryModel = { providerId: provider.id, model: provider.model };
  }
}
// Same for selectedTranslateLlmProviderId → selectedTranslateModel
// Same for selectedRapidLlmProviderId → selectedRapidModel
```

Migration runs once on config load. Old fields are preserved for backwards compatibility but not read by new code.

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/config.ts` | Update `LlmProvider` interface (add `models`), update `AppConfig` (new selection fields) |
| `src/main/ipc-handlers.ts` | Add `llm:fetch-models` handler, update `llm:translate`/`llm:generate` to accept model param |
| `src/preload/index.ts` | Expose `llmFetchModels` API, update translate/generate signatures |
| `src/renderer/components/SettingsModal.tsx` | Provider edit: model list + fetch + manual add; Fetch dialog component; Default Models: unified selector; Remove "configured" status |
| `src/renderer/App.tsx` | State: new selection model objects; migration logic; pass model to IPC calls |
| `src/renderer/components/TranscriptArea.tsx` | Translate menu: unified model selector replacing provider-only submenu |
| `README.md` | Changelog |

## Edge Cases

- **Provider with empty models list**: Cannot be selected in unified selector. UI shows "No models — click Fetch or add manually"
- **Selected model removed from provider**: Falls back to first model in that provider's list; if provider has no models, selection cleared
- **Fetch fails**: Error toast, existing model list preserved
- **Duplicate model IDs across providers**: Shown separately in their provider groups — both `OpenAI/gpt-4o` and `OpenRouter/openai/gpt-4o` are valid distinct entries
