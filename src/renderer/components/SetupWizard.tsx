import React, { useState, useCallback } from "react";

interface SetupWizardProps {
  readonly onComplete: (dataDir: string) => void;
}

const wizardButtonStyle: React.CSSProperties = {
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

export function SetupWizard({
  onComplete,
}: SetupWizardProps): React.ReactElement {
  const [step, setStep] = useState(0);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [isDownloading] = useState(false);
  const [downloadProgress] = useState(0);

  const handleSelectFolder = useCallback(async () => {
    const dir = await window.capty.selectDirectory();
    if (dir) {
      setDataDir(dir);
      await window.capty.setConfig({ dataDir: dir });
    }
  }, []);

  const handleSkipDownload = useCallback(() => {
    setStep(3);
  }, []);

  const handleFinish = useCallback(() => {
    if (dataDir) {
      onComplete(dataDir);
    }
  }, [dataDir, onComplete]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: "24px",
        padding: "40px",
        backgroundColor: "var(--bg-primary)",
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
            }}
          >
            Welcome to{" "}
            <span style={{ color: "var(--accent)" }}>Capty</span>
          </h1>
          <p
            style={{
              color: "var(--text-secondary)",
              fontSize: "16px",
              textAlign: "center",
              fontFamily: "'DM Sans', sans-serif",
              lineHeight: 1.6,
            }}
          >
            Real-time speech-to-text transcription, powered by local AI models.
          </p>
          <button onClick={() => setStep(1)} style={wizardButtonStyle}>
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
            }}
          >
            Choose Data Folder
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              textAlign: "center",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Select where Capty stores recordings, transcripts, and models.
          </p>
          <button onClick={handleSelectFolder} style={wizardButtonStyle}>
            Select Folder
          </button>
          {dataDir && (
            <p
              style={{
                color: "var(--text-muted)",
                fontSize: "13px",
                fontFamily: "'JetBrains Mono', monospace",
                padding: "8px 16px",
                backgroundColor: "var(--bg-tertiary)",
                borderRadius: "6px",
                border: "1px solid var(--border)",
              }}
            >
              {dataDir}
            </p>
          )}
          <button
            onClick={() => setStep(2)}
            disabled={!dataDir}
            style={{ ...wizardButtonStyle, opacity: dataDir ? 1 : 0.5 }}
          >
            Next
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <h2
            style={{
              fontSize: "24px",
              fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              color: "var(--text-primary)",
            }}
          >
            Download Model
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              textAlign: "center",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Download the ASR model for transcription. You can skip and do this
            later.
          </p>
          {isDownloading ? (
            <div style={{ width: "300px" }}>
              <div
                style={{
                  height: "8px",
                  backgroundColor: "var(--bg-surface)",
                  borderRadius: "4px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${downloadProgress}%`,
                    background:
                      "linear-gradient(90deg, var(--accent), var(--accent-hover))",
                    transition: "width 0.3s",
                    borderRadius: "4px",
                  }}
                />
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  textAlign: "center",
                  marginTop: "8px",
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {Math.round(downloadProgress)}%
              </p>
            </div>
          ) : (
            <button
              onClick={handleSkipDownload}
              style={{
                ...wizardButtonStyle,
                backgroundColor: "var(--bg-tertiary)",
                color: "var(--text-primary)",
                border: "1px solid var(--border)",
              }}
            >
              Skip for Now
            </button>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <h2
            style={{
              fontSize: "24px",
              fontWeight: 600,
              fontFamily: "'DM Sans', sans-serif",
              color: "var(--text-primary)",
            }}
          >
            All Set!
          </h2>
          <p
            style={{
              color: "var(--text-secondary)",
              textAlign: "center",
              fontFamily: "'DM Sans', sans-serif",
            }}
          >
            Capty is ready to use. Start recording to begin transcription.
          </p>
          <button onClick={handleFinish} style={wizardButtonStyle}>
            Start Using Capty
          </button>
        </>
      )}
    </div>
  );
}
