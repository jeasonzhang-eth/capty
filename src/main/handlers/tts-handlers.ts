import { ipcMain, net } from "electron";
import { join } from "path";
import type { IpcDeps } from "./types";
import {
  readConfig,
  writeConfig,
  type TtsProvider,
} from "../config";

/** Strip trailing /v1 so we can append /v1/... consistently. */
function normalizeTtsUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/** Build sidecar base URL from config port. */
function getSidecarBaseUrl(configDir: string): string {
  const config = readConfig(configDir);
  const port = config.sidecar?.port ?? 8765;
  return `http://localhost:${port}`;
}

/** Active stream abort controllers keyed by streamId. */
const activeStreams = new Map<string, AbortController>();

export function register(deps: IpcDeps): void {
  const { configDir, getMainWindow } = deps;

  // TTS provider reachability check
  ipcMain.handle("tts:check-provider", async () => {
    const config = readConfig(configDir);
    const selectedId = config.selectedTtsProviderId ?? "sidecar";
    const provider = (config.ttsProviders ?? []).find(
      (p) => p.id === selectedId,
    );
    if (!provider) {
      return { ready: false, reason: "No TTS provider configured" };
    }
    const url = provider.isSidecar
      ? getSidecarBaseUrl(configDir)
      : provider.baseUrl;
    try {
      if (provider.isSidecar) {
        // Check sidecar /health endpoint for tts_loaded
        const resp = await fetch(`${url}/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!resp.ok) {
          return { ready: false, reason: `Sidecar returned ${resp.status}` };
        }
        const data = (await resp.json()) as Record<string, unknown>;
        return { ready: true, reason: "Sidecar online", ...data };
      } else {
        // External: check if /v1/audio/speech endpoint is reachable
        const normalizedUrl = normalizeTtsUrl(url);
        const resp = await net.fetch(`${normalizedUrl}/v1/audio/speech`, {
          method: "OPTIONS",
          signal: AbortSignal.timeout(3000),
        });
        // Any non-network-error response means the server is reachable
        return { ready: true, reason: `Provider reachable (${resp.status})` };
      }
    } catch {
      return { ready: false, reason: "Provider unreachable" };
    }
  });

  // TTS voice listing (OpenAI-compatible /v1/audio/voices)
  ipcMain.handle("tts:list-voices", async () => {
    const config = readConfig(configDir);
    const provider = (config.ttsProviders ?? []).find(
      (p) => p.id === (config.selectedTtsProviderId ?? "sidecar"),
    );
    const url = provider?.isSidecar
      ? getSidecarBaseUrl(configDir)
      : (provider?.baseUrl ?? "http://localhost:8765");
    const baseUrl = normalizeTtsUrl(url);

    try {
      const resp = await net.fetch(`${baseUrl}/v1/audio/voices`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) return { model: "", voices: [] };
      const data = (await resp.json()) as {
        items?: Array<{ id: string; name: string }>;
      };
      // Mistral format: { items: [{id, name}], total, page, ... }
      const voices = (data.items ?? []).map((v) => ({
        id: v.id,
        name: v.name || v.id,
        lang: "",
        gender: "",
      }));
      return { model: "", voices };
    } catch {
      return { model: "", voices: [] };
    }
  });

  // TTS (text-to-speech via provider)
  ipcMain.handle(
    "tts:speak",
    async (
      _event,
      text: string,
      opts?: { voice?: string; speed?: number; langCode?: string },
    ) => {
      const config = readConfig(configDir);
      const selectedId = config.selectedTtsProviderId ?? "sidecar";
      const provider = (config.ttsProviders ?? []).find(
        (p) => p.id === selectedId,
      );
      if (!provider) {
        throw new Error("No TTS provider configured. Add one in Settings.");
      }
      const url = provider.isSidecar
        ? getSidecarBaseUrl(configDir)
        : provider.baseUrl;

      // Guard: check provider reachability before making TTS request
      try {
        await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
      } catch {
        throw new Error(
          "TTS provider is not available. Check that the sidecar or external TTS server is running.",
        );
      }

      // Resolve model: sidecar uses local path, external uses provider.model
      let modelValue = "";
      if (provider.isSidecar) {
        const ttsModelId = config.selectedTtsModelId;
        if (ttsModelId) {
          const dataDir = config.dataDir ?? join(configDir, "data");
          modelValue = join(dataDir, "models", "tts", ttsModelId);
        }
      } else {
        modelValue = provider.model ?? "";
      }

      const baseUrl = normalizeTtsUrl(url);
      // Sidecar: opts.voice (from UI selector) > provider.voice
      // External: provider.voice (from Settings config) only
      const voiceValue = provider.isSidecar
        ? opts?.voice || provider?.voice || undefined
        : provider?.voice || undefined;
      const bodyObj: Record<string, unknown> = {
        input: text,
        model: modelValue || undefined,
        voice: voiceValue,
        speed: opts?.speed ?? 1.0,
      };
      if (provider.isSidecar) {
        bodyObj.lang_code = opts?.langCode ?? "auto";
      }
      const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(120000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`TTS failed (${resp.status}): ${errBody}`);
      }

      const buffer = await resp.arrayBuffer();
      return Buffer.from(buffer);
    },
  );

  // TTS streaming
  ipcMain.handle(
    "tts:speak-stream",
    async (
      _event,
      streamId: string,
      text: string,
      opts?: { voice?: string; speed?: number; langCode?: string },
    ) => {
      const win = getMainWindow();
      const config = readConfig(configDir);
      const selectedId = config.selectedTtsProviderId ?? "sidecar";
      const provider = (config.ttsProviders ?? []).find(
        (p) => p.id === selectedId,
      );
      if (!provider) {
        win?.webContents.send("tts:stream-error", {
          streamId,
          error: "No TTS provider configured",
        });
        return;
      }
      const url = provider.isSidecar
        ? getSidecarBaseUrl(configDir)
        : provider.baseUrl;

      // Resolve model: sidecar uses local path, external uses provider.model
      let modelValue = "";
      if (provider.isSidecar) {
        const ttsModelId = config.selectedTtsModelId;
        if (ttsModelId) {
          const dataDir = config.dataDir ?? join(configDir, "data");
          modelValue = join(dataDir, "models", "tts", ttsModelId);
        }
      } else {
        modelValue = provider.model ?? "";
      }

      const controller = new AbortController();
      activeStreams.set(streamId, controller);

      try {
        const baseUrl = normalizeTtsUrl(url);
        const voiceValue = provider.isSidecar
          ? opts?.voice || provider?.voice || undefined
          : provider?.voice || undefined;
        const bodyObj: Record<string, unknown> = {
          input: text,
          model: modelValue || undefined,
          voice: voiceValue,
          speed: opts?.speed ?? 1.0,
        };
        if (provider.isSidecar) {
          bodyObj.lang_code = opts?.langCode ?? "auto";
        }

        if (provider.isSidecar) {
          // Sidecar: NDJSON streaming via /v1/audio/speech/stream
          const resp = await net.fetch(`${baseUrl}/v1/audio/speech/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const errBody = await resp.text();
            win?.webContents.send("tts:stream-error", {
              streamId,
              error: `TTS stream failed (${resp.status}): ${errBody}`,
            });
            return;
          }

          const reader = resp.body!.getReader();
          const decoder = new TextDecoder();
          let ndjsonBuf = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            ndjsonBuf += decoder.decode(value, { stream: true });

            const lines = ndjsonBuf.split("\n");
            ndjsonBuf = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;

              try {
                const parsed = JSON.parse(trimmed) as {
                  type: string;
                  data?: string;
                  sample_rate?: number;
                  is_final?: boolean;
                  message?: string;
                };

                if (parsed.type === "header") {
                  win?.webContents.send("tts:stream-header", {
                    streamId,
                    sampleRate: parsed.sample_rate,
                  });
                } else if (parsed.type === "audio") {
                  if (parsed.data && parsed.data.length > 0) {
                    win?.webContents.send("tts:stream-data", {
                      streamId,
                      data: parsed.data,
                      sampleRate: parsed.sample_rate,
                      isFinal: parsed.is_final,
                    });
                  }
                  if (
                    parsed.is_final &&
                    (!parsed.data || parsed.data.length === 0)
                  ) {
                    win?.webContents.send("tts:stream-end", { streamId });
                  }
                } else if (parsed.type === "error") {
                  win?.webContents.send("tts:stream-error", {
                    streamId,
                    error: parsed.message ?? "Unknown TTS error",
                  });
                }
              } catch {
                // Skip malformed JSON
              }
            }
          }
        } else {
          // External provider: chunked WAV streaming via /v1/audio/speech
          const headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          if (provider.apiKey) {
            headers["Authorization"] = `Bearer ${provider.apiKey}`;
          }
          const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
            method: "POST",
            headers,
            body: JSON.stringify(bodyObj),
            signal: controller.signal,
          });

          if (!resp.ok) {
            const errBody = await resp.text();
            win?.webContents.send("tts:stream-error", {
              streamId,
              error: `TTS stream failed (${resp.status}): ${errBody}`,
            });
            return;
          }

          const reader = resp.body!.getReader();
          let wavHeaderParsed = false;
          let headerBuf = Buffer.alloc(0);
          let sampleRate = 24000;
          let dataOffset = 0;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (!wavHeaderParsed) {
              headerBuf = Buffer.concat([headerBuf, Buffer.from(value)]);
              // WAV header needs at least 44 bytes
              if (headerBuf.length < 44) continue;

              // Parse sample rate from WAV header (bytes 24-27)
              sampleRate = headerBuf.readUInt32LE(24);

              // Find "data" chunk to locate PCM start
              let off = 12; // skip RIFF header (12 bytes)
              while (off < headerBuf.length - 8) {
                const chunkId = headerBuf.toString("ascii", off, off + 4);
                const chunkSize = headerBuf.readUInt32LE(off + 4);
                if (chunkId === "data") {
                  dataOffset = off + 8;
                  break;
                }
                off += 8 + chunkSize;
              }

              if (dataOffset === 0) {
                // "data" chunk not found yet, need more bytes
                continue;
              }

              wavHeaderParsed = true;
              win?.webContents.send("tts:stream-header", {
                streamId,
                sampleRate,
              });

              // Send remaining PCM data after header
              const pcmData = headerBuf.subarray(dataOffset);
              if (pcmData.length > 0) {
                win?.webContents.send("tts:stream-data", {
                  streamId,
                  data: pcmData.toString("base64"),
                  sampleRate,
                  isFinal: false,
                });
              }
            } else {
              // Stream raw PCM data chunks
              const chunk = Buffer.from(value);
              if (chunk.length > 0) {
                win?.webContents.send("tts:stream-data", {
                  streamId,
                  data: chunk.toString("base64"),
                  sampleRate,
                  isFinal: false,
                });
              }
            }
          }
        }

        // Stream ended naturally
        win?.webContents.send("tts:stream-end", { streamId });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // Cancelled by user — no error event needed
        } else {
          win?.webContents.send("tts:stream-error", {
            streamId,
            error: err?.message ?? "TTS stream failed",
          });
        }
      } finally {
        activeStreams.delete(streamId);
      }
    },
  );

  ipcMain.handle("tts:cancel-stream", (_event, streamId: string) => {
    const controller = activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      activeStreams.delete(streamId);
    }
  });

  // TTS connectivity test (send short text, verify audio response)
  ipcMain.handle(
    "tts:test",
    async (
      _event,
      provider: {
        baseUrl: string;
        apiKey: string;
        model: string;
        isSidecar?: boolean;
      },
    ) => {
      try {
        const rawUrl = provider.isSidecar
          ? getSidecarBaseUrl(configDir)
          : provider.baseUrl;
        const baseUrl = normalizeTtsUrl(rawUrl);

        // Resolve model: sidecar uses local path, external uses provider.model
        let modelValue = provider.model ?? "";
        if (provider.isSidecar) {
          const config = readConfig(configDir);
          const ttsModelId = config.selectedTtsModelId;
          if (ttsModelId) {
            const dataDir = config.dataDir ?? join(configDir, "data");
            modelValue = join(dataDir, "models", "tts", ttsModelId);
          }
        }

        if (!modelValue) {
          return { success: false, error: "No TTS model selected" };
        }

        const body: Record<string, unknown> = { input: "Hello" };
        body.model = modelValue;

        // Sidecar may lazy-load the TTS model on first request (can take 60s+)
        const timeoutMs = provider.isSidecar ? 120_000 : 30_000;
        const resp = await net.fetch(`${baseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(provider.apiKey
              ? { Authorization: `Bearer ${provider.apiKey}` }
              : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          return { success: false, error: `HTTP ${resp.status}: ${errBody}` };
        }

        const buffer = await resp.arrayBuffer();
        if (buffer.byteLength < 100) {
          return {
            success: false,
            error: `TTS returned too little data (${buffer.byteLength} bytes)`,
          };
        }
        return { success: true, bytes: buffer.byteLength };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Save TTS settings (providers + selection)
  ipcMain.handle(
    "config:save-tts-settings",
    (
      _event,
      settings: {
        ttsProviders: TtsProvider[];
        selectedTtsProviderId: string | null;
        selectedTtsModelId: string | null;
      },
    ) => {
      const config = readConfig(configDir);
      writeConfig(configDir, {
        ...config,
        ttsProviders: settings.ttsProviders,
        selectedTtsProviderId: settings.selectedTtsProviderId,
        selectedTtsModelId: settings.selectedTtsModelId,
      });
    },
  );
}
