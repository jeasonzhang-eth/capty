import { ipcMain, net } from "electron";
import { join } from "path";
import type { IpcDeps } from "./types";
import { spawn } from "../shared/spawn";
import { readConfig } from "../config";
import { pcmToWav } from "../audio-files";

/** Convert any audio file to 16kHz mono 16-bit WAV via ffmpeg. */
function convertToWav(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i",
      inputPath,
      "-ar",
      "16000",
      "-ac",
      "1",
      "-sample_fmt",
      "s16",
      "-f",
      "wav",
      "-y",
      outputPath,
    ]);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on("error", (err) => {
      reject(
        new Error(
          `Failed to run ffmpeg. Make sure ffmpeg is installed (brew install ffmpeg). ${err.message}`,
        ),
      );
    });
  });
}

/** Build sidecar base URL from config port. */
function getSidecarBaseUrl(cfgDir: string): string {
  const config = readConfig(cfgDir);
  const port = config.sidecar?.port ?? 8765;
  return `http://localhost:${port}`;
}

export function register(deps: IpcDeps): void {
  const { configDir } = deps;

  // External ASR transcription (OpenAI-compatible API)
  ipcMain.handle(
    "asr:transcribe",
    async (
      _event,
      pcmData: ArrayBuffer,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const wavBuffer = pcmToWav(Buffer.from(pcmData), 16000, 1, 16);

      const formData = new FormData();
      formData.append(
        "file",
        new Blob([wavBuffer], { type: "audio/wav" }),
        "audio.wav",
      );
      formData.append("model", provider.model);

      // Strip trailing /v1 or / to avoid double /v1/v1 paths
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const resp = await net.fetch(`${baseUrl}/v1/audio/transcriptions`, {
        method: "POST",
        headers: {
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: formData,
        signal: AbortSignal.timeout(60000),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`ASR API error (${resp.status}): ${errBody}`);
      }

      const result = (await resp.json()) as { text?: string };
      return { text: result.text ?? "" };
    },
  );

  // External ASR: fetch available models from server
  ipcMain.handle(
    "asr:fetch-models",
    async (_event, provider: { baseUrl: string; apiKey: string }) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const headers: Record<string, string> = {};
      if (provider.apiKey)
        headers["Authorization"] = `Bearer ${provider.apiKey}`;

      const endpoints = [`${baseUrl}/models`, `${baseUrl}/v1/models`];

      for (const url of endpoints) {
        try {
          const resp = await net.fetch(url, {
            headers,
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) continue;
          const data = await resp.json();

          // Sidecar format: array [{id, name, downloaded?, ...}, ...]
          if (Array.isArray(data)) {
            const available = data.filter(
              (m: { downloaded?: boolean }) => m.downloaded !== false,
            );
            return available.map((m: { id: string; name?: string }) => ({
              id: m.id,
              name: m.name || m.id,
            }));
          }
          // OpenAI format: {data: [{id, ...}, ...]}
          if (data.data && Array.isArray(data.data)) {
            return data.data.map((m: { id: string }) => ({
              id: m.id,
              name: m.id,
            }));
          }
        } catch {
          continue;
        }
      }
      return [];
    },
  );

  // ASR connectivity test (send 1s 440Hz sine wave, verify transcription)
  ipcMain.handle(
    "asr:test",
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
        const baseUrl = provider.isSidecar
          ? getSidecarBaseUrl(configDir)
          : provider.baseUrl;
        const resolvedUrl = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

        // Resolve model: sidecar uses local path, external uses provider.model
        let modelValue = provider.model ?? "";
        if (provider.isSidecar) {
          const config = readConfig(configDir);
          const asrModelId = config.selectedModelId;
          if (asrModelId) {
            const dataDir = config.dataDir ?? join(configDir, "data");
            modelValue = join(dataDir, "models", "asr", asrModelId);
          }
        }

        if (!modelValue) {
          return { success: false, error: "No ASR model selected" };
        }

        // Generate 1 second of 440Hz sine wave at 16kHz 16bit mono
        const sampleRate = 16000;
        const duration = 1; // seconds
        const frequency = 440; // Hz
        const numSamples = sampleRate * duration;
        const pcmBuffer = Buffer.alloc(numSamples * 2); // 16bit = 2 bytes per sample
        for (let i = 0; i < numSamples; i++) {
          const sample = Math.round(
            Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 16000,
          );
          pcmBuffer.writeInt16LE(sample, i * 2);
        }
        const wavBuffer = pcmToWav(pcmBuffer, sampleRate, 1, 16);

        const formData = new FormData();
        formData.append(
          "file",
          new Blob([wavBuffer], { type: "audio/wav" }),
          "test.wav",
        );
        formData.append("model", modelValue);

        // Sidecar may lazy-load the ASR model on first request
        const timeoutMs = provider.isSidecar ? 120_000 : 30_000;
        const resp = await net.fetch(`${resolvedUrl}/v1/audio/transcriptions`, {
          method: "POST",
          headers: {
            ...(provider.apiKey
              ? { Authorization: `Bearer ${provider.apiKey}` }
              : {}),
          },
          body: formData,
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          return { success: false, error: `HTTP ${resp.status}: ${errBody}` };
        }

        const result = (await resp.json()) as { text?: string };
        return { success: true, text: result.text ?? "" };
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  // Transcribe audio file via sidecar (file-path based, no ffmpeg)
  ipcMain.handle(
    "audio:transcribe-file",
    async (
      _event,
      filePath: string,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const baseUrl = provider.baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
      const resp = await net.fetch(`${baseUrl}/v1/audio/transcribe-file`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          file_path: filePath,
          model: provider.model,
        }),
        signal: AbortSignal.timeout(300000), // 5min for large files
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Transcribe file error (${resp.status}): ${errBody}`);
      }

      const data = (await resp.json()) as {
        text?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
        duration?: number;
      };
      return {
        text: data.text ?? "",
        segments: data.segments ?? [],
        duration: data.duration ?? 0,
      };
    },
  );

  // Keep convertToWav available for future use in this module
  void convertToWav;
}
