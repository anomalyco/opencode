import { describe, expect, test } from "bun:test"
import { CodeModeCustomTool } from "@opencode/core/codemode/custom-tool"
import { Result } from "effect"

describe("CodeModeCustomTool names", () => {
  test("parses flat and dotted names and strips optional custom. prefix", () => {
    expect(CodeModeCustomTool.parseName("triage_prs")).toEqual(
      Result.succeed({
        id: "triage_prs",
        name: "triage_prs",
        namespace: "custom",
        qualified: "custom.triage_prs",
        relativePath: "triage_prs.js",
      }),
    )
    expect(CodeModeCustomTool.parseName("custom.github.triage-prs")).toEqual(
      Result.succeed({
        id: "github.triage-prs",
        name: "triage-prs",
        namespace: "custom.github",
        qualified: "custom.github.triage-prs",
        relativePath: "github/triage-prs.js",
      }),
    )
  })

  test("rejects invalid or overly nested names", () => {
    for (const bad of ["", "   ", "a/b", "../escape", "bad name", "a.b.c.d.e", "foo..bar", "foo."]) {
      expect(Result.isFailure(CodeModeCustomTool.parseName(bad))).toBe(true)
    }
  })

  test("derives names from tool/ and tools/ file paths", () => {
    expect(CodeModeCustomTool.nameFromPath("/repo/.opencode", "/repo/.opencode/tools/audit.js")).toEqual(
      Result.succeed({
        id: "audit",
        name: "audit",
        namespace: "custom",
        qualified: "custom.audit",
        relativePath: "audit.js",
      }),
    )
    expect(CodeModeCustomTool.nameFromPath("/repo/.opencode", "/repo/.opencode/tool/github/pr_check.js")).toEqual(
      Result.succeed({
        id: "github.pr_check",
        name: "pr_check",
        namespace: "custom.github",
        qualified: "custom.github.pr_check",
        relativePath: "github/pr_check.js",
      }),
    )
    expect(Result.isFailure(CodeModeCustomTool.nameFromPath("/repo/.opencode", "/repo/.opencode/tools/bad.ts"))).toBe(
      true,
    )
    expect(Result.isFailure(CodeModeCustomTool.nameFromPath("/repo/.opencode", "/repo/.opencode/other/audit.js"))).toBe(
      true,
    )
  })
})

describe("CodeModeCustomTool parsing and formatting", () => {
  test("parses block-comment YAML header and extracts static tools and extensions", () => {
    const file = `/*---
description: Summarize matching PRs
input:
  type: object
  properties:
    label:
      type: string
  required:
    - label
output:
  type: array
  items:
    type: string
---*/

const prs = await tools.github.list_prs({ label: args.label })
const summary = await llm("Summarize: " + JSON.stringify(prs))
return [summary]
`
    const parsed = CodeModeCustomTool.parseFile(file)
    expect(Result.isSuccess(parsed)).toBe(true)
    if (Result.isFailure(parsed)) return
    expect(parsed.success.description).toBe("Summarize matching PRs")
    expect(parsed.success.input).toEqual({
      type: "object",
      properties: { label: { type: "string" } },
      required: ["label"],
    })
    expect(parsed.success.output).toEqual({ type: "array", items: { type: "string" } })
    expect(parsed.success.compiledOutput).toBeDefined()
    expect(parsed.success.tools).toEqual(["github.list_prs"])
    expect(parsed.success.extensions).toEqual(["agents"])
  })

  test("round-trips through formatFile using line comments when YAML contains */", () => {
    const formatted = CodeModeCustomTool.formatFile({
      description: "Find files matching a glob like **/*.ts",
      input: {
        type: "object",
        properties: {
          glob: { type: "string", description: "Example: src/**/*.ts" },
        },
        required: ["glob"],
      },
      code: "const list = []; for await (const f of new Bun.Glob(args.glob).scan('.')) list.push(f); return list",
    })
    expect(formatted.startsWith("// ---\n")).toBe(true)
    const parsed = CodeModeCustomTool.parseFile(formatted)
    expect(Result.isSuccess(parsed)).toBe(true)
    if (Result.isFailure(parsed)) return
    expect(parsed.success.description).toBe("Find files matching a glob like **/*.ts")
    expect(parsed.success.extensions).toEqual(["bun"])
    expect(parsed.success.tools).toEqual([])
  })

  test("round-trips through formatFile using block comments when YAML has no */", () => {
    const formatted = CodeModeCustomTool.formatFile({
      description: "Fetch a URL",
      code: "return await fetch(args.url).then((r) => r.text())",
    })
    expect(formatted.startsWith("/*---\n")).toBe(true)
    const parsed = CodeModeCustomTool.parseFile(formatted)
    expect(Result.isSuccess(parsed)).toBe(true)
    if (Result.isFailure(parsed)) return
    expect(parsed.success.input).toEqual(CodeModeCustomTool.DEFAULT_INPUT)
    expect(parsed.success.extensions).toEqual(["fetch"])
  })

  test("rejects missing header, invalid schema, dynamic tools, and forbidden inner tools", () => {
    expect(Result.isFailure(CodeModeCustomTool.parseFile("return 1"))).toBe(true)
    expect(
      Result.isFailure(
        CodeModeCustomTool.parseFile(`/*---\ndescription: ""\n---*/\nreturn 1`),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        CodeModeCustomTool.parseDefinition({
          description: "Bad input root",
          input: { type: "string" },
          code: "return 1",
        }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        CodeModeCustomTool.parseDefinition({
          description: "Dynamic tool lookup",
          code: "return await tools[args.name]({})",
        }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        CodeModeCustomTool.parseDefinition({
          description: "Self modifying",
          code: 'return await tools.opencode.tool.create({ name: "x", description: "x", code: "return 1" })',
        }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        CodeModeCustomTool.parseDefinition({
          description: "Self deleting",
          code: 'return await tools.opencode.tool.delete({ name: "x" })',
        }),
      ),
    ).toBe(true)
  })
})
