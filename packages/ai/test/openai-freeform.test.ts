import { describe, expect, test } from "bun:test"
import { LLMEvent, ToolDefinition } from "../src/effect.js"
import { OpenAIFreeform } from "../src/protocols/openai-freeform.js"
import { ToolStream } from "../src/protocols/utils/tool-stream.js"

const inputSchema = {
  type: "object",
  properties: { code: { type: "string" } },
  required: ["code"],
  additionalProperties: false,
}
const tool = (input: Partial<ToolDefinition.Input> = {}) =>
  ToolDefinition.make({ name: "run", description: "Run code", inputSchema, freeform: { type: "text" }, ...input })
const custom = { field: "code", format: { type: "text" } } as const

const RAW = ['say "hi"\n\tdone\\', "naïve 😀 \u2028", "\u0000 }{ ]"]

describe("OpenAI freeform tools", () => {
  test("resolves a freeform tool to its string field", () => {
    expect(OpenAIFreeform.resolve(tool())).toEqual(custom)
    expect(OpenAIFreeform.resolve(tool({ freeform: undefined }))).toBeUndefined()
    expect(OpenAIFreeform.resolve(tool({ native: { openai: {} } }))).toBeUndefined()
    expect(
      OpenAIFreeform.resolve(tool({ inputSchema: { ...inputSchema, properties: { code: { type: "number" } } } })),
    ).toBeUndefined()
    expect(OpenAIFreeform.resolve(tool({ inputSchema: { ...inputSchema, required: [] } }))).toBeUndefined()
  })

  test("converts between raw text and the JSON input", () => {
    for (const raw of RAW) {
      const json = OpenAIFreeform.fromRaw(custom, raw)
      expect(JSON.parse(json)).toEqual({ code: raw })
      expect(OpenAIFreeform.toRaw(custom, JSON.parse(json))).toBe(raw)
    }
    expect(OpenAIFreeform.fromRaw(undefined, "x")).toBe('{"input":"x"}')
    expect(OpenAIFreeform.toRaw(custom, { code: 1 })).toBe('{"code":1}')
  })

  test("streams raw chunks as JSON fragments that add up to the input", () => {
    for (const raw of RAW) {
      // Split at every code unit, including inside surrogate pairs and escape-worthy characters.
      const chunks = [...Array(raw.length).keys()].map((index) => raw[index])
      const fragments = [OpenAIFreeform.streamStart(custom), ...chunks.map(OpenAIFreeform.streamDelta)]
      const started = ToolStream.start(ToolStream.empty<string>(), "ctc_1", {
        id: "call_1",
        name: "run",
        input: fragments.join(""),
      })
      const closed = OpenAIFreeform.close(started, ["ctc_1"], { custom, raw })
      expect(closed.events).toMatchObject([{ type: "tool-input-delta", text: '"}' }])
      expect(JSON.parse(closed.tools.ctc_1?.input ?? "")).toEqual({ code: raw })
    }
  })

  test("leaves a call open when the final input disagrees with the streamed one", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "ctc_1", {
      id: "call_1",
      name: "run",
      input: OpenAIFreeform.streamStart(custom, "partial"),
    })
    const closed = OpenAIFreeform.close(tools, ["ctc_1", "missing"], { custom, raw: "different" })
    expect(closed.events).toEqual([])
    expect(closed.tools).toBe(tools)
    expect(OpenAIFreeform.close(tools, ["ctc_1"]).events.filter(LLMEvent.is.toolInputDelta)).toHaveLength(1)
  })

  test("keeps an item id only while the call type is unchanged", () => {
    const customCall = { openai: OpenAIFreeform.metadata("ctc_1", true) }
    const functionCall = { openai: OpenAIFreeform.metadata("fc_1", false) }
    expect(OpenAIFreeform.keepsItemID(customCall, "openai", true)).toBe(true)
    expect(OpenAIFreeform.keepsItemID(customCall, "openai", false)).toBe(false)
    expect(OpenAIFreeform.keepsItemID(functionCall, "openai", false)).toBe(true)
    expect(OpenAIFreeform.keepsItemID(functionCall, "openai", true)).toBe(false)
    expect(OpenAIFreeform.keepsItemID(undefined, "openai", false)).toBe(true)
  })
})
