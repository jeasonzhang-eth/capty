import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { Lrc, type LrcLine } from "react-lrc";
import { segmentsToLrc } from "../utils/lrcConverter";

interface Segment {
  readonly id: number;
  readonly start_time: number;
  readonly end_time: number;
  readonly text: string;
}

interface TranscriptAreaProps {
  readonly segments: readonly Segment[];
  readonly partialText: string;
  readonly isRecording: boolean;
  readonly playbackTime: number | null;
  readonly onSeekToTime: ((time: number) => void) | null;
  readonly sessionId: number | null;
  readonly canExport: boolean;
}

interface ExportMenuProps {
  readonly sessionId: number;
  readonly onClose: () => void;
}

function ExportMenu({
  sessionId,
  onClose,
}: ExportMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const getDefaultPath = useCallback(
    async (ext: string): Promise<string> => {
      const audioDir = await window.capty.getAudioDir(sessionId);
      if (audioDir) {
        const dirName = audioDir.split("/").pop() ?? "transcript";
        return `${audioDir}/${dirName}.${ext}`;
      }
      return `transcript.${ext}`;
    },
    [sessionId],
  );

  const handleExportTxt = useCallback(async () => {
    const content = await window.capty.exportTxt(sessionId, {
      timestamps: true,
    });
    const defaultPath = await getDefaultPath("txt");
    await window.capty.saveFile(defaultPath, content as string);
    onClose();
  }, [sessionId, onClose, getDefaultPath]);

  const handleExportSrt = useCallback(async () => {
    const content = await window.capty.exportSrt(sessionId);
    const defaultPath = await getDefaultPath("srt");
    await window.capty.saveFile(defaultPath, content as string);
    onClose();
  }, [sessionId, onClose, getDefaultPath]);

  const handleExportMarkdown = useCallback(async () => {
    const content = await window.capty.exportMarkdown(sessionId);
    const defaultPath = await getDefaultPath("md");
    await window.capty.saveFile(defaultPath, content as string);
    onClose();
  }, [sessionId, onClose, getDefaultPath]);

  const menuItemStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    padding: "10px 16px",
    fontSize: "13px",
    color: "var(--text-primary)",
    backgroundColor: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    transition: "background-color 0.15s, color 0.15s",
  };

  return (
    <div
      ref={menuRef}
      style={{
        position: "absolute",
        top: "100%",
        right: 0,
        marginTop: "4px",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        background: "rgba(28, 28, 31, 0.88)",
        border: "1px solid var(--border)",
        borderRadius: "10px",
        boxShadow:
          "0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.04)",
        overflow: "hidden",
        minWidth: "180px",
        zIndex: 100,
      }}
    >
      <button
        onClick={handleExportTxt}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
      >
        Export as TXT
      </button>
      <button
        onClick={handleExportSrt}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
      >
        Export as SRT
      </button>
      <button
        onClick={handleExportMarkdown}
        style={menuItemStyle}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--accent-glow)";
          e.currentTarget.style.color = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
          e.currentTarget.style.color = "var(--text-primary)";
        }}
      >
        Export as Markdown
      </button>
    </div>
  );
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TranscriptArea({
  segments,
  partialText,
  isRecording,
  playbackTime,
  onSeekToTime,
  sessionId,
  canExport,
}: TranscriptAreaProps): React.ReactElement {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const prevSegmentCountRef = useRef(0);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const isPlayback = playbackTime !== null;

  const lrcString = useMemo(() => segmentsToLrc(segments), [segments]);
  const currentMillisecond = playbackTime !== null ? playbackTime * 1000 : -1;

  const lineRenderer = useCallback(
    ({ index, active }: { index: number; active: boolean; line: LrcLine }) => {
      const segment = segments[index];
      if (!segment) return null;
      return (
        <div
          onClick={
            onSeekToTime ? () => onSeekToTime(segment.start_time) : undefined
          }
          style={{
            marginBottom: "2px",
            padding: "10px 16px",
            borderRadius: "8px",
            borderBottom: "1px solid var(--border)",
            borderLeft: active
              ? "3px solid var(--accent)"
              : "3px solid transparent",
            backgroundColor: active
              ? "rgba(245, 166, 35, 0.06)"
              : "transparent",
            cursor: "pointer",
            transition:
              "background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease",
            opacity: active ? 1 : 0.7,
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color: "var(--accent)",
              marginRight: "8px",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {formatTime(segment.start_time)}
          </span>
          <span
            style={{
              fontSize: "15px",
              lineHeight: 1.7,
              fontFamily: "'DM Sans', sans-serif",
              color: "var(--text-primary)",
            }}
          >
            {segment.text}
          </span>
        </div>
      );
    },
    [segments, onSeekToTime],
  );

  // Track whether user is near the bottom of the scroll container
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      const threshold = 80;
      isNearBottomRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    }
  }, []);

  // Auto-scroll to bottom when new segments arrive AND user is near bottom.
  // Works for both live recording and regeneration.
  useEffect(() => {
    const newCount = segments.length;
    const grew = newCount > prevSegmentCountRef.current;
    prevSegmentCountRef.current = newCount;

    if (grew && isNearBottomRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [segments]);

  // Also scroll on partial text updates during recording
  useEffect(() => {
    if (isRecording && isNearBottomRef.current && scrollContainerRef.current) {
      const el = scrollContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [partialText, isRecording]);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        background: "transparent",
      }}
    >
      {/* Header bar with Export button */}
      {canExport && sessionId !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "8px 28px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ position: "relative" }}>
            {showExportMenu && (
              <ExportMenu
                sessionId={sessionId}
                onClose={() => setShowExportMenu(false)}
              />
            )}
            <button
              onClick={() => setShowExportMenu((prev) => !prev)}
              style={{
                backgroundColor: "transparent",
                color: "var(--text-muted)",
                border: "none",
                padding: "8px 4px",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                transition: "color 0.15s, opacity 0.15s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--text-muted)";
              }}
            >
              Export
              <svg
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                style={{ marginTop: "-1px" }}
              >
                <path
                  d="M3.5 2.5L8.5 2.5L8.5 7.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.5 2.5L3 8"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {isPlayback && !isRecording && segments.length > 0 ? (
        <Lrc
          lrc={lrcString}
          currentMillisecond={currentMillisecond}
          lineRenderer={lineRenderer}
          verticalSpace
          recoverAutoScrollInterval={5000}
          style={{ flex: 1, overflowY: "auto", padding: "20px 28px" }}
        />
      ) : (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 28px",
          }}
        >
          {segments.map((seg) => {
            const isActive =
              playbackTime !== null &&
              playbackTime >= seg.start_time &&
              playbackTime < seg.end_time;
            return (
              <div
                key={seg.id}
                className="fade-in-up"
                onClick={
                  onSeekToTime ? () => onSeekToTime(seg.start_time) : undefined
                }
                style={{
                  marginBottom: "2px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  borderBottom: "1px solid var(--border)",
                  borderLeft: isActive
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                  backgroundColor: isActive
                    ? "rgba(245, 166, 35, 0.06)"
                    : "transparent",
                  cursor: onSeekToTime ? "pointer" : "default",
                  transition:
                    "background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease",
                  opacity: isActive ? 1 : 0.7,
                }}
              >
                <span
                  style={{
                    fontSize: "11px",
                    color: "var(--accent)",
                    marginRight: "8px",
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {formatTime(seg.start_time)}
                </span>
                <span
                  style={{
                    fontSize: "15px",
                    lineHeight: 1.7,
                    fontFamily: "'DM Sans', sans-serif",
                    color: "var(--text-primary)",
                  }}
                >
                  {seg.text}
                </span>
              </div>
            );
          })}

          {isRecording && partialText && (
            <div
              style={{
                marginBottom: "12px",
                padding: "10px 16px",
                opacity: 0.7,
              }}
            >
              <span
                style={{
                  fontSize: "15px",
                  lineHeight: 1.7,
                  fontFamily: "'DM Sans', sans-serif",
                  color: "var(--text-primary)",
                }}
              >
                {partialText}
              </span>
              <span
                className="cursor-blink"
                style={{
                  display: "inline-block",
                  width: "2px",
                  height: "16px",
                  backgroundColor: "var(--accent)",
                  marginLeft: "2px",
                  verticalAlign: "text-bottom",
                }}
              />
            </div>
          )}

          {!isRecording && segments.length === 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "var(--text-muted)",
                fontSize: "14px",
                fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Click{" "}
              <span
                style={{
                  color: "var(--accent)",
                  margin: "0 5px",
                  fontWeight: 600,
                }}
              >
                REC
              </span>{" "}
              to begin transcription
            </div>
          )}
        </div>
      )}
    </div>
  );
}
