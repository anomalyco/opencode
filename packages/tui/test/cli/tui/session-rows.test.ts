import { Agent } from "@opencode/schema/agent"
import { Shell } from "@opencode/schema/shell"
import { Provider } from "@opencode/schema/provider"
import { Model } from "@opencode/schema/model"
import { SessionMessage } from "@opencode/schema/session-message"
import { expect, test } from "bun:test"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"
import { createMemo, createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import {
  cacheReuseDrop,
  messageBoundaryIDs,
  reduceSessionRows,
  sessionRowID,
  turnDuration,
  turnTokensPerSecond,
} from "../../../src/routes/session/rows"

test("measures turn duration from the user prompt across assistant steps", () => {
  const first = assistant("assistant-1", [])
  first.time = { created: 8_000, completed: 11_000 }
  const final = assistant("assistant-2", [])
  final.time = { created: 27_000, completed: 30_000 }
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: SessionMessage.ID.make("user-1", { disableChecks: true }),
      text: "Question",
      time: { created: 1_000 },
    },
    first,
    final,
  ]

  expect(turnDuration(final, messages)).toBe(29_000)
})

test("measures request throughput including reasoning across model changes without tool time", () => {
  const first = assistant("assistant-1", [])
  first.time = { created: 6_000, streamed: 10_000, completed: 20_000 }
  first.tokens = { input: 10, output: 20, reasoning: 5, cache: { read: 0, write: 0 } }
  const final = assistant("assistant-2", [])
  final.model = {
    id: Model.ID.make("other-model", { disableChecks: true }),
    providerID: Provider.ID.make("other-provider", { disableChecks: true }),
    variant: Model.VariantID.make("other-variant", { disableChecks: true }),
  }
  final.time = { created: 24_000, streamed: 30_000, completed: 31_000 }
  final.tokens = { input: 20, output: 30, reasoning: 10, cache: { read: 0, write: 0 } }
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: SessionMessage.ID.make("user-1", { disableChecks: true }),
      text: "Question",
      time: { created: 1_000 },
    },
    first,
    final,
  ]

  expect(turnTokensPerSecond(final, messages)).toBe(6.5)
  first.time.streamed = undefined
  expect(turnTokensPerSecond(final, messages)).toBeUndefined()
})

test("omits turn throughput when a stream boundary is unavailable", () => {
  const final = assistant("assistant-1", [])
  final.tokens = { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
  expect(turnTokensPerSecond(final, [final])).toBeUndefined()
})

test.each([false, true])(
  "measures historical footers without later inputs or incomplete steps (indexed: %s)",
  (indexed) => {
    const step = (id: string, created: number, streamed: number, completed: number, output: number) => ({
      ...assistant(id, []),
      time: { created, streamed, completed },
      tokens: { input: 1, output, reasoning: 2, cache: { read: 0, write: 0 } },
    })
    const messages: SessionMessageInfo[] = [
      step("before-input", 0, 1_000, 2_000, 5),
      {
        type: "user",
        id: SessionMessage.ID.make("input", { disableChecks: true }),
        text: "Question",
        time: { created: 3_000 },
      },
      step("first-step", 4_000, 5_000, 6_000, 10),
      {
        type: "system",
        id: SessionMessage.ID.make("system", { disableChecks: true }),
        text: "Instructions",
        time: { created: 6_500 },
      },
      step("second-step", 7_000, 8_000, 9_000, 20),
      {
        type: "synthetic",
        id: SessionMessage.ID.make("synthetic", { disableChecks: true }),
        text: "Update",
        time: { created: 10_000 },
      },
      step("after-synthetic", 11_000, 13_000, 14_000, 12),
      {
        type: "user",
        id: SessionMessage.ID.make("later-input", { disableChecks: true }),
        text: "Next question",
        time: { created: 15_000 },
      },
      assistant("incomplete", []),
    ]

    expect(
      messages.flatMap((message, index) =>
        message.type === "assistant"
          ? [
              [
                turnDuration(message, messages, indexed ? index : undefined),
                turnTokensPerSecond(message, messages, indexed ? index : undefined),
              ],
            ]
          : [],
      ),
    ).toEqual([
      [2_000, 7],
      [3_000, 12],
      [6_000, 17],
      [4_000, 7],
      [0, undefined],
    ])
  },
)

test("preserves missing-anchor footer fallbacks without including the absent assistant's tokens", () => {
  const absent = assistant("absent", [])
  absent.time = { created: 8_000, streamed: 9_000, completed: 10_000 }
  absent.tokens = { input: 1, output: 900, reasoning: 0, cache: { read: 0, write: 0 } }
  const stored = assistant("stored", [])
  stored.time = { created: 6_000, streamed: 8_000, completed: 9_000 }
  stored.tokens = { input: 1, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
  const input: SessionMessageInfo = {
    type: "user",
    id: SessionMessage.ID.make("input", { disableChecks: true }),
    text: "Question",
    time: { created: 5_000 },
  }

  expect(turnDuration(absent, [input, stored])).toBe(5_000)
  expect(turnTokensPerSecond(absent, [input, stored])).toBe(10)
  expect(turnDuration(absent, [stored])).toBe(2_000)
  expect(turnTokensPerSecond(absent, [stored])).toBe(10)
  expect(turnDuration(absent, [])).toBe(2_000)
  expect(turnTokensPerSecond(absent, [])).toBeUndefined()
})

test("indexed tail footer calculations do not subscribe to an unrelated history prefix", () => {
  createRoot((dispose) => {
    try {
      const final = assistant("final", [])
      final.time = { created: 2_000, streamed: 3_000, completed: 5_000 }
      final.tokens = { input: 1, output: 20, reasoning: 0, cache: { read: 0, write: 0 } }
      const [messages, setMessages] = createStore<SessionMessageInfo[]>([
        {
          type: "user",
          id: SessionMessage.ID.make("old-input", { disableChecks: true }),
          text: "Old question",
          time: { created: 0 },
        },
        assistant("old-step", []),
        {
          type: "user",
          id: SessionMessage.ID.make("input", { disableChecks: true }),
          text: "Current question",
          time: { created: 1_000 },
        },
        final,
      ])
      let runs = 0
      const footer = createMemo(() => {
        runs++
        const current = messages[3]
        if (current.type !== "assistant") throw new Error("Expected an assistant")
        return [turnDuration(current, messages, 3), turnTokensPerSecond(current, messages, 3)]
      })
      expect(footer()).toEqual([4_000, 20])
      setMessages(0, {
        type: "user",
        id: SessionMessage.ID.make("replaced-prefix", { disableChecks: true }),
        text: "Older question",
        time: { created: 50 },
      })
      expect(footer()).toEqual([4_000, 20])
      expect(runs).toBe(1)

      setMessages(2, "time", "created", 1_500)
      expect(footer()).toEqual([3_500, 20])
      setMessages(3, { ...final, time: { ...final.time, streamed: 4_000 }, tokens: { ...final.tokens, output: 60 } })
      expect(footer()).toEqual([3_500, 30])
      expect(runs).toBe(3)
    } finally {
      dispose()
    }
  })
})

test("filters OpenAI cache quantization from cache reuse drops", () => {
  const openai = {
    id: Model.ID.make("gpt", { disableChecks: true }),
    providerID: Provider.ID.make("openai", { disableChecks: true }),
  }
  expect(cacheReuseDrop(undefined, { read: 10_000, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 11_000, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 8_977, model: openai })).toBe(1_023)
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 8_976, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 8_500, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 7_952, model: openai })).toBeUndefined()
  expect(cacheReuseDrop({ read: 10_000, model: openai }, { read: 7_951, model: openai })).toBe(2_049)
})

test("compares cache reuse only for the same model", () => {
  const previous = {
    read: 10_000,
    model: {
      id: Model.ID.make("claude", { disableChecks: true }),
      providerID: Provider.ID.make("anthropic", { disableChecks: true }),
    },
  }
  expect(
    cacheReuseDrop(previous, {
      read: 8_976,
      model: {
        id: Model.ID.make("gpt", { disableChecks: true }),
        providerID: Provider.ID.make("openai", { disableChecks: true }),
      },
    }),
  ).toBeUndefined()
  expect(
    cacheReuseDrop(previous, {
      read: 8_976,
      model: {
        id: Model.ID.make("claude", { disableChecks: true }),
        providerID: Provider.ID.make("anthropic", { disableChecks: true }),
      },
    }),
  ).toBe(1_024)
  expect(
    cacheReuseDrop(
      {
        read: 10_000,
        model: {
          id: Model.ID.make("gpt", { disableChecks: true }),
          providerID: Provider.ID.make("openai", { disableChecks: true }),
          variant: Model.VariantID.make("low", { disableChecks: true }),
        },
      },
      {
        read: 8_976,
        model: {
          id: Model.ID.make("gpt", { disableChecks: true }),
          providerID: Provider.ID.make("openai", { disableChecks: true }),
          variant: Model.VariantID.make("high", { disableChecks: true }),
        },
      },
    ),
  ).toBeUndefined()
})

test("carries model identity with the cross-turn cache baseline", () => {
  const first = assistant("assistant-1", [])
  first.model = {
    id: Model.ID.make("claude", { disableChecks: true }),
    providerID: Provider.ID.make("anthropic", { disableChecks: true }),
  }
  first.finish = "stop"
  first.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 10_000, write: 0 } }
  const second = assistant("assistant-2", [])
  second.model = {
    id: Model.ID.make("gpt", { disableChecks: true }),
    providerID: Provider.ID.make("openai", { disableChecks: true }),
  }
  second.finish = "stop"
  second.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 8_976, write: 0 } }

  const rows = reduceSessionRows(
    [
      {
        type: "user",
        id: SessionMessage.ID.make("user-1", { disableChecks: true }),
        text: "First",
        time: { created: 0 },
      },
      first,
      {
        type: "user",
        id: SessionMessage.ID.make("user-2", { disableChecks: true }),
        text: "Second",
        time: { created: 2 },
      },
      second,
    ],
    new Set(),
    true,
  ).filter((row) => row.type === "turn-usage")

  expect(rows).toEqual([
    { type: "turn-usage", messageIDs: [SessionMessage.ID.make("assistant-1", { disableChecks: true })] },
    {
      type: "turn-usage",
      messageIDs: [SessionMessage.ID.make("assistant-2", { disableChecks: true })],
      previousCache: {
        read: 10_000,
        model: {
          id: Model.ID.make("claude", { disableChecks: true }),
          providerID: Provider.ID.make("anthropic", { disableChecks: true }),
        },
      },
    },
  ])
})

test("resets the cross-turn cache baseline after compaction", () => {
  const first = assistant("assistant-1", [])
  first.finish = "stop"
  first.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 370_176, write: 0 } }
  const second = assistant("assistant-2", [])
  second.finish = "stop"
  second.tokens = { input: 1, output: 0, reasoning: 0, cache: { read: 13_824, write: 0 } }

  const rows = reduceSessionRows(
    [
      first,
      {
        type: "compaction",
        id: SessionMessage.ID.make("compaction-1", { disableChecks: true }),
        status: "completed",
        reason: "auto",
        summary: "Compacted context",
        recent: "",
        time: { created: 2 },
      },
      second,
    ],
    new Set(),
    true,
  ).filter((row) => row.type === "turn-usage")

  expect(rows).toEqual([
    { type: "turn-usage", messageIDs: [SessionMessage.ID.make("assistant-1", { disableChecks: true })] },
    { type: "turn-usage", messageIDs: [SessionMessage.ID.make("assistant-2", { disableChecks: true })] },
  ])
})

test("closes turn usage on the idle marker so steered steps share one footer", () => {
  const step = (id: string, read: number) => ({
    ...assistant(id, []),
    finish: "stop" as const,
    tokens: { input: 1, output: 0, reasoning: 0, cache: { read, write: 0 } },
  })
  const idle = (id: string, created: number): SessionMessageInfo => ({
    type: "idle",
    id: SessionMessage.ID.make(id, { disableChecks: true }),
    outcome: "succeeded",
    time: { created },
  })
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: SessionMessage.ID.make("user-1", { disableChecks: true }),
      text: "First",
      time: { created: 0 },
    },
    step("assistant-1", 1_000),
    {
      type: "user",
      id: SessionMessage.ID.make("steer", { disableChecks: true }),
      text: "Also this",
      time: { created: 2 },
    },
    step("assistant-2", 2_000),
    idle("idle-1", 3),
    {
      type: "user",
      id: SessionMessage.ID.make("user-2", { disableChecks: true }),
      text: "Second",
      time: { created: 4 },
    },
    step("assistant-3", 3_000),
    {
      type: "user",
      id: SessionMessage.ID.make("steer-2", { disableChecks: true }),
      text: "Wait",
      time: { created: 5 },
    },
    step("assistant-4", 4_000),
  ]

  expect(reduceSessionRows(messages, new Set(), true)).toEqual([
    { type: "message", messageID: SessionMessage.ID.make("user-1", { disableChecks: true }) },
    { type: "assistant-footer", messageID: SessionMessage.ID.make("assistant-1", { disableChecks: true }) },
    { type: "message", messageID: SessionMessage.ID.make("steer", { disableChecks: true }) },
    { type: "assistant-footer", messageID: SessionMessage.ID.make("assistant-2", { disableChecks: true }) },
    {
      type: "turn-usage",
      messageIDs: [
        SessionMessage.ID.make("assistant-1", { disableChecks: true }),
        SessionMessage.ID.make("assistant-2", { disableChecks: true }),
      ],
    },
    { type: "message", messageID: SessionMessage.ID.make("user-2", { disableChecks: true }) },
    { type: "assistant-footer", messageID: SessionMessage.ID.make("assistant-3", { disableChecks: true }) },
    { type: "message", messageID: SessionMessage.ID.make("steer-2", { disableChecks: true }) },
    { type: "assistant-footer", messageID: SessionMessage.ID.make("assistant-4", { disableChecks: true }) },
  ])
  expect(
    reduceSessionRows([...messages, idle("idle-2", 6)], new Set(), true).filter((row) => row.type === "turn-usage"),
  ).toEqual([
    {
      type: "turn-usage",
      messageIDs: [
        SessionMessage.ID.make("assistant-1", { disableChecks: true }),
        SessionMessage.ID.make("assistant-2", { disableChecks: true }),
      ],
    },
    {
      type: "turn-usage",
      messageIDs: [
        SessionMessage.ID.make("assistant-3", { disableChecks: true }),
        SessionMessage.ID.make("assistant-4", { disableChecks: true }),
      ],
      previousCache: {
        read: 2_000,
        model: {
          id: Model.ID.make("model", { disableChecks: true }),
          providerID: Provider.ID.make("provider", { disableChecks: true }),
        },
      },
    },
  ])
})

test("measures a marker-era turn from its first prompt across steers", () => {
  const step = (id: string, created: number, streamed: number, completed: number, output: number) => ({
    ...assistant(id, []),
    time: { created, streamed, completed },
    tokens: { input: 1, output, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: SessionMessage.ID.make("old-input", { disableChecks: true }),
      text: "Old question",
      time: { created: 0 },
    },
    step("old-step", 1_000, 2_000, 3_000, 5),
    {
      type: "idle",
      id: SessionMessage.ID.make("idle-1", { disableChecks: true }),
      outcome: "succeeded",
      time: { created: 3_500 },
    },
    {
      type: "user",
      id: SessionMessage.ID.make("input", { disableChecks: true }),
      text: "Question",
      time: { created: 4_000 },
    },
    step("first-step", 5_000, 6_000, 7_000, 10),
    {
      type: "user",
      id: SessionMessage.ID.make("steer", { disableChecks: true }),
      text: "Also this",
      time: { created: 7_500 },
    },
    step("second-step", 8_000, 9_000, 10_000, 20),
  ]
  const final = messages[6]
  if (final.type !== "assistant") throw new Error("Expected an assistant")

  expect(turnDuration(final, messages)).toBe(6_000)
  expect(turnTokensPerSecond(final, messages)).toBe(15)
  expect(turnDuration(final, messages, 6, true)).toBe(2_500)
  expect(turnTokensPerSecond(final, messages, 6, true)).toBe(20)
})

test("assigns assistant boundaries to the first rendered row instead of the first text row", () => {
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: SessionMessage.ID.make("user-1", { disableChecks: true }),
      text: "Question",
      time: { created: 0 },
    },
    assistant("assistant-1", [
      { type: "reasoning", text: "Thinking" },
      { type: "text", text: "First" },
      { type: "text", text: "Second" },
    ]),
  ]
  const rows = reduceSessionRows(messages)

  expect(messageBoundaryIDs(rows, messages)).toEqual([
    SessionMessage.ID.make("user-1", { disableChecks: true }),
    SessionMessage.ID.make("assistant-1", { disableChecks: true }),
    undefined,
    undefined,
  ])
})

test("assigns stable IDs to tool rows for direct navigation", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "text", text: "Starting a shell" },
      { type: "tool", id: "shell-1", name: "shell", state: pending(), time: { created: 2 } },
    ]),
    assistant("assistant-2", [{ type: "tool", id: "shell-2", name: "shell", state: pending(), time: { created: 3 } }]),
  ]
  const rows = reduceSessionRows(messages)
  const boundaries = messageBoundaryIDs(rows, messages)

  expect(rows.map((row, index) => sessionRowID(row, boundaries[index]))).toEqual([
    "assistant-1",
    "session-part:assistant-1:shell-1",
    "assistant-2",
  ])
})

test("groups exploration parts across assistant messages until a delimiter", () => {
  const messages: SessionMessageInfo[] = [
    {
      type: "user",
      id: SessionMessage.ID.make("user-1", { disableChecks: true }),
      text: "Explore",
      time: { created: 0 },
    },
    assistant("assistant-1", [
      { type: "text", text: "Looking" },
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 2 } },
      { type: "tool", id: "glob-1", name: "glob", state: pending(), time: { created: 3 } },
    ]),
    assistant("assistant-2", [
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 5 } },
      { type: "text", text: "Done" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    { type: "message", messageID: SessionMessage.ID.make("user-1", { disableChecks: true }) },
    {
      type: "part",
      ref: { messageID: SessionMessage.ID.make("assistant-1", { disableChecks: true }), partID: "text:0" },
    },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      size: 3,
      children: [
        partChild("assistant-1", "read-1"),
        partChild("assistant-1", "glob-1"),
        partChild("assistant-2", "grep-1"),
      ],
    },
    {
      type: "part",
      ref: { messageID: SessionMessage.ID.make("assistant-2", { disableChecks: true }), partID: "text:0" },
    },
  ])
})

test("keeps non-exploration tools as individual part rows", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } },
      { type: "tool", id: "reasoning:0", name: "bash", state: pending(), time: { created: 2 } },
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      size: 1,
      children: [partChild("assistant-1", "read-1")],
    },
    {
      type: "part",
      ref: { messageID: SessionMessage.ID.make("assistant-1", { disableChecks: true }), partID: "reasoning:0" },
    },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      size: 1,
      children: [partChild("assistant-1", "grep-1")],
    },
  ])
})

test("assigns stable kind ordinals within an assistant message", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "text", text: "First" },
      { type: "reasoning", text: "Think" },
      { type: "text", text: "Second" },
      { type: "reasoning", text: "Check" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "part",
      ref: { messageID: SessionMessage.ID.make("assistant-1", { disableChecks: true }), partID: "text:0" },
    },
    {
      type: "group",
      kind: "reasoning",
      completed: true,
      size: 1,
      children: [partChild("assistant-1", "reasoning:0")],
    },
    {
      type: "part",
      ref: { messageID: SessionMessage.ID.make("assistant-1", { disableChecks: true }), partID: "text:1" },
    },
    {
      type: "group",
      kind: "reasoning",
      completed: false,
      size: 1,
      children: [partChild("assistant-1", "reasoning:1")],
    },
  ])
})

test("groups adjacent reasoning parts until a visible boundary", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "reasoning", text: "First" },
      { type: "reasoning", text: "Second" },
      { type: "text", text: "Visible" },
      { type: "reasoning", text: "Third" },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "reasoning",
      completed: true,
      size: 2,
      children: [partChild("assistant-1", "reasoning:0"), partChild("assistant-1", "reasoning:1")],
    },
    {
      type: "part",
      ref: { messageID: SessionMessage.ID.make("assistant-1", { disableChecks: true }), partID: "text:0" },
    },
    {
      type: "group",
      kind: "reasoning",
      completed: false,
      size: 1,
      children: [partChild("assistant-1", "reasoning:2")],
    },
  ])
})

test("groups across empty assistant reasoning parts", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [
      { type: "reasoning", text: "Looking" },
      { type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 2 } },
    ]),
    assistant("assistant-2", [
      { type: "reasoning", text: "" },
      { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
    ]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "reasoning",
      completed: true,
      size: 1,
      children: [partChild("assistant-1", "reasoning:0")],
    },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      size: 2,
      children: [partChild("assistant-1", "read-1"), partChild("assistant-2", "grep-1")],
    },
  ])
})

test("completes exploration groups when another row follows", () => {
  const finished = assistant("assistant-2", [
    { type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } },
  ])
  finished.finish = "stop"
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "user",
      id: SessionMessage.ID.make("user-1", { disableChecks: true }),
      text: "Continue",
      time: { created: 2 },
    },
    finished,
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      size: 1,
      children: [partChild("assistant-1", "read-1")],
    },
    { type: "message", messageID: SessionMessage.ID.make("user-1", { disableChecks: true }) },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      size: 1,
      children: [partChild("assistant-2", "grep-1")],
    },
    { type: "assistant-footer", messageID: SessionMessage.ID.make("assistant-2", { disableChecks: true }) },
  ])
})

test("hides synthetic messages without descriptions", () => {
  const messages: SessionMessageInfo[] = [
    {
      id: SessionMessage.ID.make("shell-message", { disableChecks: true }),
      type: "shell",
      shellID: Shell.ID.make("sh_user", { disableChecks: true }),
      command: "pwd",
      status: "exited",
      time: { created: 0 },
    },
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "synthetic",
      id: SessionMessage.ID.make("synthetic-1", { disableChecks: true }),
      text: "internal context",
      metadata: { source: "shell", shellID: Shell.ID.make("sh_user", { disableChecks: true }), state: "completed" },
      time: { created: 2 },
    },
    assistant("assistant-2", [{ type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } }]),
  ]

  const rows = reduceSessionRows(messages)
  expect(rows).toEqual([
    { type: "message", messageID: SessionMessage.ID.make("shell-message", { disableChecks: true }) },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      size: 2,
      children: [partChild("assistant-1", "read-1"), partChild("assistant-2", "grep-1")],
    },
  ])
  expect(reduceSessionRows(messages, new Set(["synthetic-1"]))).toEqual(rows)
})

test("renders synthetic messages with descriptions", () => {
  const messages: SessionMessageInfo[] = [
    assistant("assistant-1", [{ type: "tool", id: "read-1", name: "read", state: pending(), time: { created: 1 } }]),
    {
      type: "synthetic",
      id: SessionMessage.ID.make("synthetic-1", { disableChecks: true }),
      text: "internal context",
      description: "Explicit notice",
      time: { created: 2 },
    },
    assistant("assistant-2", [{ type: "tool", id: "grep-1", name: "grep", state: pending(), time: { created: 3 } }]),
  ]

  expect(reduceSessionRows(messages)).toEqual([
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: true,
      size: 1,
      children: [partChild("assistant-1", "read-1")],
    },
    { type: "message", messageID: SessionMessage.ID.make("synthetic-1", { disableChecks: true }) },
    {
      type: "group",
      kind: "exploration",
      pending: [],
      completed: false,
      size: 1,
      children: [partChild("assistant-2", "grep-1")],
    },
  ])
})

function partChild(messageID: string, partID: string) {
  return {
    type: "entry" as const,
    entry: {
      type: "part" as const,
      ref: { messageID: SessionMessage.ID.make(messageID, { disableChecks: true }), partID },
    },
    size: 1 as const,
  }
}

test("renders a footer for a pre-output retry assistant after replay", () => {
  const message = assistant("assistant-retry", [])
  message.retry = {
    attempt: 2,
    at: 2_000,
    error: { type: "provider.transport", message: "Disconnected" },
  }

  expect(reduceSessionRows([message])).toEqual([
    { type: "assistant-footer", messageID: SessionMessage.ID.make("assistant-retry", { disableChecks: true }) },
  ])
})

test("places a running compaction barrier before every queued user message", () => {
  const queued = (id: string, text: string, created: number): SessionMessageInfo => ({
    type: "user",
    id: SessionMessage.ID.make(id, { disableChecks: true }),
    text,
    time: { created },
  })
  const messages: SessionMessageInfo[] = [
    queued("user-before", "Before", 1),
    {
      type: "compaction",
      id: SessionMessage.ID.make("compaction", { disableChecks: true }),
      status: "running",
      reason: "manual",
      summary: "",
      recent: "",
      time: { created: 2 },
    },
    queued("user-after", "After", 3),
  ]

  expect(reduceSessionRows(messages, new Set(["user-before", "user-after"]))).toEqual([
    { type: "message", messageID: SessionMessage.ID.make("compaction", { disableChecks: true }) },
    { type: "message", messageID: SessionMessage.ID.make("user-before", { disableChecks: true }) },
    { type: "message", messageID: SessionMessage.ID.make("user-after", { disableChecks: true }) },
  ])
})

function assistant(id: string, content: SessionMessageAssistant["content"]): SessionMessageAssistant {
  return {
    type: "assistant",
    id: SessionMessage.ID.make(id, { disableChecks: true }),
    agent: Agent.ID.make("build", { disableChecks: true }),
    model: {
      id: Model.ID.make("model", { disableChecks: true }),
      providerID: Provider.ID.make("provider", { disableChecks: true }),
    },
    content,
    time: { created: 1 },
  }
}

function pending() {
  return { status: "streaming" as const, input: "" }
}
