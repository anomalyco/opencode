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
const customs = new Map([["run", custom]])

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
      const closed = OpenAIFreeform.close(started, ["ctc_1"], customs, raw)
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
    const closed = OpenAIFreeform.close(tools, ["ctc_1", "missing"], customs, "different")
    expect(closed.events).toEqual([])
    expect(closed.tools).toBe(tools)
    expect(OpenAIFreeform.close(tools, ["ctc_1"], customs).events.filter(LLMEvent.is.toolInputDelta)).toHaveLength(1)
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

describe("OpenAI freeform tools with an options line", () => {
  const optionsSchema = {
    type: "object",
    properties: {
      code: { type: "string" },
      timeout: { type: "integer", exclusiveMinimum: 0 },
      background: { type: "boolean" },
    },
    required: ["code"],
  }
  const format = {
    type: "lark",
    field: "code",
    options: { prefix: "// @options:", description: "Settings go on a first line." },
  } as const
  const options = OpenAIFreeform.resolve(tool({ inputSchema: optionsSchema, freeform: format }))!

  test("resolves the optional parameters and a grammar for the line", () => {
    expect(options.options?.fields).toEqual(["timeout", "background"])
    expect(options.options?.grammar).toBe(
      [
        "start: options_line body | plain",
        'options_line: "// @options: {" (option_0 | option_1) "}\\n"',
        'option_0: pair_0 ("," pair_1)?',
        "option_1: pair_1",
        'pair_0: "\\"timeout\\":" /[1-9][0-9]*/',
        'pair_1: "\\"background\\":" ("true" | "false")',
        "body: /[\\s\\S]+/",
        String.raw`plain: /(?:[^\/]|\/[^\/]|\/\/[^ ]|\/\/ [^@]|\/\/ @[^o]|\/\/ @o[^p]|\/\/ @op[^t]|\/\/ @opt[^i]|\/\/ @opti[^o]|\/\/ @optio[^n]|\/\/ @option[^s]|\/\/ @options[^:])[\s\S]*|\/|\/\/|\/\/ |\/\/ @|\/\/ @o|\/\/ @op|\/\/ @opt|\/\/ @opti|\/\/ @optio|\/\/ @option|\/\/ @options/`,
      ].join("\n"),
    )
    // The tool's own grammar constrains the body instead.
    const body = OpenAIFreeform.resolve(
      tool({ inputSchema: optionsSchema, freeform: { ...format, grammar: 'body: "ZZ" /[0-9]{3}/' } }),
    )
    expect(body?.options?.grammar.split("\n").at(0)).toBe("start: options_line body | body")
    expect(body?.options?.grammar.split("\n").at(-1)).toBe('body: "ZZ" /[0-9]{3}/')
  })

  test("stays a JSON tool when it can't be written as a line", () => {
    const schema = (properties: Record<string, unknown>, required = ["code"]) => ({
      ...optionsSchema,
      properties: { code: { type: "string" }, ...properties },
      required,
    })
    // An optional parameter without a grammar, a second required one, no optional ones, or a missing field.
    expect(
      OpenAIFreeform.resolve(tool({ inputSchema: schema({ env: { type: "object" } }), freeform: format })),
    ).toBeUndefined()
    expect(
      OpenAIFreeform.resolve(
        tool({ inputSchema: schema({ background: { type: "boolean" } }, ["code", "background"]), freeform: format }),
      ),
    ).toBeUndefined()
    expect(OpenAIFreeform.resolve(tool({ inputSchema, freeform: format }))).toBeUndefined()
    expect(
      OpenAIFreeform.resolve(tool({ inputSchema: optionsSchema, freeform: { ...format, field: "script" } })),
    ).toBeUndefined()
  })

  test("reads the line into fields and writes it back exactly", () => {
    const cases = [
      ['// @options: {"timeout":5000}\nawait build()', { code: "await build()", timeout: 5000 }],
      ['// @options: {"timeout":1,"background":true}\nx', { code: "x", timeout: 1, background: true }],
      ["await build()", { code: "await build()" }],
    ] as const
    for (const [raw, input] of cases) {
      expect(JSON.parse(OpenAIFreeform.fromRaw(options, raw))).toEqual(input)
      expect(OpenAIFreeform.toRaw(options, input)).toBe(raw)
    }
    // A Claude-written call with options replays with the line.
    expect(OpenAIFreeform.toRaw(options, { background: true, code: "x" })).toBe('// @options: {"background":true}\nx')
  })

  test("leaves a bad line as raw text, so the call fails as malformed", () => {
    for (const raw of ["// @options: {timeout: 1}\nx", '// @options: {"env":{}}\nx', "// @options: 1\nx"])
      expect(OpenAIFreeform.fromRaw(options, raw)).toBe(raw)
  })

  test("closes a streamed call with the parsed fields as its input", () => {
    const raw = '// @options: {"background":true}\nx'
    const started = ToolStream.start(ToolStream.empty<number>(), 0, {
      id: "call_1",
      name: "run",
      input: OpenAIFreeform.streamStart(options, raw),
    })
    const closed = OpenAIFreeform.close(started, [0], new Map([["run", options]]))
    expect(closed.events).toMatchObject([{ type: "tool-input-delta", text: '"}' }])
    expect(JSON.parse(closed.tools[0]?.input ?? "")).toEqual({ code: "x", background: true })
  })
})
