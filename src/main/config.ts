import fs from "fs";
import path from "path";

export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string; // kept for migration compat
  readonly models: string[]; // full model list
  readonly isPreset: boolean;
}

export interface AsrProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly isSidecar: boolean;
}

export interface TtsProvider {
  readonly id: string;
  readonly name: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly voice: string;
  readonly isSidecar: boolean;
}

export interface SessionCategory {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly isBuiltin: boolean;
}

export const BUILTIN_SESSION_CATEGORIES: readonly SessionCategory[] = [
  { id: "download", label: "下载内容", icon: "↓", isBuiltin: true },
  { id: "recording", label: "个人录音", icon: "●", isBuiltin: true },
  { id: "meeting", label: "会议", icon: "◎", isBuiltin: true },
  { id: "phone", label: "电话", icon: "☏", isBuiltin: true },
];

export interface PromptType {
  readonly id: string;
  readonly label: string;
  readonly systemPrompt: string;
  readonly isBuiltin: boolean;
}

export const DEFAULT_PROMPT_TYPES: readonly PromptType[] = [
  {
    id: "summarize",
    label: "Summary",
    systemPrompt:
      "You are a voice transcript summarization assistant. Please summarize the following voice transcript, extract key points, and generate a structured summary. Respond in the same language as the transcript.",
    isBuiltin: true,
  },
  {
    id: "questions",
    label: "Questions",
    systemPrompt:
      "You are an analytical assistant. Based on the following voice transcript, generate insightful follow-up questions that could deepen understanding, challenge assumptions, or explore related topics. Respond in the same language as the transcript.",
    isBuiltin: true,
  },
  {
    id: "context",
    label: "Context",
    systemPrompt:
      "You are a context analysis assistant. Based on the following voice transcript, infer and explain the background knowledge, context, and assumptions needed to fully understand this conversation. Identify domain-specific terms, implicit references, and prerequisite knowledge. Respond in the same language as the transcript.",
    isBuiltin: true,
  },
];

export interface AppConfig {
  readonly dataDir: string | null;
  readonly selectedAudioDeviceId: string | null;
  readonly selectedModelId: string | null;
  readonly modelRegistryUrl: string | null;
  readonly hfMirrorUrl: string | null;
  readonly windowBounds: WindowBounds | null;
  readonly llmProviders: LlmProvider[];
  readonly selectedLlmProviderId: string | null;
  readonly selectedSummaryModel: { providerId: string; model: string } | null;
  readonly selectedTranslateModel: { providerId: string; model: string } | null;
  readonly selectedRapidModel: { providerId: string; model: string } | null;
  readonly promptTypes: PromptType[];
  readonly sessionCategories: SessionCategory[];
  readonly zoomFactor: number | null;
  readonly historyPanelWidth: number | null;
  readonly summaryPanelWidth: number | null;
  readonly asrProviders: AsrProvider[];
  readonly selectedAsrProviderId: string | null;
  readonly ttsProviders: TtsProvider[];
  readonly selectedTtsProviderId: string | null;
  readonly selectedTtsModelId: string | null;
  readonly selectedTtsVoice: string;
  readonly translatePrompt: string;
}

export function getEffectivePromptTypes(config: AppConfig): PromptType[] {
  const userTypes = config.promptTypes;
  const userIds = new Set(userTypes.map((t) => t.id));

  const result: PromptType[] = DEFAULT_PROMPT_TYPES.map((builtin) => {
    const override = userTypes.find((u) => u.id === builtin.id);
    return override ? { ...override, isBuiltin: true } : { ...builtin };
  });

  for (const ut of userTypes) {
    if (!DEFAULT_PROMPT_TYPES.some((b) => b.id === ut.id)) {
      result.push({ ...ut, isBuiltin: false });
    }
  }

  return result;
}

export function getEffectiveCategories(config: AppConfig): SessionCategory[] {
  const saved = config.sessionCategories ?? [];
  if (saved.length === 0) return [...BUILTIN_SESSION_CATEGORIES];

  // Use saved order. For builtin IDs present in saved list, preserve their
  // canonical label/icon but keep the saved position.
  const builtinMap = new Map(BUILTIN_SESSION_CATEGORIES.map((b) => [b.id, b]));
  const result: SessionCategory[] = saved.map((cat) => {
    const builtin = builtinMap.get(cat.id);
    if (builtin) return { ...builtin };
    return { ...cat, isBuiltin: false };
  });

  // Append any builtin categories missing from the saved list (e.g. newly
  // added builtins after an app update)
  for (const b of BUILTIN_SESSION_CATEGORIES) {
    if (!saved.some((s) => s.id === b.id)) {
      result.push({ ...b });
    }
  }

  return result;
}

const CONFIG_FILENAME = "config.json";

const DEFAULT_CONFIG: AppConfig = {
  dataDir: null,
  selectedAudioDeviceId: null,
  selectedModelId: null,
  modelRegistryUrl: null,
  hfMirrorUrl: null,
  windowBounds: null,
  llmProviders: [],
  selectedLlmProviderId: null,
  selectedSummaryModel: null,
  selectedTranslateModel: null,
  selectedRapidModel: null,
  promptTypes: [],
  sessionCategories: [],
  zoomFactor: null,
  historyPanelWidth: null,
  summaryPanelWidth: null,
  asrProviders: [
    {
      id: "sidecar",
      name: "Local Sidecar",
      baseUrl: "http://localhost:8765",
      apiKey: "",
      model: "",
      isSidecar: true,
    },
  ],
  selectedAsrProviderId: "sidecar",
  ttsProviders: [
    {
      id: "sidecar",
      name: "Local Sidecar",
      baseUrl: "http://localhost:8765",
      apiKey: "",
      model: "",
      voice: "auto",
      isSidecar: true,
    },
  ],
  selectedTtsProviderId: "sidecar",
  selectedTtsModelId: null,
  selectedTtsVoice: "auto",
  translatePrompt:
    "You are a professional translator. Translate the following text to {{target_language}}. Rules:\n1. Translate ONLY the text content, preserving the exact number of lines\n2. Each line in the output corresponds to the same line in the input\n3. Do NOT add, remove, or merge lines\n4. Do NOT add any explanations, notes, or extra text\n5. Maintain the original tone and meaning\n\n{{text}}",
};

export function readConfig(configDir: string): AppConfig {
  const configPath = path.join(configDir, CONFIG_FILENAME);

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Migrate old asrBackend/sidecarUrl/asrProvider to asrProviders[]
    if ("asrBackend" in parsed && !("asrProviders" in parsed)) {
      const oldBackend = parsed.asrBackend as "builtin" | "external";
      const oldSidecarUrl =
        (parsed.sidecarUrl as string) ?? "http://localhost:8765";
      const oldProvider = parsed.asrProvider as {
        id: string;
        name: string;
        baseUrl: string;
        apiKey: string;
        model: string;
      } | null;

      const providers: AsrProvider[] = [
        {
          id: "sidecar",
          name: "Local Sidecar",
          baseUrl: oldSidecarUrl,
          apiKey: "",
          model: "",
          isSidecar: true,
        },
      ];

      if (oldProvider?.baseUrl) {
        providers.push({
          id: oldProvider.id || `ext-${Date.now()}`,
          name: oldProvider.name || "External ASR",
          baseUrl: oldProvider.baseUrl,
          apiKey: oldProvider.apiKey || "",
          model: oldProvider.model || "",
          isSidecar: false,
        });
      }

      const selectedId =
        oldBackend === "external" && oldProvider?.baseUrl
          ? oldProvider.id || providers[1]?.id
          : "sidecar";

      parsed.asrProviders = providers;
      parsed.selectedAsrProviderId = selectedId;
      delete parsed.asrBackend;
      delete parsed.sidecarUrl;
      delete parsed.asrProvider;

      // Write migrated config back to disk
      const migrated = { ...DEFAULT_CONFIG, ...parsed } as AppConfig;
      writeConfig(configDir, migrated);
      return migrated;
    }

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
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(configDir: string, config: AppConfig): void {
  fs.mkdirSync(configDir, { recursive: true });

  const configPath = path.join(configDir, CONFIG_FILENAME);
  const content = JSON.stringify(config, null, 2);
  fs.writeFileSync(configPath, content, "utf-8");
}

export function getDataDir(configDir: string): string | null {
  const config = readConfig(configDir);
  return config.dataDir;
}
