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
  readonly model: string;
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
  readonly promptTypes: PromptType[];
  readonly zoomFactor: number | null;
  readonly historyPanelWidth: number | null;
  readonly summaryPanelWidth: number | null;
  readonly asrProviders: AsrProvider[];
  readonly selectedAsrProviderId: string | null;
  readonly ttsProviders: TtsProvider[];
  readonly selectedTtsProviderId: string | null;
  readonly selectedTtsModelId: string | null;
  readonly selectedTtsVoice: string;
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
  promptTypes: [],
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

    return {
      ...DEFAULT_CONFIG,
      ...(parsed as Partial<AppConfig>),
    };
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
