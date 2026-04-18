import { describe, expect, test } from "bun:test"
import z from "zod"

// Each tool exports its parameters schema at module scope so this test can
// import them without running the tool's Effect-based init. The JSON Schema
// snapshot captures what the LLM sees; the parse assertions pin down the
// accepts/rejects contract. Both must survive any future migration (e.g. from
// zod to Effect Schema via the effect-zod walker) byte-for-byte.

import { Parameters as ApplyPatch } from "../../src/tool/apply_patch"
import { Parameters as Bash } from "../../src/tool/bash"
import { Parameters as CodeSearch } from "../../src/tool/codesearch"
import { Parameters as Edit } from "../../src/tool/edit"
import { Parameters as Glob } from "../../src/tool/glob"
import { Parameters as Grep } from "../../src/tool/grep"
import { Parameters as Invalid } from "../../src/tool/invalid"
import { Parameters as Lsp } from "../../src/tool/lsp"
import { Parameters as MultiEdit } from "../../src/tool/multiedit"
import { Parameters as Plan } from "../../src/tool/plan"
import { Parameters as Question } from "../../src/tool/question"
import { Parameters as Read } from "../../src/tool/read"
import { Parameters as Skill } from "../../src/tool/skill"
import { Parameters as Task } from "../../src/tool/task"
import { Parameters as Todo } from "../../src/tool/todo"
import { Parameters as WebFetch } from "../../src/tool/webfetch"
import { Parameters as WebSearch } from "../../src/tool/websearch"
import { Parameters as Write } from "../../src/tool/write"

// Helper: the JSON Schema the LLM sees at tool registration time
// (session/prompt.ts runs `z.toJSONSchema(tool.parameters)` with the AI SDK's
// default `io` mode). Snapshots pin the exact wire shape.
const toJsonSchema = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input" })

describe("tool parameters", () => {
  describe("JSON Schema (wire shape)", () => {
    test("apply_patch", () => expect(toJsonSchema(ApplyPatch)).toMatchSnapshot())
    test("bash", () => expect(toJsonSchema(Bash)).toMatchSnapshot())
    test("codesearch", () => expect(toJsonSchema(CodeSearch)).toMatchSnapshot())
    test("edit", () => expect(toJsonSchema(Edit)).toMatchSnapshot())
    test("glob", () => expect(toJsonSchema(Glob)).toMatchSnapshot())
    test("grep", () => expect(toJsonSchema(Grep)).toMatchSnapshot())
    test("invalid", () => expect(toJsonSchema(Invalid)).toMatchSnapshot())
    test("lsp", () => expect(toJsonSchema(Lsp)).toMatchSnapshot())
    test("multiedit", () => expect(toJsonSchema(MultiEdit)).toMatchSnapshot())
    test("plan", () => expect(toJsonSchema(Plan)).toMatchSnapshot())
    test("question", () => expect(toJsonSchema(Question)).toMatchSnapshot())
    test("read", () => expect(toJsonSchema(Read)).toMatchSnapshot())
    test("skill", () => expect(toJsonSchema(Skill)).toMatchSnapshot())
    test("task", () => expect(toJsonSchema(Task)).toMatchSnapshot())
    test("todo", () => expect(toJsonSchema(Todo)).toMatchSnapshot())
    test("webfetch", () => expect(toJsonSchema(WebFetch)).toMatchSnapshot())
    test("websearch", () => expect(toJsonSchema(WebSearch)).toMatchSnapshot())
    test("write", () => expect(toJsonSchema(Write)).toMatchSnapshot())
  })

  describe("apply_patch", () => {
    test("accepts patchText", () => {
      expect(ApplyPatch.parse({ patchText: "*** Begin Patch\n*** End Patch" })).toEqual({
        patchText: "*** Begin Patch\n*** End Patch",
      })
    })
    test("rejects missing patchText", () => {
      expect(ApplyPatch.safeParse({}).success).toBe(false)
    })
    test("rejects non-string patchText", () => {
      expect(ApplyPatch.safeParse({ patchText: 123 }).success).toBe(false)
    })
  })

  describe("bash", () => {
    test("accepts minimum: command + description", () => {
      expect(Bash.parse({ command: "ls", description: "list" })).toEqual({ command: "ls", description: "list" })
    })
    test("accepts optional timeout + workdir", () => {
      const parsed = Bash.parse({ command: "ls", description: "list", timeout: 5000, workdir: "/tmp" })
      expect(parsed.timeout).toBe(5000)
      expect(parsed.workdir).toBe("/tmp")
    })
    test("rejects missing description (required by zod)", () => {
      expect(Bash.safeParse({ command: "ls" }).success).toBe(false)
    })
    test("rejects missing command", () => {
      expect(Bash.safeParse({ description: "list" }).success).toBe(false)
    })
  })

  describe("codesearch", () => {
    test("accepts query; tokensNum defaults to 5000", () => {
      expect(CodeSearch.parse({ query: "hooks" })).toEqual({ query: "hooks", tokensNum: 5000 })
    })
    test("accepts override tokensNum", () => {
      expect(CodeSearch.parse({ query: "hooks", tokensNum: 10000 }).tokensNum).toBe(10000)
    })
    test("rejects tokensNum under 1000", () => {
      expect(CodeSearch.safeParse({ query: "x", tokensNum: 500 }).success).toBe(false)
    })
    test("rejects tokensNum over 50000", () => {
      expect(CodeSearch.safeParse({ query: "x", tokensNum: 60000 }).success).toBe(false)
    })
  })

  describe("edit", () => {
    test("accepts all four fields", () => {
      expect(Edit.parse({ filePath: "/a", oldString: "x", newString: "y", replaceAll: true })).toEqual({
        filePath: "/a",
        oldString: "x",
        newString: "y",
        replaceAll: true,
      })
    })
    test("replaceAll is optional", () => {
      const parsed = Edit.parse({ filePath: "/a", oldString: "x", newString: "y" })
      expect(parsed.replaceAll).toBeUndefined()
    })
    test("rejects missing filePath", () => {
      expect(Edit.safeParse({ oldString: "x", newString: "y" }).success).toBe(false)
    })
  })

  describe("glob", () => {
    test("accepts pattern-only", () => {
      expect(Glob.parse({ pattern: "**/*.ts" })).toEqual({ pattern: "**/*.ts" })
    })
    test("accepts optional path", () => {
      expect(Glob.parse({ pattern: "**/*.ts", path: "/tmp" }).path).toBe("/tmp")
    })
    test("rejects missing pattern", () => {
      expect(Glob.safeParse({}).success).toBe(false)
    })
  })

  describe("grep", () => {
    test("accepts pattern-only", () => {
      expect(Grep.parse({ pattern: "TODO" })).toEqual({ pattern: "TODO" })
    })
    test("accepts optional path + include", () => {
      const parsed = Grep.parse({ pattern: "TODO", path: "/tmp", include: "*.ts" })
      expect(parsed.path).toBe("/tmp")
      expect(parsed.include).toBe("*.ts")
    })
    test("rejects missing pattern", () => {
      expect(Grep.safeParse({}).success).toBe(false)
    })
  })

  describe("invalid", () => {
    test("accepts tool + error", () => {
      expect(Invalid.parse({ tool: "foo", error: "bar" })).toEqual({ tool: "foo", error: "bar" })
    })
    test("rejects missing fields", () => {
      expect(Invalid.safeParse({ tool: "foo" }).success).toBe(false)
      expect(Invalid.safeParse({ error: "bar" }).success).toBe(false)
    })
  })

  describe("lsp", () => {
    test("accepts all fields", () => {
      const parsed = Lsp.parse({ operation: "hover", filePath: "/a.ts", line: 1, character: 1 })
      expect(parsed.operation).toBe("hover")
    })
    test("rejects line < 1", () => {
      expect(Lsp.safeParse({ operation: "hover", filePath: "/a.ts", line: 0, character: 1 }).success).toBe(false)
    })
    test("rejects character < 1", () => {
      expect(Lsp.safeParse({ operation: "hover", filePath: "/a.ts", line: 1, character: 0 }).success).toBe(false)
    })
    test("rejects unknown operation", () => {
      expect(Lsp.safeParse({ operation: "bogus", filePath: "/a.ts", line: 1, character: 1 }).success).toBe(false)
    })
  })

  describe("multiedit", () => {
    test("accepts empty edits array", () => {
      expect(MultiEdit.parse({ filePath: "/a", edits: [] }).edits).toEqual([])
    })
    test("accepts an edit entry", () => {
      const parsed = MultiEdit.parse({
        filePath: "/a",
        edits: [{ filePath: "/a", oldString: "x", newString: "y" }],
      })
      expect(parsed.edits.length).toBe(1)
    })
  })

  describe("plan", () => {
    test("accepts empty object", () => {
      expect(Plan.parse({})).toEqual({})
    })
  })

  describe("question", () => {
    test("accepts questions array", () => {
      const parsed = Question.parse({
        questions: [
          {
            question: "pick one",
            header: "Header",
            custom: false,
            options: [{ label: "a", description: "desc" }],
          },
        ],
      })
      expect(parsed.questions.length).toBe(1)
    })
    test("rejects missing questions", () => {
      expect(Question.safeParse({}).success).toBe(false)
    })
  })

  describe("read", () => {
    test("accepts filePath-only", () => {
      expect(Read.parse({ filePath: "/a" }).filePath).toBe("/a")
    })
    test("accepts optional offset + limit", () => {
      const parsed = Read.parse({ filePath: "/a", offset: 10, limit: 100 })
      expect(parsed.offset).toBe(10)
      expect(parsed.limit).toBe(100)
    })
  })

  describe("skill", () => {
    test("accepts name", () => {
      expect(Skill.parse({ name: "foo" }).name).toBe("foo")
    })
    test("rejects missing name", () => {
      expect(Skill.safeParse({}).success).toBe(false)
    })
  })

  describe("task", () => {
    test("accepts description + prompt + subagent_type", () => {
      const parsed = Task.parse({ description: "d", prompt: "p", subagent_type: "general" })
      expect(parsed.subagent_type).toBe("general")
    })
    test("rejects missing prompt", () => {
      expect(Task.safeParse({ description: "d", subagent_type: "general" }).success).toBe(false)
    })
  })

  describe("todo", () => {
    test("accepts todos array", () => {
      const parsed = Todo.parse({
        todos: [{ id: "t1", content: "do x", status: "pending", priority: "medium" }],
      })
      expect(parsed.todos.length).toBe(1)
    })
    test("rejects missing todos", () => {
      expect(Todo.safeParse({}).success).toBe(false)
    })
  })

  describe("webfetch", () => {
    test("accepts url-only", () => {
      expect(WebFetch.parse({ url: "https://example.com" }).url).toBe("https://example.com")
    })
  })

  describe("websearch", () => {
    test("accepts query", () => {
      expect(WebSearch.parse({ query: "opencode" }).query).toBe("opencode")
    })
  })

  describe("write", () => {
    test("accepts content + filePath", () => {
      expect(Write.parse({ content: "hi", filePath: "/a" })).toEqual({ content: "hi", filePath: "/a" })
    })
    test("rejects missing filePath", () => {
      expect(Write.safeParse({ content: "hi" }).success).toBe(false)
    })
  })
})
