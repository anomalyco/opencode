import { describe, expect, test } from "bun:test"
import { grammar, parse, repair } from "../../src/tools/text-protocol"
import { tmpdir } from "../lib/tmp"
import { CAPS, config, toolset } from "./harness"

describe("parse", () => {
  test("fenced json block", () => {
    expect(parse('I will read it.\n```json\n{"tool": "read", "args": {"filePath": "a.ts"}}\n```')).toEqual({
      call: { name: "read", input: { filePath: "a.ts" } },
    })
  })

  test("bare json with surrounding prose", () => {
    expect(parse('Sure: {"tool": "glob", "args": {"pattern": "*.ts"}} done')).toEqual({
      call: { name: "glob", input: { pattern: "*.ts" } },
    })
  })

  test("Hermes/Qwen <tool_call> tags with name/arguments, including string arguments", () => {
    expect(parse('<tool_call>\n{"name": "grep", "arguments": {"pattern": "x"}}\n</tool_call>')).toEqual({
      call: { name: "grep", input: { pattern: "x" } },
    })
    expect(parse('<tool_call>{"name": "grep", "arguments": "{\\"pattern\\": \\"y\\"}"}</tool_call>')).toEqual({
      call: { name: "grep", input: { pattern: "y" } },
    })
  })

  test("trailing commas are repaired without touching strings", () => {
    expect(parse('```json\n{"tool": "write", "args": {"filePath": "a", "content": "x,}",},}\n```')).toEqual({
      call: { name: "write", input: { filePath: "a", content: "x,}" } },
    })
    expect(repair('{"a": [1, 2,], "b": "\\",]",}')).toBe('{"a": [1, 2], "b": "\\",]"}')
  })

  test("only the first of several calls is used", () => {
    const text =
      '```json\n{"tool": "read", "args": {"filePath": "a"}}\n```\n```json\n{"tool": "bash", "args": {"command": "rm -rf /"}}\n```'
    expect(parse(text)).toEqual({ call: { name: "read", input: { filePath: "a" } } })
  })

  test("malformed call → error; plain answer (even with code) → nothing", () => {
    expect(parse('```json\n{"tool": "read", "args": {"filePath": \n```').error).toContain("Malformed tool call")
    expect(parse('<tool_call>{"args": {}}</tool_call>').error).toContain('missing "tool"')
    expect(parse("The answer is 42.")).toEqual({})
    expect(parse("```ts\nconst x = { a: 1 }\n```")).toEqual({})
  })
})

describe("grammar and registry wiring", () => {
  test("grammar is ≤ 400 chars before the tool list", () => {
    const text = grammar([])
    expect(text.length).toBeLessThanOrEqual(400)
    expect(text).toEndWith("Tools:")
  })

  test("tools_native=false: no native definitions, prompt lists tools; unknown keys are rejected, not widened", async () => {
    await using dir = await tmpdir({ files: { "a.txt": "hello" } })
    const tools = await toolset(config(dir.path), { caps: { ...CAPS, tools_native: false }, describe: () => "short" })
    expect(tools.set.definitions).toEqual([])
    expect(tools.set.textProtocolPrompt).toContain("- read(filePath: string, offset?: integer, limit?: integer): short")
    const call = parse('```json\n{"tool": "read", "args": {"filePath": "a.txt", "sudo": true,}}\n```').call!
    const rejected = await tools.call(call.name, call.input)
    expect(rejected.status).toBe("error")
    expect(rejected.text).toStartWith("Invalid tool input")
    const ok = parse('{"tool": "read", "args": {"filePath": "a.txt"}}').call!
    expect((await tools.call(ok.name, ok.input)).text).toContain("1: hello")
  })
})
