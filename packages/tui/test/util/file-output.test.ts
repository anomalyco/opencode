import { describe, expect, test } from "bun:test"
import {
  bashOutputModel,
  commandLanguage,
  genericOutputModel,
  grepToolOutputModel,
  previewLines,
  readDisplay,
  readOutputModel,
  type FileOutputModel,
} from "../../src/util/file-output"

// Each line as gutter|code@language, so a test reads what is muted and what is colored how.
const view = (model: FileOutputModel | undefined) =>
  model?.lines.map((line, index) => {
    const info = model.info[index]
    const language = info.chunk === undefined ? "plain" : model.chunks[info.chunk].language
    return `${line.slice(0, info.gutter)}|${line.slice(info.gutter)}@${language}`
  })

describe("commandLanguage", () => {
  test("takes the one language of every file a command reads", () => {
    expect(
      commandLanguage(
        "cd /x/vibeterm-opencode-client && cat tab-trail.ts | sed -n 1,60p; sed -n 1,40p ../_lib/opencode-db-schema/index.ts; sed -n 90,125p tab-history.ts",
      ),
    ).toBe("typescript")
    expect(commandLanguage("head -n 40 app/models/user.rb")).toBe("ruby")
    expect(commandLanguage("sed -n '1p;5p' tool.py")).toBe("python")
    expect(commandLanguage('rg -n "a|b" main.go')).toBe("go")
    expect(commandLanguage("grep -n foo a.ts b.tsx")).toBe("typescript")
    expect(commandLanguage("rg -t py foo src")).toBe("python")
    expect(commandLanguage("rg -g '*.rs' unsafe")).toBe("rust")
    expect(commandLanguage("rg --glob='src/**/*.{ts,tsx}' foo")).toBe("typescript")
    expect(commandLanguage("git show HEAD~2:src/lib.rs | head -50")).toBe("rust")
    expect(commandLanguage("timeout 10 tail -n 20 notes.md 2>&1")).toBe("markdown")
  })

  test("names no language when the files differ, a stage transforms them or another command prints", () => {
    expect(commandLanguage("grep -n foo a.ts README.md")).toBeUndefined()
    expect(commandLanguage("cat package.json | jq .name")).toBeUndefined()
    expect(commandLanguage("ls && cat a.ts")).toBeUndefined()
    expect(commandLanguage("rg -n foo src/")).toBeUndefined()
    expect(commandLanguage("cat server.log")).toBeUndefined()
    expect(commandLanguage("bun test a.test.ts")).toBeUndefined()
  })
})

describe("bashOutputModel", () => {
  test("colors a read of files of one language whole", () => {
    expect(view(bashOutputModel("cat a.ts | sed -n 1,2p", "import x from 'y'\nexport const a = 1"))).toEqual([
      "|import x from 'y'@typescript",
      "|export const a = 1@typescript",
    ])
  })

  test("colors path:line: matches by each line's file and mutes the prefix", () => {
    const output = "src/a.ts:3:const a = 1\nsrc/a.ts-4-const b = 2\n--\ndocs/b.md:10:# Title\nsrc/c.py:1:import os"
    expect(view(bashOutputModel("grep -rn -C1 a .", output))).toEqual([
      "src/a.ts:3:|const a = 1@typescript",
      "src/a.ts-4-|const b = 2@typescript",
      "--|@plain",
      "docs/b.md:10:|# Title@markdown",
      "src/c.py:1:|import os@python",
    ])
    const model = bashOutputModel("grep -rn -C1 a .", output)!
    expect(model.chunks.map((chunk) => chunk.lines)).toEqual([[0, 1], [3], [4]])
  })

  test("colors rg's headings: the path line muted, then each 12:code line in its language", () => {
    const output = "src/a.ts\n3:const a = 1\n9:let b\n\nREADME.md\n1:# Hello"
    expect(view(bashOutputModel("rg -n a", output))).toEqual([
      "src/a.ts|@plain",
      "3:|const a = 1@typescript",
      "9:|let b@typescript",
      "|@plain",
      "README.md|@plain",
      "1:|# Hello@markdown",
    ])
  })

  test("colors a line-number gutter in the command's language", () => {
    expect(view(bashOutputModel("rg -n def tool.py", "1:def a():\n7:def b():"))).toEqual([
      "1:|def a():@python",
      "7:|def b():@python",
    ])
    expect(view(bashOutputModel("cat -n main.go", "     1\tpackage main\n     2\t"))).toEqual([
      "     1\t|package main@go",
      "     2\t|@go",
    ])
  })

  test("recognizes JSON and diffs whatever printed them", () => {
    expect(bashOutputModel("curl -s localhost:3000/health", '{"ok": true}')?.chunks[0].language).toBe("json")
    expect(bashOutputModel("git show HEAD", "diff --git a/x b/x\n--- a/x\n+++ b/x")?.chunks[0].language).toBe("diff")
  })

  test("leaves output of no clear language plain", () => {
    expect(bashOutputModel("bun test", "12 pass\n0 fail")).toBeUndefined()
    expect(bashOutputModel("grep -n foo a.ts README.md", "plain words")).toBeUndefined()
    expect(bashOutputModel("cat a.ts", "x".repeat(200_000))).toBeUndefined()
  })
})

describe("readOutputModel and grepToolOutputModel", () => {
  test("mutes the read tool's wrapper and line numbers and colors the file", () => {
    const output =
      "<path>/x/main.go</path>\n<type>file</type>\n<content>\n1: package main\n2: \n\n(End of file - total 2 lines)\n</content>"
    expect(readDisplay(output)).toBe("1: package main\n2: \n\n(End of file - total 2 lines)")
    expect(readDisplay("<path>/x</path>\n<type>directory</type>\n<entries>\na/\n</entries>")).toContain("<entries>")
    expect(view(readOutputModel("/x/main.go", readDisplay(output)))).toEqual([
      "1: |package main@go",
      "2: |@go",
      "|@plain",
      "(End of file - total 2 lines)|@plain",
    ])
  })

  test("colors each file's matches from the grep tool in its language", () => {
    const output = "Found 2 matches\n/x/a.ts:\n  Line 3: const a = 1\n\n/x/b.py:\n  Line 1: import os"
    expect(view(grepToolOutputModel(output))).toEqual([
      "Found 2 matches|@plain",
      "/x/a.ts:|@plain",
      "  Line 3: |const a = 1@typescript",
      "|@plain",
      "/x/b.py:|@plain",
      "  Line 1: |import os@python",
    ])
  })
})

describe("genericOutputModel", () => {
  test("colors each GitHub code search snippet in the language of its path", () => {
    const output = [
      "Repository: a/b",
      "Path: src/x.swift",
      "URL: https://github.com/a/b",
      "License: MIT",
      "",
      "Snippets:",
      "--- Snippet 1 (Line 86) ---",
      "let a = 1",
      "",
      "Repository: c/d",
      "Path: lib/y.rb",
      "Snippets:",
      "--- Snippet 1 (Line 2) ---",
      "def z; end",
    ].join("\n")
    const lines = view(genericOutputModel(output))!
    expect(lines.filter((line) => !line.endsWith("@plain"))).toEqual([
      "|let a = 1@swift",
      "|@swift",
      "|def z; end@ruby",
    ])
    expect(lines[1]).toBe("Path: src/x.swift|@plain")
  })

  test("reads docs with a fenced code block as markdown, and leaves prose plain", () => {
    expect(genericOutputModel("### Use it\n\n```bash\necho foo\n```")?.chunks[0].language).toBe("markdown")
    expect(genericOutputModel("Found 5 matches:\nsome prose")).toBeUndefined()
  })
})

describe("previewLines", () => {
  const output = ["a", "b", "c", "d", "e", "f"]
  test("maps the whole output line for line", () => {
    expect(previewLines(output, output).map((line) => line?.line)).toEqual([0, 1, 2, 3, 4, 5])
  })
  test("maps a head preview, its cut last line and the marker", () => {
    expect(previewLines(["a", "b", "…"], output)).toEqual([
      { line: 0, from: 0, to: 1 },
      { line: 1, from: 0, to: 1 },
      undefined,
    ])
    expect(previewLines(["a", "bc…"], ["a", "bcdef"])[1]).toEqual({ line: 1, from: 0, to: 2 })
  })
  test("maps a head and tail around a marker, and a tail cut at its start", () => {
    expect(previewLines(["a", "(3 more lines)", "e", "f"], output).map((line) => line?.line)).toEqual([
      0,
      undefined,
      4,
      5,
    ])
    expect(previewLines(["(4 earlier lines)", "ef", "g"], ["a", "b", "c", "d", "def", "g"])).toEqual([
      undefined,
      { line: 4, from: 1, to: 3 },
      { line: 5, from: 0, to: 1 },
    ])
  })
})
