import type {
  ConversationMessage,
  Provider,
  StreamEvent,
  ToolCallRequest,
  ToolSpec,
} from "./types.ts";
import { sseStream } from "./sse.ts";

export type FetchLike = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export class ProviderError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`provider HTTP ${status}: ${truncate(body, 400)}`);
    this.name = "ProviderError";
    this.status = status;
    this.body = body;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

async function assertOk(res: Response): Promise<void> {
  if (res.ok && res.body) return;
  let body = "";
  try {
    body = await res.text();
  } catch {
    body = "<unreadable body>";
  }
  throw new ProviderError(res.status, body);
}

export interface ProviderConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: FetchLike;
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible                                                   */
/* ------------------------------------------------------------------ */

interface OpenAiDelta {
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface OpenAiChunk {
  choices?: Array<{
    delta?: OpenAiDelta;
    finish_reason?: string | null;
  }>;
}

export function openaiProvider(config: ProviderConfig): Provider {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    name: "openai",
    model: config.model,
    async *stream({ messages, system, tools, signal }) {
      const wireMessages: unknown[] = [];
      if (system.trim().length > 0) {
        wireMessages.push({ role: "system", content: system });
      }
      for (const m of messages) wireMessages.push(toOpenAiMessage(m));
      const body = {
        model: config.model,
        messages: wireMessages,
        stream: true,
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                type: "function",
                function: {
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                },
              })),
            }
          : {}),
      };
      const res = await doFetch(`${joinUrl(config.baseUrl, "/chat/completions")}`, {
        method: "POST",
        headers: headers(config.apiKey),
        body: JSON.stringify(body),
        signal,
      });
      await assertOk(res);

      let text = "";
      const calls = new Map<number, ToolCallRequest>();
      for await (const ev of sseStream(res.body!)) {
        if (ev.data === "[DONE]") break;
        let chunk: OpenAiChunk;
        try {
          chunk = JSON.parse(ev.data) as OpenAiChunk;
        } catch {
          continue;
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === "string" && delta.content.length > 0) {
          text += delta.content;
          yield { kind: "text_delta", text: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const existing =
            calls.get(tc.index) ??
            ({ id: "", name: "", arguments: "" } satisfies ToolCallRequest);
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          calls.set(tc.index, existing);
        }
      }
      const ordered = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, c]) => c)
        .filter((c) => c.name.length > 0);
      yield {
        kind: "message",
        message: { role: "assistant", text, toolCalls: ordered },
      };
    },
  };
}

function toOpenAiMessage(m: ConversationMessage): unknown {
  switch (m.role) {
    case "user":
      return { role: "user", content: m.text };
    case "assistant": {
      const out: Record<string, unknown> = { role: "assistant", content: m.text };
      if (m.toolCalls.length > 0) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.arguments },
        }));
      }
      return out;
    }
    case "tool":
      return {
        role: "tool",
        tool_call_id: m.callId,
        content: m.output,
      };
  }
}

/* ------------------------------------------------------------------ */
/* Anthropic-compatible                                                */
/* ------------------------------------------------------------------ */

interface AnthropicBlockStart {
  type: string;
  id?: string;
  name?: string;
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: AnthropicBlockStart;
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
}

export function anthropicProvider(config: ProviderConfig): Provider {
  const doFetch = config.fetchImpl ?? fetch;
  return {
    name: "anthropic",
    model: config.model,
    async *stream({ messages, system, tools, signal }) {
      const body = {
        model: config.model,
        max_tokens: 8192,
        ...(system.trim().length > 0 ? { system } : {}),
        messages: toAnthropicMessages(messages),
        stream: true,
        ...(tools.length > 0
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
            }
          : {}),
      };
      const res = await doFetch(`${joinUrl(config.baseUrl, "/v1/messages")}`, {
        method: "POST",
        headers: {
          ...headers(config.apiKey),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal,
      });
      await assertOk(res);

      let text = "";
      const order: number[] = [];
      const byIndex = new Map<
        number,
        { kind: "text"; text: string } | { kind: "tool"; call: ToolCallRequest }
      >();
      for await (const ev of sseStream(res.body!)) {
        let parsed: AnthropicEvent;
        try {
          parsed = JSON.parse(ev.data) as AnthropicEvent;
        } catch {
          continue;
        }
        if (parsed.type === "content_block_start" && parsed.content_block) {
          const index = parsed.index ?? 0;
          const block = parsed.content_block;
          if (block.type === "text") {
            byIndex.set(index, { kind: "text", text: "" });
            order.push(index);
          } else if (block.type === "tool_use" && block.id && block.name) {
            byIndex.set(index, {
              kind: "tool",
              call: { id: block.id, name: block.name, arguments: "" },
            });
            order.push(index);
          }
        } else if (parsed.type === "content_block_delta" && parsed.delta) {
          const slot = byIndex.get(parsed.index ?? 0);
          if (!slot) continue;
          if (
            slot.kind === "text" &&
            parsed.delta.type === "text_delta" &&
            typeof parsed.delta.text === "string"
          ) {
            slot.text += parsed.delta.text;
            text += parsed.delta.text;
            yield { kind: "text_delta", text: parsed.delta.text };
          } else if (
            slot.kind === "tool" &&
            parsed.delta.type === "input_json_delta" &&
            typeof parsed.delta.partial_json === "string"
          ) {
            slot.call.arguments += parsed.delta.partial_json;
          }
        }
      }
      const toolCalls = order
        .sort((a, b) => a - b)
        .map((i) => byIndex.get(i))
        .filter((s): s is { kind: "tool"; call: ToolCallRequest } => s?.kind === "tool")
        .map((s) => s.call);
      yield {
        kind: "message",
        message: { role: "assistant", text, toolCalls },
      };
    },
  };
}

function toAnthropicMessages(messages: ConversationMessage[]): unknown[] {
  const out: Array<{
    role: "user" | "assistant";
    content: unknown[];
  }> = [];
  for (const m of messages) {
    if (m.role === "user") {
      pushOrMerge(out, "user", [{ type: "text", text: m.text }]);
    } else if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.text.length > 0) content.push({ type: "text", text: m.text });
      for (const c of m.toolCalls) {
        let input: unknown = {};
        try {
          input = c.arguments.trim() ? JSON.parse(c.arguments) : {};
        } catch {
          input = { _raw: c.arguments };
        }
        content.push({ type: "tool_use", id: c.id, name: c.name, input });
      }
      pushOrMerge(out, "assistant", content);
    } else {
      pushOrMerge(out, "user", [
        {
          type: "tool_result",
          tool_use_id: m.callId,
          content: m.output,
          is_error: m.isError,
        },
      ]);
    }
  }
  return out;
}

function pushOrMerge(
  out: Array<{ role: "user" | "assistant"; content: unknown[] }>,
  role: "user" | "assistant",
  content: unknown[],
): void {
  const last = out.at(-1);
  if (last && last.role === role) {
    last.content.push(...content);
  } else {
    out.push({ role, content });
  }
}

/* ------------------------------------------------------------------ */

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

function headers(apiKey: string | undefined): Record<string, string> {
  const h: Record<string, string> = {
    "content-type": "application/json",
  };
  if (apiKey) h["authorization"] = `Bearer ${apiKey}`;
  return h;
}

export function createProvider(
  protocol: "openai" | "anthropic",
  config: ProviderConfig,
): Provider {
  return protocol === "openai"
    ? openaiProvider(config)
    : anthropicProvider(config);
}
