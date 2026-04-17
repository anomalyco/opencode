import { describe, expect, test } from "bun:test"
import path from "path"
import type { ModelMessage } from "ai"
import { ContextDump } from "../../src/session/dump"
import { Instance } from "../../src/project/instance"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { SessionID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

type Dump = Awaited<ReturnType<typeof ContextDump.assemble>>

const request: Dump["request"] = {
  tools: {},
  activeTools: [],
  toolChoice: undefined,
  headers: {
    "User-Agent": "opencode/test",
    "x-session-affinity": SessionID.make("test"),
  },
  maxRetries: 0,
  abort: {
    present: false,
    aborted: false,
  },
  experimentalTelemetry: {
    isEnabled: false,
    functionId: "session.llm",
    metadata: {
      userId: "unknown",
      sessionId: SessionID.make("test"),
    },
  },
}

function content(overrides?: Partial<Dump>) {
  return {
    timestamps: {
      generated_at: Date.now(),
      generated_at_iso: new Date("2026-04-17T12:34:56.000Z").toISOString(),
    },
    model: {
      id: ModelID.make("gpt-5"),
      name: "GPT-5",
      providerID: ProviderID.make("openai"),
      apiID: "gpt-5",
      variant: undefined,
    },
    system: ["You are helpful", "Today is Wednesday"],
    messages: [
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hello" },
    ] satisfies ModelMessage[],
    options: {
      temperature: 0.4,
      topP: 0.8,
      topK: 32,
      maxOutputTokens: 8192,
      providerOptions: { foo: { bar: true } },
    },
    request,
    ...overrides,
  } satisfies Dump
}

describe("ContextDump.write", () => {
  test("writes a text dump with readable sections", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = await ContextDump.write({
          sessionID: SessionID.make("sess-text"),
          content: content(),
          format: "text",
        })
        const text = await Bun.file(file).text()
        expect(file).toEndWith(".txt")
        expect(text).toContain("=== METADATA ===")
        expect(text).toContain("=== SYSTEM PROMPT ===")
        expect(text).toContain("=== MESSAGES ===")
        expect(text).toContain("=== TOOLS ===")
        expect(text).toContain("=== REQUEST OPTIONS ===")
        expect(text).toContain("gpt-5")
      },
    })
  })

  test("writes a json dump", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = await ContextDump.write({
          sessionID: SessionID.make("sess-json"),
          content: content({
            system: ["System"],
            messages: [{ role: "user", content: "Hi" }] satisfies ModelMessage[],
          }),
          format: "json",
        })
        expect(file).toEndWith(".json")
        const json = await Bun.file(file).json()
        expect(json.system).toEqual(["System"])
        expect(json.messages).toHaveLength(1)
        expect(json.request.activeTools).toEqual([])
      },
    })
  })

  test("creates the default dumps directory when missing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = await ContextDump.write({
          sessionID: SessionID.make("sess-dir"),
          content: content({ messages: [] satisfies ModelMessage[] }),
          format: "text",
        })
        expect(await Bun.file(file).exists()).toBe(true)
        expect(path.dirname(file)).toBe(path.join(tmp.path, ".opencode", "dumps"))
      },
    })
  })

  test("uses a configured dump directory when provided", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          dump_context: ".artifacts/dumps",
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = await ContextDump.write({
          sessionID: SessionID.make("sess-custom"),
          content: content({ messages: [] satisfies ModelMessage[] }),
          format: "text",
        })
        expect(path.dirname(file)).toBe(path.join(tmp.path, ".artifacts", "dumps"))
      },
    })
  })

  test("uses the expected filename pattern", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const file = await ContextDump.write({
          sessionID: SessionID.make("sess-abc"),
          content: content({ messages: [] satisfies ModelMessage[] }),
          format: "text",
        })
        expect(path.basename(file)).toMatch(/^sess-abc-2026-04-17-12-34-56Z\.txt$/)
      },
    })
  })
})
