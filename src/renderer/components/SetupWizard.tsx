import React, { useState, useCallback, useEffect } from "react";

interface SetupWizardProps {
  readonly onComplete: (dataDir: string) => void;
}

const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    placeholder: "sk-...",
    url: "https://platform.deepseek.com/api_keys",
    urlLabel: "platform.deepseek.com/api_keys",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    placeholder: "sk-or-...",
    url: "https://openrouter.ai/settings/keys",
    urlLabel: "openrouter.ai/settings/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    placeholder: "sk-...",
    url: "https://platform.openai.com/api-keys",
    urlLabel: "platform.openai.com/api-keys",
  },
] as const;

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--bg-tertiary)",
  borderRadius: "10px",
  border: "1px solid var(--border)",
  padding: "16px 20px",
  width: "100%",
};

const primaryButtonStyle: React.CSSProperties = {
  backgroundColor: "var(--accent)",
  color: "#141416",
  border: "none",
  borderRadius: "8px",
  padding: "12px 32px",
  fontSize: "15px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'DM Sans', sans-serif",
  transition: "background-color 0.2s, transform 0.1s",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  backgroundColor: "var(--bg-tertiary)",
  color: "var(--text-primary)",
  border: "1px solid var(--border)",
};

export function SetupWizard({
  onComplete,
}: SetupWizardProps): React.ReactElement {
  const [step, setStep] = useState(0);
  const [dataDir, setDataDir] = useState("");
  const [useHfMirror, setUseHfMirror] = useState(false);
  const [useSidecar, setUseSidecar] = useState(true);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  // Load default data dir on mount
  useEffect(() => {
    window.capty.getDefaultDataDir().then((dir) => setDataDir(dir));
  }, []);

  const handleChangeDir = useCallback(async () => {
    const dir = await window.capty.selectDirectory();
    if (dir) {
      setDataDir(dir);
    }
  }, []);

  const handleGetStarted = useCallback(async () => {
    const hfMirrorUrl = useHfMirror ? "https://hf-mirror.com" : null;
    const configUpdate: Record<string, unknown> = { dataDir, hfMirrorUrl };

    // If user opts out of sidecar, clear the default sidecar providers
    if (!useSidecar) {
      configUpdate.asrProviders = [];
      configUpdate.selectedAsrProviderId = null;
      configUpdate.ttsProviders = [];
      configUpdate.selectedTtsProviderId = null;
    }

    await window.capty.setConfig(configUpdate);
    setStep(1);
  }, [dataDir, useHfMirror, useSidecar]);

  const handleFinish = useCallback(
    async (skipKeys: boolean) => {
      if (!skipKeys) {
        // Save API keys to existing LLM providers
        const config = (await window.capty.getConfig()) as {
          llmProviders?: Array<{
            id: string;
            name: string;
            baseUrl: string;
            apiKey: string;
            model: string;
            models: string[];
            isPreset: boolean;
          }>;
        };
        const providers = config.llmProviders ?? [];
        const updated = providers.map((p) => {
          const key = apiKeys[p.id];
          if (key) {
            return { ...p, apiKey: key };
          }
          return p;
        });
        await window.capty.setConfig({ llmProviders: updated });
      }
      // Initialize DB in-process (no relaunch needed)
      await window.capty.initDataDir(dataDir);
      onComplete(dataDir);
    },
    [apiKeys, dataDir, onComplete],
  );

  const handleKeyChange = useCallback((providerId: string, value: string) => {
    setApiKeys((prev) => ({ ...prev, [providerId]: value }));
  }, []);

  const hasAnyKey = Object.values(apiKeys).some((k) => k.trim().length > 0);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        padding: "40px",
        backgroundColor: "var(--bg-primary)",
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "24px",
        }}
      >
        {step === 0 && (
          <>
            <h1
              style={{
                fontSize: "32px",
                fontWeight: 700,
                fontFamily: "'DM Sans', sans-serif",
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Welcome to <span style={{ color: "var(--accent)" }}>Capty</span>
            </h1>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "16px",
                textAlign: "center",
                fontFamily: "'DM Sans', sans-serif",
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Real-time speech-to-text transcription, powered by local AI
              models.
            </p>

            {/* Data Folder */}
            <div style={cardStyle}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  marginBottom: "8px",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Data Folder
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    flex: 1,
                    fontSize: "13px",
                    fontFamily: "'JetBrains Mono', monospace",
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {dataDir || "Loading..."}
                </span>
                <button
                  onClick={handleChangeDir}
                  style={{
                    backgroundColor: "var(--bg-surface)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    padding: "4px 12px",
                    fontSize: "12px",
                    cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif",
                    whiteSpace: "nowrap",
                  }}
                >
                  Change
                </button>
              </div>
            </div>

            {/* Local Sidecar */}
            <div style={cardStyle}>
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={useSidecar}
                  onChange={(e) => setUseSidecar(e.target.checked)}
                  style={{
                    width: "16px",
                    height: "16px",
                    accentColor: "var(--accent)",
                    marginTop: "2px",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    Enable local ASR/TTS engine (Sidecar)
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      fontFamily: "'DM Sans', sans-serif",
                      lineHeight: 1.5,
                    }}
                  >
                    Runs speech recognition and text-to-speech locally on your
                    machine. No internet required, fully private. Disable if you
                    only use cloud API providers.
                  </div>
                </div>
              </label>
            </div>

            {/* HuggingFace Mirror */}
            <div style={cardStyle}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={useHfMirror}
                  onChange={(e) => setUseHfMirror(e.target.checked)}
                  style={{
                    width: "16px",
                    height: "16px",
                    accentColor: "var(--accent)",
                  }}
                />
                <div>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 500,
                      color: "var(--text-primary)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    Use China mirror for HuggingFace
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--text-muted)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    hf-mirror.com — recommended for users in China
                  </div>
                </div>
              </label>
            </div>

            <button
              onClick={handleGetStarted}
              disabled={!dataDir}
              style={{
                ...primaryButtonStyle,
                opacity: dataDir ? 1 : 0.5,
                marginTop: "8px",
              }}
            >
              Get Started
            </button>
          </>
        )}

        {step === 1 && (
          <>
            <h2
              style={{
                fontSize: "24px",
                fontWeight: 600,
                fontFamily: "'DM Sans', sans-serif",
                color: "var(--text-primary)",
                margin: 0,
              }}
            >
              Configure AI Providers
            </h2>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: "14px",
                textAlign: "center",
                fontFamily: "'DM Sans', sans-serif",
                lineHeight: 1.5,
                margin: 0,
              }}
            >
              Optional — you can configure these later in Settings.
            </p>

            {PROVIDERS.map((provider) => (
              <div key={provider.id} style={cardStyle}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "8px",
                  }}
                >
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {provider.name}
                  </span>
                  <a
                    href={provider.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: "12px",
                      color: "var(--accent)",
                      textDecoration: "none",
                      fontFamily: "'DM Sans', sans-serif",
                    }}
                  >
                    {provider.urlLabel} &#8599;
                  </a>
                </div>
                <input
                  type="password"
                  placeholder={provider.placeholder}
                  value={apiKeys[provider.id] ?? ""}
                  onChange={(e) => handleKeyChange(provider.id, e.target.value)}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    fontSize: "13px",
                    fontFamily: "'JetBrains Mono', monospace",
                    backgroundColor: "var(--bg-surface)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            ))}

            <div
              style={{
                display: "flex",
                gap: "12px",
                marginTop: "8px",
                width: "100%",
                justifyContent: "center",
              }}
            >
              <button
                onClick={() => handleFinish(true)}
                style={secondaryButtonStyle}
              >
                Skip
              </button>
              <button
                onClick={() => handleFinish(false)}
                disabled={!hasAnyKey}
                style={{
                  ...primaryButtonStyle,
                  opacity: hasAnyKey ? 1 : 0.5,
                }}
              >
                Continue
              </button>
            </div>

            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "12px",
                textAlign: "center",
                fontFamily: "'DM Sans', sans-serif",
                margin: 0,
              }}
            >
              ASR models can be downloaded in Settings &rarr; Models
            </p>
          </>
        )}
      </div>
    </div>
  );
}
