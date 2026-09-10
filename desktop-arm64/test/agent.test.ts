import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "../src/core/agent.ts";
import { ToolRegistry } from "../src/core/tools.ts";
import type {
  ConversationMessage,
  Provider,
  StreamEvent,
  ToolSpec,
} from "../src/core/types.ts";

type ProviderLike = Provider;

class ScriptedProvider implements Provider {
  readonly name = "scripted";
  readonly model = "test";
  private turns: StreamEvent[][];

  constructor(turns: StreamEvent[][]) {
    this.turns = turns;
  }

  async *stream(options: {
    messages: ConversationMessage[];
    system: string;
    tools: ToolSpec[];
    signal?: AbortSignal;
  }): AsyncGenerator<StreamEvent> {
    if (options.signal?.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    const turn = this.turns.shift();
    if (!turn) {
      yield {
        kind: "message",
        message: { role: "assistant", text: "(no script)", toolCalls: [] },
      };
      return;
    }
    for (const ev of turn) yield ev;
  }
}

async function collect(gen: AsyncGenerator<import("../src/core/types.ts").AgentEvent>) {
  const events: import("../src/core/types.ts").AgentEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

test("agent completes simple text turn", async () => {
  const provider = new ScriptedProvider([
    [
      { kind: "text_delta", text: "Hello" },
      { kind: "text_delta", text: "!" },
      {
        kind: "message",
        message: { role: "assistant", text: "Hello!", toolCalls: [] },
      },
    ],
  ]);
  const registry = new ToolRegistry({ root: process.cwd(), yolo: true });
  const agent = new Agent({ provider, tools: registry, system: "sys" });
  const events = await collect(agent.run("say hi"));

  assert.deepEqual(
    events.map((e) => e.kind),
    ["turn_start", "text_delta", "text_delta", "assistant_message", "done"],
  );
  assert.equal((events.at(-1) as { stopReason: string }).stopReason, "end_turn");
  assert.deepEqual(agent.messages.map((m) => m.role), ["user", "assistant"]);
});

test("agent runs tools across turns until end_turn", async () => {
  const provider = new ScriptedProvider([
    [
      { kind: "text_delta", text: "Let me check." },
      {
        kind: "message",
        message: {
          role: "assistant",
          text: "Let me check.",
          toolCalls: [
            { id: "c1", name: "list_dir", arguments: "{}" },
          ],
        },
      },
    ],
    [
      {
        kind: "message",
        message: { role: "assistant", text: "Directory listed.", toolCalls: [] },
      },
    ],
  ]);
  const registry = new ToolRegistry({ root: process.cwd(), yolo: true });
  const agent = new Agent({ provider, tools: registry, system: "sys" });

  const events = await collect(agent.run("what files exist"));
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds.at(-1), "done");
  assert.equal((events.at(-1) as { stopReason: string }).stopReason, "end_turn");
  assert.ok(kinds.includes("tool_start"));
  assert.ok(kinds.includes("tool_end"));

  // history shape: user, assistant(tool), tool, assistant(final)
  const roles = agent.messages.map((m) => m.role);
  assert.deepEqual(roles, ["user", "assistant", "tool", "assistant"]);
  const toolMsg = agent.messages[2]!;
  assert.equal(
    (toolMsg as { output: string }).output.length > 0,
    true,
  );
});

test("denied approval feeds error back and continues", async () => {
  const provider = new ScriptedProvider([
    [
      {
        kind: "message",
        message: {
          role: "assistant",
          text: "",
          toolCalls: [{ id: "d1", name: "run_command", arguments: '{"command":"echo x"}' }],
        },
      },
    ],
    [
      {
        kind: "message",
        message: { role: "assistant", text: "Understood.", toolCalls: [] },
      },
    ],
  ]);
  const registry = new ToolRegistry({ root: process.cwd() });
  let asked = 0;
  const agent = new Agent({
    provider,
    tools: registry,
    system: "sys",
    approval: async () => {
      asked++;
      return false;
    },
  });
  const events = await collect(agent.run("do it"));
  const toolEnd = events.find((e) => e.kind === "tool_end") as {
    isError: boolean;
    output: string;
  } | undefined;
  assert.ok(toolEnd);
  assert.equal(toolEnd.isError, true);
  assert.match(toolEnd.output, /denied/);
  assert.equal(asked, 1);
  assert.equal((events.at(-1) as { stopReason: string }).stopReason, "end_turn");
});

test("max_turns reached when model keeps calling tools", async () => {
  const endless: ProviderLike = {
    name: "endless",
    model: "x",
    async *stream() {
      yield {
        kind: "message",
        message: {
          role: "assistant",
          text: "",
          toolCalls: [
            { id: `c${Math.random()}`, name: "read_file", arguments: '{"path":"x"}' },
          ],
        },
      };
    },
  };
  const registry = new ToolRegistry({ root: process.cwd(), yolo: true });
  const agent = new Agent({
    provider: endless,
    tools: registry,
    system: "sys",
    maxTurns: 2,
  });
  const events = await collect(agent.run("loop"));
  const last = events.at(-1) as { kind: string; stopReason: string };
  assert.equal(last.stopReason, "max_turns");
  assert.equal(agent.messages.filter((m) => m.role === "user").length, 1);
});

test("provider errors map to done(provider_error)", async () => {
  const boom: Provider = {
    name: "boom",
    model: "x",
    async *stream() {
      yield { kind: "text_delta", text: "partial" };
      throw new Error("connection reset by peer");
    },
  };
  const registry = new ToolRegistry({ root: process.cwd(), yolo: true });
  const agent = new Agent({ provider: boom, tools: registry, system: "s" });
  const events = await collect(agent.run("hi"));
  const last = events.at(-1) as { kind: string; stopReason: string; error?: string };
  assert.equal(last.stopReason, "provider_error");
  assert.match(last.error ?? "", /connection reset/);
});

test("external abort stops the run", async () => {
  const provider = new ScriptedProvider([[
    { kind: "text_delta", text: "start..." },
    { kind: "message", message: { role: "assistant", text: "", toolCalls: [
      { id: "a1", name: "read_file", arguments: "{}" },
    ] } },
  ]]);
  const registry = new ToolRegistry({ root: process.cwd(), yolo: true });
  const ctrl = new AbortController();
  const agent = new Agent({
    provider,
    tools: registry,
    system: "s",
    signal: ctrl.signal,
  });
  const events: import("../src/core/types.ts").AgentEvent[] = [];
  const runner = collectInto(agent.run("go"), events);
  ctrl.abort();
  await runner;
  const last = events.at(-1) as { stopReason: string };
  assert.equal(last.stopReason, "aborted");
});

async function collectInto(
  gen: AsyncGenerator<import("../src/core/types.ts").AgentEvent>,
  sink: import("../src/core/types.ts").AgentEvent[],
): Promise<void> {
  for await (const ev of gen) sink.push(ev);
}

test("empty input short-circuits without provider call", async () => {
  let called = 0;
  const counting: Provider = {
    ...new ScriptedProvider([]),
    async *stream() {
      called++;
      yield { kind: "message", message: { role: "assistant", text: "x", toolCalls: [] } };
    },
  };
  const registry = new ToolRegistry({ root: process.cwd(), yolo: true });
  const agent = new Agent({ provider: counting, tools: registry, system: "s" });
  const events = await collect(agent.run("   "));
  assert.equal(called, 0);
  assert.equal((events.at(-1) as { stopReason: string }).stopReason, "end_turn");
});
