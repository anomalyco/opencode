import test from "node:test";
import assert from "node:assert/strict";
import { openaiProvider, anthropicProvider } from "../src/core/providers.ts";
import type { ConversationMessage } from "../src/core/types.ts";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < chunks.length) {
        controller.enqueue(encoder.encode(chunks[sent]!));
        sent++;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200 });
}

function fetchFrom(chunks: string[], captured: { url: string; init?: RequestInit }[]) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    captured.push({ url, init });
    return sseResponse(chunks);
  };
}

test("openaiProvider streams text deltas and accumulates tool calls", async () => {
  const chunks = [
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.txt\\"}"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
    "data: [DONE]\n\n",
  ];
  const captured: { url: string; init?: RequestInit }[] = [];
  const provider = openaiProvider({
    baseUrl: "https://api.example.com/v1",
    apiKey: "sk-test",
    model: "test-model",
    fetchImpl: fetchFrom(chunks, captured),
  });

  const events = [];
  for await (const ev of provider.stream({
    messages: [{ role: "user", text: "hi" }],
    system: "be brief",
    tools: [
      {
        name: "read_file",
        description: "read",
        parameters: { type: "object", properties: {} },
      },
    ],
  })) {
    events.push(ev);
  }

  const deltas = events.filter((e) => e.kind === "text_delta");
  assert.deepEqual(
    deltas.map((e) => (e as { text: string }).text),
    ["Hel", "lo"],
  );
  const message = events.find((e) => e.kind === "message")! as {
    message: { role: string; text: string; toolCalls: unknown[] };
  };
  assert.equal(message.message.text, "Hello");
  assert.equal(message.message.toolCalls.length, 1);
  assert.equal((message.message.toolCalls[0] as { id: string }).id, "c1");
  assert.equal(
    JSON.stringify((message.message.toolCalls[0] as { arguments: string }).arguments),
    JSON.stringify('{"path":"a.txt"}'),
  );

  // wire format checks
  const body = JSON.parse(String(captured[0]!.init?.body));
  assert.equal(captured[0]!.url, "https://api.example.com/v1/chat/completions");
  assert.equal(body.model, "test-model");
  assert.equal(body.stream, true);
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.tools[0].type, "function");
  assert.equal(captured[0]!.init?.headers && (captured[0]!.init!.headers as Record<string, string>)["authorization"], "Bearer sk-test");
});

test("openaiProvider maps prior tool results to role:tool messages", async () => {
  const captured: { url: string; init?: RequestInit }[] = [];
  const provider = openaiProvider({
    baseUrl: "https://api.example.com/v1",
    model: "m",
    fetchImpl: fetchFrom(["data: [DONE]\n\n"], captured),
  });
  const messages: ConversationMessage[] = [
    { role: "user", text: "run" },
    {
      role: "assistant",
      text: "",
      toolCalls: [{ id: "t1", name: "run_command", arguments: "{}" }],
    },
    { role: "tool", callId: "t1", name: "run_command", output: "ok", isError: false },
  ];
  for await (const _ of provider.stream({ messages, system: "", tools: [] })) {
    void _;
  }
  const wire = JSON.parse(String(captured[0]!.init?.body));
  assert.equal(wire.messages[2].role, "tool");
  assert.equal(wire.messages[2].tool_call_id, "t1");
  assert.equal(wire.messages[2].content, "ok");
});

test("anthropicProvider streams text and tool_use blocks", async () => {
  const chunks = [
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu_1","name":"glob"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"pattern\\":"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"**/*.ts\\"}"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  const captured: { url: string; init?: RequestInit }[] = [];
  const provider = anthropicProvider({
    baseUrl: "https://api.anthropic.com",
    apiKey: "ak-test",
    model: "claude-x",
    fetchImpl: fetchFrom(chunks, captured),
  });

  const events = [];
  for await (const ev of provider.stream({
    messages: [
      { role: "user", text: "find ts files" },
      {
        role: "assistant",
        text: "working",
        toolCalls: [{ id: "tu_0", name: "glob", arguments: '{"pattern":"x"}' }],
      },
      { role: "tool", callId: "tu_0", name: "glob", output: "x.ts", isError: false },
    ],
    system: "sys prompt",
    tools: [],
  })) {
    events.push(ev);
  }

  const message = events.find((e) => e.kind === "message")! as {
    message: { text: string; toolCalls: Array<{ name: string; arguments: string }> };
  };
  assert.equal(message.message.text, "Hi");
  assert.equal(message.message.toolCalls.length, 1);
  assert.equal(message.message.toolCalls[0]!.name, "glob");
  assert.equal(message.message.toolCalls[0]!.arguments, '{"pattern":"**/*.ts"}');

  const body = JSON.parse(String(captured[0]!.init?.body));
  assert.equal(captured[0]!.url, "https://api.anthropic.com/v1/messages");
  assert.equal(body.system, "sys prompt");
  assert.equal(body.max_tokens > 0, true);
  const headers = captured[0]!.init!.headers as Record<string, string>;
  assert.equal(headers["anthropic-version"], "2023-06-01");
  // tool result becomes a user turn with tool_result block
  const lastMsg = body.messages.at(-1);
  assert.equal(lastMsg.role, "user");
  assert.equal(lastMsg.content[0].type, "tool_result");
  assert.equal(lastMsg.content[0].tool_use_id, "tu_0");
});

test("provider surfaces HTTP errors as ProviderError", async () => {
  const provider = openaiProvider({
    baseUrl: "https://api.example.com/v1",
    model: "m",
    fetchImpl: async () =>
      new Response('{"error":"nope"}', { status: 401 }),
  });
  await assert.rejects(
    async () => {
      for await (const _ of provider.stream({
        messages: [{ role: "user", text: "x" }],
        system: "",
        tools: [],
      })) {
        void _;
      }
    },
    (err: Error) => err.message.includes("401"),
  );
});
