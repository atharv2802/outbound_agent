/**
 * OpenAI SDK wrapper. Raw transport only — the gateway layers retry, timeout,
 * rate limiting, circuit breaking, ledgering, and tracing on top of these.
 *
 * Exposes three primitives: chat completions (optionally with function/tool
 * calling), JSON-mode completions for structured outputs, and embeddings.
 */

import OpenAI from "openai";
import { getOpenAIKey } from "@/lib/config";

let client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ apiKey: getOpenAIKey() });
  }
  return client;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionOptions {
  model: string;
  messages: LLMMessage[];
  tools?: ToolSchema[];
  toolChoice?: "auto" | "required" | { name: string };
  jsonObject?: boolean;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  content: string | null;
  toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: string | null;
}

export async function complete(
  opts: CompletionOptions,
): Promise<CompletionResult> {
  const body: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
    model: opts.model,
    messages: opts.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    temperature: opts.temperature ?? 0.2,
  };

  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
    if (opts.toolChoice === "required") body.tool_choice = "required";
    else if (opts.toolChoice === "auto") body.tool_choice = "auto";
    else if (opts.toolChoice && typeof opts.toolChoice === "object") {
      body.tool_choice = {
        type: "function",
        function: { name: opts.toolChoice.name },
      };
    }
  }

  if (opts.jsonObject) {
    body.response_format = { type: "json_object" };
  }

  const res = await getClient().chat.completions.create(body, {
    signal: opts.signal,
  });

  const choice = res.choices[0];
  return {
    content: choice?.message?.content ?? null,
    toolCalls: choice?.message?.tool_calls ?? [],
    inputTokens: res.usage?.prompt_tokens ?? 0,
    outputTokens: res.usage?.completion_tokens ?? 0,
    model: res.model,
    finishReason: choice?.finish_reason ?? null,
  };
}

export interface EmbeddingResult {
  vectors: number[][];
  inputTokens: number;
  model: string;
}

export async function embed(
  model: string,
  inputs: string[],
  signal?: AbortSignal,
): Promise<EmbeddingResult> {
  const res = await getClient().embeddings.create(
    { model, input: inputs },
    { signal },
  );
  return {
    vectors: res.data.map((d) => d.embedding),
    inputTokens: res.usage?.prompt_tokens ?? 0,
    model: res.model,
  };
}

/** Surface a clear, typed error when the SDK throws. */
export function describeOpenAIError(err: unknown): {
  status?: number;
  code?: string;
  message: string;
} {
  if (err instanceof OpenAI.APIError) {
    return {
      status: err.status,
      code: err.code ?? undefined,
      message: err.message,
    };
  }
  const e = err as { name?: string; code?: string; message?: string };
  if (e?.name === "AbortError") {
    return { code: "ETIMEDOUT", message: "LLM call timed out" };
  }
  return { code: e?.code, message: e?.message ?? "Unknown LLM error" };
}
