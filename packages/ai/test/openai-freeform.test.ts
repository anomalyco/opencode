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
// The formats a model that takes every kind of freeform tool lists.
const resolve = (
  definition: ToolDefinition,
  formats: ReadonlyArray<"text" | "lark" | "regex"> = ["text", "lark", "regex"],
) => OpenAIFreeform.resolve(definition, formats)
const custom = { field: "code", format: { type: "text" } } as const
const customs = new Map([["run", custom]])

const RAW = ['say "hi"\n\tdone\\', "naïve 😀 \u2028", "\u0000 }{ ]"]

describe("OpenAI freeform tools", () => {
  test("resolves a freeform tool to its string field", () => {
    expect(resolve(tool())).toEqual(custom)
    expect(resolve(tool({ freeform: undefined }))).toBeUndefined()
    expect(resolve(tool({ native: { openai: {} } }))).toBeUndefined()
    expect(resolve(tool({ inputSchema: { ...inputSchema, properties: { code: { type: "number" } } } }))).toBeUndefined()
    expect(resolve(tool({ inputSchema: { ...inputSchema, required: [] } }))).toBeUndefined()
    // Naming the only field changes nothing.
    expect(resolve(tool({ freeform: { type: "text", field: "code" } }))).toEqual({
      field: "code",
      format: { type: "text", field: "code" },
    })
  })

  test("only sends a format the model accepts, and none when the model doesn't say", () => {
    expect(resolve(tool(), ["text", "lark"])).toEqual(custom)
    expect(OpenAIFreeform.resolve(tool())).toBeUndefined()
    expect(resolve(tool(), [])).toBeUndefined()
    expect(resolve(tool(), ["regex"])).toBeUndefined()
  })

  test("converts between raw text and the JSON input", () => {
    for (const raw of RAW) {
      const parsed = OpenAIFreeform.parse(custom, raw)
      expect("input" in parsed && JSON.parse(parsed.input)).toEqual({ code: raw })
      expect(OpenAIFreeform.toRaw(custom, { code: raw })).toBe(raw)
    }
    expect(OpenAIFreeform.parse(undefined, "x")).toEqual({ input: '{"input":"x"}' })
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
      const closed = OpenAIFreeform.close(started, ["ctc_1"], customs, "openai", raw)
      expect(closed.events).toMatchObject([{ type: "tool-input-delta", text: '"}' }])
      expect(JSON.parse(closed.tools.ctc_1?.input ?? "")).toEqual({ code: raw })
    }
  })

  test("takes the final input when it disagrees with the streamed one", () => {
    const tools = ToolStream.start(ToolStream.empty<string>(), "ctc_1", {
      id: "call_1",
      name: "run",
      input: OpenAIFreeform.streamStart(custom, "partial"),
    })
    const closed = OpenAIFreeform.close(tools, ["ctc_1", "missing"], customs, "openai", "different")
    expect(closed.events).toEqual([])
    expect(JSON.parse(closed.tools.ctc_1?.input ?? "")).toEqual({ code: "different" })
    expect(
      OpenAIFreeform.close(tools, ["ctc_1"], customs, "openai").events.filter(LLMEvent.is.toolInputDelta),
    ).toHaveLength(1)
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

describe("OpenAI freeform tools with other parameters", () => {
  const schema = (properties: Record<string, unknown>, required = ["code"]) => ({
    type: "object",
    properties: { code: { type: "string" }, ...properties },
    required,
  })
  const executeSchema = schema({
    timeout: { type: "integer", exclusiveMinimum: 0, description: "How long to wait." },
    background: { type: "boolean" },
  })
  const format = { type: "text", field: "code" } as const
  const options = resolve(tool({ inputSchema: executeSchema, freeform: format }))!
  const parsed = (raw: string, definition = options) => {
    const result = OpenAIFreeform.parse(definition, raw)
    return { input: JSON.parse(result.input), header: result.header }
  }

  test("sends an order-free grammar and a description built from the schema", () => {
    expect(options.options?.grammar).toBe(
      [
        "start: ff_line ff_body | ff_plain",
        'ff_line: "// @options:" " "* "{" " "* ff_pair (" "* "," " "* ff_pair)* " "* "}" "\\n"',
        'ff_pair: "\\"timeout\\"" " "* ":" " "* /[1-9][0-9]*/ | "\\"background\\"" " "* ":" " "* ("true" | "false")',
        "ff_body: /[\\s\\S]+/",
        String.raw`ff_plain: /(?:[^\/]|\/[^\/]|\/\/[^ ]|\/\/ [^@]|\/\/ @[^o]|\/\/ @o[^p]|\/\/ @op[^t]|\/\/ @opt[^i]|\/\/ @opti[^o]|\/\/ @optio[^n]|\/\/ @option[^s]|\/\/ @options[^:])[\s\S]*|\/|\/\/|\/\/ |\/\/ @|\/\/ @o|\/\/ @op|\/\/ @opt|\/\/ @opti|\/\/ @optio|\/\/ @option|\/\/ @options/`,
      ].join("\n"),
    )
    expect(OpenAIFreeform.description(tool(), options)).toBe(
      [
        "Run code",
        "",
        "To set the parameters below, start with a `// @options:` line holding a JSON object of them, then write `code` from the next line. Leave the line out to use the defaults.",
        "- `timeout` (integer): How long to wait.",
        "- `background` (boolean)",
        "For example:",
        '// @options: {"background": true}',
        "<code>",
      ].join("\n"),
    )
  })

  test("reads keys in any order, with spaces, and replays the line as written", () => {
    const cases = [
      ['// @options: {"timeout":5000}\nawait build()', { code: "await build()", timeout: 5000 }],
      ['// @options: { "timeout": 1, "background": true }\nx', { code: "x", timeout: 1, background: true }],
      ['// @options:{"background" :false,"timeout":2}\r\nx', { code: "x", timeout: 2, background: false }],
      ["await build()", { code: "await build()" }],
    ] as const
    for (const [raw, input] of cases) {
      const result = parsed(raw)
      expect(result).toEqual({ input, header: raw.startsWith("//") ? raw.slice(0, raw.indexOf("\n")) : undefined })
      expect(OpenAIFreeform.toRaw(options, input, "header" in result ? result.header : undefined)).toBe(raw)
    }
  })

  test("writes a fresh line when the input no longer matches the saved one, or there is none", () => {
    const header = '// @options: { "background": true }'
    expect(OpenAIFreeform.toRaw(options, { code: "x", background: true, timeout: 9 }, header)).toBe(
      '// @options: {"timeout":9,"background":true}\nx',
    )
    expect(OpenAIFreeform.toRaw(options, { code: "x", background: true })).toBe('// @options: {"background":true}\nx')
    expect(OpenAIFreeform.toRaw(options, { code: "x" }, header)).toBe("x")
  })

  test("leaves a line that isn't a JSON object as raw text, so it fails as malformed JSON", () => {
    expect(OpenAIFreeform.parse(options, "// @options: {timeout: 1}\nx")).toEqual({
      input: "// @options: {timeout: 1}\nx",
    })
    // The tool's own schema checks keys and values, as for a JSON call.
    expect(parsed('// @options: {"timeout":"5"}\nx')).toEqual({
      input: { code: "x", timeout: "5" },
      header: '// @options: {"timeout":"5"}',
    })
    // A line with nothing after it is plain text, not a call with empty code.
    expect(parsed('// @options: {"background":true}')).toEqual({ input: { code: '// @options: {"background":true}' } })
  })

  test("takes number, string and enum values", () => {
    const definition = resolve(
      tool({
        inputSchema: schema({
          ratio: { type: "number" },
          cwd: { type: "string" },
          mode: { type: "string", enum: ["fast", "safe"] },
        }),
        freeform: format,
      }),
    )!
    expect(definition.options?.grammar).toContain(
      '"\\"ratio\\"" " "* ":" " "* /-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/',
    )
    expect(definition.options?.grammar).toContain(
      '"\\"cwd\\"" " "* ":" " "* /"(?:[^"\\\\\\x00-\\x1f]|\\\\["\\\\\\/bfnrt]|\\\\u[0-9a-fA-F]{4})*"/',
    )
    expect(definition.options?.grammar).toContain('"\\"mode\\"" " "* ":" " "* ("\\"fast\\"" | "\\"safe\\"")')
    const raw = '// @options: {"mode": "safe", "ratio": 1.5e2, "cwd": "C:\\\\src"}\nls'
    expect(parsed(raw, definition)).toMatchObject({ input: { code: "ls", mode: "safe", ratio: 150, cwd: "C:\\src" } })
  })

  test("requires the line when a parameter is required", () => {
    const definition = resolve(
      tool({ inputSchema: schema({ path: { type: "string" } }, ["code", "path"]), freeform: format }),
    )!
    expect(definition.options?.grammar?.split("\n").at(0)).toBe("start: ff_line ff_body")
    expect(parsed('// @options: {"path": "a.ts"}\nx', definition)).toMatchObject({ input: { code: "x", path: "a.ts" } })
  })

  test("composes a tool's own grammar as the body", () => {
    const grammar = ["start: patch LF", 'patch: "*** " /(.+)/', "%import common.LF"].join("\n")
    const definition = resolve(
      tool({ inputSchema: executeSchema, freeform: { type: "lark", grammar, field: "code" } }),
    )!
    expect(definition.options?.grammar?.split("\n").at(0)).toBe("start: ff_line fb_start | fb_start")
    expect(definition.options?.grammar?.split("\n").slice(-3)).toEqual([
      "fb_start: patch LF",
      'patch: "*** " /(.+)/',
      "%import common.LF",
    ])
  })

  test("parses the line without a grammar for a model that only takes text", () => {
    const definition = resolve(tool({ inputSchema: executeSchema, freeform: format }), ["text"])!
    expect(OpenAIFreeform.grammar(definition)).toBeUndefined()
    expect(definition.options?.description).toBe(options.options?.description)
    expect(parsed('// @options: {"background": true}\nx', definition)).toMatchObject({
      input: { code: "x", background: true },
    })
    // Without Lark, only a raw text body can share the wire with the line.
    expect(
      resolve(tool({ inputSchema: executeSchema, freeform: { type: "regex", pattern: "x", field: "code" } }), [
        "text",
        "regex",
      ]),
    ).toBeUndefined()
  })

  test("stays a JSON tool when a parameter can't go on the line", () => {
    for (const property of [{ type: "object" }, { type: ["string", "null"] }, { enum: [] }])
      expect(resolve(tool({ inputSchema: schema({ env: property }), freeform: format }))).toBeUndefined()
    expect(resolve(tool({ inputSchema: executeSchema, freeform: { ...format, field: "script" } }))).toBeUndefined()
  })

  test("closes a streamed call with the parsed input and its line in the metadata", () => {
    const raw = '// @options: {"background": true}\nx'
    const started = ToolStream.start(ToolStream.empty<number>(), 0, {
      id: "call_1",
      name: "run",
      input: OpenAIFreeform.streamStart(options, raw),
      providerMetadata: { openai: { itemId: "ctc_1", custom: true } },
    })
    const closed = OpenAIFreeform.close(started, [0], new Map([["run", options]]), "openai")
    expect(closed.events).toMatchObject([{ type: "tool-input-delta", text: '"}' }])
    expect(JSON.parse(closed.tools[0]?.input ?? "")).toEqual({ code: "x", background: true })
    expect(closed.tools[0]?.providerMetadata).toEqual({
      openai: { itemId: "ctc_1", custom: true, header: '// @options: {"background": true}' },
    })
  })
})
