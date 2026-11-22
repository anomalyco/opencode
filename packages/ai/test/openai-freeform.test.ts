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
const withOptions = {
  ...inputSchema,
  properties: {
    code: { type: "string" },
    timeout: { type: "integer", description: "Milliseconds to wait." },
    background: { type: "boolean" },
  },
}
const tool = (input: Partial<ToolDefinition.Input> = {}) =>
  ToolDefinition.make({ name: "run", description: "Run code", inputSchema, freeform: { type: "text" }, ...input })
const custom = { field: "code", format: { type: "text" } } as const
const optionsCustom = {
  field: "code",
  format: { type: "text", optionsPrefix: "// @exec:" },
  optionsPrefix: "// @exec:",
} as const

const RAW = ['say "hi"\n\tdone\\', "naïve 😀 \u2028", "\u0000 }{ ]"]

// Raw text and the input it parses to, for a tool with an options line.
const OPTIONS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['// @exec: {"timeout":1000}\nreturn "a"', { timeout: 1000, code: 'return "a"' }],
  [
    '  // @exec: {"background": true, "timeout": 5}\r\nawait x()\r\n',
    { background: true, timeout: 5, code: "await x()\r\n" },
  ],
  ["// @exec: {}\nreturn 1", { code: "return 1" }],
  ['// @exec: {"code":"ignored"}\nreturn 1', { code: "return 1" }],
  ["// @exec: {not json}\nreturn 1", { code: "// @exec: {not json}\nreturn 1" }],
  ["// @exec: [1]\nreturn 1", { code: "// @exec: [1]\nreturn 1" }],
  ['// @exec: {"timeout":1}', { code: '// @exec: {"timeout":1}' }],
  ['// @exec: {"timeout":1}\n', { timeout: 1, code: "" }],
  ["return 1\n// @exec: {}\n", { code: "return 1\n// @exec: {}\n" }],
  ["// @exec2 {}\nreturn 1", { code: "// @exec2 {}\nreturn 1" }],
  ...RAW.map((raw) => [raw, { code: raw }] as const),
]

const stream = (target: OpenAIFreeform.Custom | undefined, chunks: ReadonlyArray<string>) => {
  const start = OpenAIFreeform.streamStart(target)
  const fragments = chunks.reduce(
    (result, chunk) => {
      const next = OpenAIFreeform.streamDelta(result.stream, chunk)
      return { stream: next.stream, fragments: [...result.fragments, next.fragment] }
    },
    { stream: start.stream, fragments: [start.fragment] },
  )
  return { stream: fragments.stream, fragments: fragments.fragments }
}

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

  test("resolves optional fields beside the string only with an options prefix", () => {
    const freeform = { type: "text", optionsPrefix: "// @exec:" } as const
    expect(OpenAIFreeform.resolve(tool({ inputSchema: withOptions, freeform }))).toEqual(optionsCustom)
    expect(OpenAIFreeform.resolve(tool({ inputSchema: withOptions }))).toBeUndefined()
    // Without other fields the prefix changes nothing on the wire.
    expect(OpenAIFreeform.resolve(tool({ freeform }))).toEqual({ field: "code", format: freeform })
    expect(
      OpenAIFreeform.resolve(tool({ inputSchema: { ...withOptions, required: ["code", "timeout"] }, freeform })),
    ).toBeUndefined()
  })

  test("describes and constrains the options line", () => {
    const definition = tool({ inputSchema: withOptions, freeform: optionsCustom.format })
    expect(OpenAIFreeform.description(definition, optionsCustom)).toBe(
      "Run code\nTo set other parameters, start with the line `// @exec: <JSON object>` and put the code on the next line. Parameters: `timeout` (integer): Milliseconds to wait.; `background` (boolean)",
    )
    expect(OpenAIFreeform.grammar(optionsCustom)).toEqual({
      syntax: "lark",
      definition: [
        "start: pragma_source | plain_source",
        "pragma_source: PRAGMA_LINE NEWLINE SOURCE",
        "plain_source: SOURCE",
        "",
        "PRAGMA_LINE: /[ \\t]*\\/\\/ @exec:[^\\r\\n]*/",
        "NEWLINE: /\\r?\\n/",
        "SOURCE: /[\\s\\S]+/",
        "",
      ].join("\n"),
    })
    expect(OpenAIFreeform.description(tool(), custom)).toBe("Run code")
    expect(OpenAIFreeform.grammar(custom)).toBeUndefined()
  })

  test("converts between raw text and the JSON input", () => {
    for (const raw of RAW) {
      const json = OpenAIFreeform.fromRaw(custom, raw)
      expect(JSON.parse(json)).toEqual({ code: raw })
      expect(OpenAIFreeform.toRaw(custom, JSON.parse(json))).toBe(raw)
    }
    expect(OpenAIFreeform.fromRaw(undefined, "x")).toBe('{"input":"x"}')
    expect(OpenAIFreeform.toRaw(custom, { code: 1 })).toBe('{"code":1}')
    // A tool without an options line keeps the whole text, options line included.
    expect(JSON.parse(OpenAIFreeform.fromRaw(custom, '// @exec: {"timeout":1}\nx'))).toEqual({
      code: '// @exec: {"timeout":1}\nx',
    })
  })

  test("parses an options line and replays it identically", () => {
    for (const [raw, input] of OPTIONS) {
      const json = OpenAIFreeform.fromRaw(optionsCustom, raw)
      expect(JSON.parse(json)).toEqual(input)
      // Replaying the parsed input parses back to the same input, and replaying that again gives the same text.
      const replayed = OpenAIFreeform.toRaw(optionsCustom, JSON.parse(json))
      expect(JSON.parse(OpenAIFreeform.fromRaw(optionsCustom, replayed))).toEqual(input)
      expect(OpenAIFreeform.toRaw(optionsCustom, JSON.parse(OpenAIFreeform.fromRaw(optionsCustom, replayed)))).toBe(
        replayed,
      )
    }
    expect(OpenAIFreeform.toRaw(optionsCustom, { code: "x", timeout: 1000, background: undefined })).toBe(
      '// @exec: {"timeout":1000}\nx',
    )
    expect(OpenAIFreeform.toRaw(optionsCustom, { code: "x" })).toBe("x")
    // A tool without an options line drops other fields, as before.
    expect(OpenAIFreeform.toRaw(custom, { code: "x", timeout: 1000 })).toBe("x")
  })

  test("streams raw chunks as JSON fragments that add up to the input", () => {
    for (const raw of RAW) {
      // Split at every code unit, including inside surrogate pairs and escape-worthy characters.
      const streamed = stream(custom, [...raw])
      const started = ToolStream.start(ToolStream.empty<string>(), "ctc_1", {
        id: "call_1",
        name: "run",
        input: streamed.fragments.join(""),
      })
      const closed = OpenAIFreeform.close(started, [["ctc_1", streamed.stream]], { custom, raw })
      expect(closed.events).toMatchObject([{ type: "tool-input-delta", text: '"}' }])
      expect(JSON.parse(closed.tools.ctc_1?.input ?? "")).toEqual({ code: raw })
    }
  })

  test("holds a possible options line back until it is complete", () => {
    for (const [raw, input] of OPTIONS) {
      for (const chunks of [[...raw], [raw]]) {
        const streamed = stream(optionsCustom, chunks)
        const started = ToolStream.start(ToolStream.empty<string>(), "ctc_1", {
          id: "call_1",
          name: "run",
          input: streamed.fragments.join(""),
        })
        const closed = OpenAIFreeform.close(started, [["ctc_1", streamed.stream]], { custom: optionsCustom, raw })
        expect(closed.events).toHaveLength(1)
        expect(JSON.parse(closed.tools.ctc_1?.input ?? "")).toEqual(input)
      }
    }
    // A first line that cannot be an options line streams at once.
    expect(stream(optionsCustom, ["ret", "urn"]).fragments).toEqual(["{", '"code":"ret', "urn"])
    expect(stream(optionsCustom, ["// @ex", "ec: {}", "\nx", "y"]).fragments).toEqual(["{", "", "", '"code":"x', "y"])
    expect(stream(optionsCustom, ['// @exec: {"timeout":1}\r', "\nx"]).fragments).toEqual([
      "{",
      "",
      '"timeout":1,"code":"x',
    ])
  })

  test("leaves a call open when the final input disagrees with the streamed one", () => {
    const started = OpenAIFreeform.streamStart(custom, "partial")
    const tools = ToolStream.start(ToolStream.empty<string>(), "ctc_1", {
      id: "call_1",
      name: "run",
      input: started.fragment,
    })
    const calls = [["ctc_1", started.stream] as const, ["missing", undefined] as const]
    const closed = OpenAIFreeform.close(tools, calls, { custom, raw: "different" })
    expect(closed.events).toEqual([])
    expect(closed.tools).toBe(tools)
    expect(OpenAIFreeform.close(tools, calls).events.filter(LLMEvent.is.toolInputDelta)).toHaveLength(1)
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
