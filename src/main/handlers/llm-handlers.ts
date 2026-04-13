import { ipcMain, net } from "electron";
import type { IpcDeps } from "./types";
import {
  readConfig,
  writeConfig,
  LlmProvider,
  PromptType,
  getEffectivePromptTypes,
  DEFAULT_PROMPT_TYPES,
} from "../config";
import {
  getSegments,
  addSummary,
  getSummaries,
  deleteSummary,
  saveTranslation,
  getTranslations,
} from "../database";

export function register(deps: IpcDeps): void {
  const { db, configDir, getMainWindow } = deps;

  // LLM Summarization (streaming SSE)
  ipcMain.handle(
    "llm:summarize",
    async (
      _event,
      sessionId: number,
      providerId: string,
      model: string,
      promptType: string,
    ) => {
      const win = getMainWindow();
      const config = readConfig(configDir);
      if (!providerId) {
        throw new Error("No LLM provider selected");
      }
      const provider = config.llmProviders.find(
        (p: LlmProvider) => p.id === providerId,
      );
      if (!provider) {
        throw new Error("Selected LLM provider not found");
      }

      // Resolve the system prompt from prompt type
      const effectiveTypes = getEffectivePromptTypes(config);
      const pType = effectiveTypes.find((t) => t.id === promptType);
      const systemPrompt =
        pType?.systemPrompt ??
        DEFAULT_PROMPT_TYPES.find((t) => t.id === "summarize")!.systemPrompt;

      // Gather all segments for this session
      const segments = getSegments(db, sessionId);
      if (segments.length === 0) {
        throw new Error("No transcript segments found for this session");
      }

      const transcriptText = segments.map((s: any) => s.text).join("\n");

      // Call OpenAI-compatible API with streaming
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120000);

      try {
        const baseUrl = provider.baseUrl.replace(/\/+$/, "");
        const resp = await net.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(provider.apiKey
              ? { Authorization: `Bearer ${provider.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: "system",
                content: systemPrompt,
              },
              {
                role: "user",
                content: transcriptText,
              },
            ],
            stream: true,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`LLM API error (${resp.status}): ${body}`);
        }

        // Parse SSE stream
        const reader = resp.body!.getReader();
        const decoder = new TextDecoder();
        let fullContent = "";
        let actualModel = model;
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                model?: string;
                choices?: { delta?: { content?: string } }[];
              };
              if (parsed.model) {
                actualModel = parsed.model;
              }
              const delta = parsed.choices?.[0]?.delta?.content ?? "";
              if (delta) {
                fullContent += delta;
                win?.webContents.send("llm:summary-chunk", {
                  content: delta,
                  done: false,
                  promptType,
                });
              }
            } catch {
              // Skip malformed JSON lines
            }
          }
        }

        // Signal streaming complete
        win?.webContents.send("llm:summary-chunk", {
          content: "",
          done: true,
          promptType,
        });

        if (!fullContent) {
          throw new Error("LLM returned empty response");
        }

        // Save to database
        const summaryId = addSummary(db, {
          sessionId,
          content: fullContent,
          modelName: actualModel,
          providerId: provider.id,
          promptType: promptType || "summarize",
        });

        // Return the new summary record
        return {
          id: summaryId,
          session_id: sessionId,
          content: fullContent,
          model_name: actualModel,
          provider_id: provider.id,
          prompt_type: promptType || "summarize",
          created_at: new Date().toLocaleString("sv-SE").replace(" ", "T"),
        };
      } catch (err) {
        // Signal error to renderer so streaming card can clean up
        win?.webContents.send("llm:summary-chunk", {
          content: "",
          done: true,
          promptType,
        });
        throw err;
      }
    },
  );

  // LLM Generate Title (non-streaming, for AI rename)
  ipcMain.handle(
    "llm:generate-title",
    async (
      _event,
      sessionId: number,
      providerId: string,
      model: string,
      systemPrompt: string,
    ) => {
      const config = readConfig(configDir);
      if (!providerId) {
        throw new Error("No LLM provider selected");
      }
      const provider = config.llmProviders.find(
        (p: LlmProvider) => p.id === providerId,
      );
      if (!provider) {
        throw new Error("Selected LLM provider not found");
      }

      const segments = getSegments(db, sessionId);
      if (segments.length === 0) {
        throw new Error("No transcript segments found for this session");
      }

      const transcriptText = segments.map((s: any) => s.text).join("\n");

      const baseUrl = provider.baseUrl.replace(/\/+$/, "");
      const resp = await net.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: transcriptText },
          ],
          stream: false,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`LLM API error (${resp.status}): ${body}`);
      }

      const data = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const title = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!title) {
        throw new Error("LLM returned empty title");
      }
      return title;
    },
  );

  // LLM Translate single segment (non-streaming)
  ipcMain.handle(
    "llm:translate",
    async (
      _event,
      providerId: string,
      model: string,
      text: string,
      targetLanguage: string,
      promptTemplate: string,
    ) => {
      const config = readConfig(configDir);
      if (!providerId) {
        throw new Error("No LLM provider selected for translation");
      }
      const provider = config.llmProviders.find(
        (p: LlmProvider) => p.id === providerId,
      );
      if (!provider) {
        throw new Error("Selected translate LLM provider not found");
      }

      const prompt = promptTemplate
        .replace("{{target_language}}", targetLanguage)
        .replace("{{text}}", text);

      const baseUrl = provider.baseUrl.replace(/\/+$/, "");

      const resp = await net.fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(provider.apiKey
            ? { Authorization: `Bearer ${provider.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          stream: false,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        throw new Error(`Translate API error (${resp.status}): ${body}`);
      }

      const json = (await resp.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = json.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new Error("LLM returned empty translation");
      }
      return content;
    },
  );

  // Translation persistence
  ipcMain.handle(
    "translation:save",
    (
      _event,
      segmentId: number,
      sessionId: number,
      targetLanguage: string,
      translatedText: string,
    ) => {
      return saveTranslation(db, {
        segmentId,
        sessionId,
        targetLanguage,
        translatedText,
      });
    },
  );

  ipcMain.handle(
    "translation:list",
    (_event, sessionId: number, targetLanguage: string) => {
      return getTranslations(db, sessionId, targetLanguage);
    },
  );

  // LLM Provider Test
  ipcMain.handle(
    "llm:test",
    async (
      _event,
      provider: { baseUrl: string; apiKey: string; model: string },
    ) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const baseUrl = provider.baseUrl.replace(/\/+$/, "");
        const resp = await net.fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
          },
          body: JSON.stringify({
            model: provider.model,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${body}`);
        }
        const data = (await resp.json()) as {
          model?: string;
        };
        return { success: true, model: data.model ?? provider.model };
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    },
  );

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
            signal: AbortSignal.timeout(15000),
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

  ipcMain.handle(
    "summary:list",
    (_event, sessionId: number, promptType?: string) => {
      return getSummaries(db, sessionId, promptType);
    },
  );

  ipcMain.handle("summary:delete", (_event, summaryId: number) => {
    deleteSummary(db, summaryId);
  });

  // Prompt Types
  ipcMain.handle("prompt-types:list", () => {
    const config = readConfig(configDir);
    return getEffectivePromptTypes(config);
  });

  ipcMain.handle("prompt-types:save", (_event, types: PromptType[]) => {
    const config = readConfig(configDir);
    writeConfig(configDir, { ...config, promptTypes: types });
  });
}
