import { describe, expect, test } from "bun:test"
import { Skill } from "@opencode-ai/schema/skill"
import type { Prompt } from "@/composer/state"
import { buildPromptRequest } from "./request"

describe("buildPromptRequest", () => {
  test("builds text, files, and agents from the prompt", () => {
    const prompt: Prompt = [
      { type: "text", content: "hello", start: 0, end: 5 },
      {
        type: "file",
        path: "src/foo.ts",
        content: "@src/foo.ts",
        start: 5,
        end: 16,
        selection: { startLine: 4, startChar: 1, endLine: 6, endChar: 1 },
      },
      { type: "agent", name: "planner", content: "@planner", start: 16, end: 24 },
    ]

    const result = buildPromptRequest({
      prompt,
      context: [{ key: "ctx:1", type: "file", path: "src/bar.ts", comment: "check this" }],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
      ],
      text: "hello @src/foo.ts @planner",
      sessionDirectory: "/repo",
    })

    expect(result.text).toContain("hello @src/foo.ts @planner")
    expect(result.text).toContain("check this")
    expect(result.displayText).toBe("hello @src/foo.ts @planner")
    expect(result.comments).toMatchObject([{ path: "src/bar.ts", comment: "check this" }])
    expect(result.agents).toEqual([{ name: "planner", mention: { start: 16, end: 24, text: "@planner" } }])
    expect(result.files.some((file) => file.uri.startsWith("file:///repo/src/foo.ts"))).toBe(true)
    expect(result.files.find((file) => file.uri.startsWith("file:///repo/src/foo.ts"))?.mention).toEqual({
      start: 5,
      end: 16,
      text: "@src/foo.ts",
    })
  })

  test("keeps multiple uploaded attachments in order", () => {
    const result = buildPromptRequest({
      prompt: [{ type: "text", content: "check these", start: 0, end: 11 }],
      context: [],
      images: [
        { type: "image", id: "img_1", filename: "a.png", mime: "image/png", dataUrl: "data:image/png;base64,AAA" },
        {
          type: "image",
          id: "img_2",
          filename: "b.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,BBB",
        },
      ],
      text: "check these",
      sessionDirectory: "/repo",
    })

    const uploads = result.files.filter((file) => file.uri.startsWith("data:"))

    expect(uploads).toHaveLength(2)
    expect(uploads.map((file) => file.name)).toEqual(["a.png", "b.pdf"])
  })

  test("preserves an external attachment source path for the model", () => {
    const result = buildPromptRequest({
      prompt: [],
      context: [],
      images: [
        {
          type: "image",
          id: "img_external",
          filename: "opencode.global.dat",
          sourcePath: "C:\\Users\\Luke\\AppData\\Roaming\\ai.opencode.desktop.beta\\opencode.global.dat",
          mime: "text/plain",
          dataUrl: "data:text/plain;base64,AAA",
        },
      ],
      text: "inspect this",
      sessionDirectory: "C:\\Repos\\sst\\opencode",
    })

    expect(result.files[0]?.name).toBe(
      "C:\\Users\\Luke\\AppData\\Roaming\\ai.opencode.desktop.beta\\opencode.global.dat",
    )
  })

  test("preserves reference aliases as directory files", () => {
    const result = buildPromptRequest({
      prompt: [
        {
          type: "file",
          path: "/repo/../docs",
          content: "@docs",
          start: 0,
          end: 5,
          mime: "application/x-directory",
          filename: "docs",
        },
      ],
      context: [],
      images: [],
      text: "@docs",
      sessionDirectory: "/repo/app",
    })

    expect(result.files[0]).toEqual({
      uri: "file:///repo/../docs",
      mime: "application/x-directory",
      name: "docs",
      mention: { start: 0, end: 5, text: "@docs" },
    })
  })

  test("deduplicates context files when prompt already includes same path", () => {
    const prompt: Prompt = [{ type: "file", path: "src/foo.ts", content: "@src/foo.ts", start: 0, end: 11 }]

    const result = buildPromptRequest({
      prompt,
      context: [
        { key: "ctx:dup", type: "file", path: "src/foo.ts" },
        { key: "ctx:comment", type: "file", path: "src/foo.ts", comment: "focus here" },
      ],
      images: [],
      text: "@src/foo.ts",
      sessionDirectory: "/repo",
    })

    const fooFiles = result.files.filter((file) => file.uri.startsWith("file:///repo/src/foo.ts"))

    expect(fooFiles).toHaveLength(2)
    expect(result.text).toContain("focus here")
  })

  test("adds files for @mentions inside comment text", () => {
    const result = buildPromptRequest({
      prompt: [{ type: "text", content: "look", start: 0, end: 4 }],
      context: [
        {
          key: "ctx:comment-mention",
          type: "file",
          path: "src/review.ts",
          comment: "Compare with @src/shared.ts and @src/review.ts.",
        },
      ],
      images: [],
      text: "look",
      sessionDirectory: "/repo",
    })

    expect(result.files).toHaveLength(2)
    expect(result.files.some((file) => file.uri === "file:///repo/src/review.ts")).toBe(true)
    expect(result.files.some((file) => file.uri === "file:///repo/src/shared.ts")).toBe(true)
  })

  test("handles Windows paths correctly (simulated on macOS)", () => {
    const prompt: Prompt = [{ type: "file", path: "src\\foo.ts", content: "@src\\foo.ts", start: 0, end: 11 }]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@src\\foo.ts",
      sessionDirectory: "D:\\projects\\myapp", // Windows path
    })

    const file = result.files[0]
    expect(file).toBeDefined()
    // URL should be parseable
    expect(() => new URL(file!.uri)).not.toThrow()
    // Should not have encoded backslashes in wrong place
    expect(file!.uri).not.toContain("%5C")
    // Should have normalized to forward slashes
    expect(file!.uri).toContain("/src/foo.ts")
  })

  test("handles Windows absolute path with special characters", () => {
    const prompt: Prompt = [{ type: "file", path: "file#name.txt", content: "@file#name.txt", start: 0, end: 14 }]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@file#name.txt",
      sessionDirectory: "C:\\Users\\test\\Documents", // Windows path
    })

    const file = result.files[0]
    expect(file).toBeDefined()
    // URL should be parseable
    expect(() => new URL(file!.uri)).not.toThrow()
    // Special chars should be encoded
    expect(file!.uri).toContain("file%23name.txt")
    // Should have Windows drive letter properly encoded
    expect(file!.uri).toMatch(/file:\/\/\/[A-Z]:/)
  })

  test("handles Linux absolute paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "src/app.ts", content: "@src/app.ts", start: 0, end: 10 }]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@src/app.ts",
      sessionDirectory: "/home/user/project",
    })

    expect(result.files[0]?.uri).toBe("file:///home/user/project/src/app.ts")
  })

  test("handles macOS paths correctly", () => {
    const prompt: Prompt = [{ type: "file", path: "README.md", content: "@README.md", start: 0, end: 9 }]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@README.md",
      sessionDirectory: "/Users/kelvin/Projects/opencode",
    })

    expect(result.files[0]?.uri).toBe("file:///Users/kelvin/Projects/opencode/README.md")
  })

  test("handles context files with Windows paths", () => {
    const result = buildPromptRequest({
      prompt: [],
      context: [
        { key: "ctx:1", type: "file", path: "src\\utils\\helper.ts" },
        { key: "ctx:2", type: "file", path: "test\\unit.test.ts", comment: "check tests" },
      ],
      images: [],
      text: "test",
      sessionDirectory: "D:\\workspace\\app",
    })

    expect(result.files).toHaveLength(2)

    // All file URLs should be valid
    result.files.forEach((file) => {
      expect(() => new URL(file.uri)).not.toThrow()
      expect(file.uri).not.toContain("%5C") // No encoded backslashes
    })
  })

  test("handles absolute Windows paths (user manually specifies full path)", () => {
    const prompt: Prompt = [
      { type: "file", path: "D:\\other\\project\\file.ts", content: "@D:\\other\\project\\file.ts", start: 0, end: 25 },
    ]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@D:\\other\\project\\file.ts",
      sessionDirectory: "C:\\current\\project",
    })

    const file = result.files[0]
    expect(file).toBeDefined()
    // Should handle absolute path that differs from sessionDirectory
    expect(() => new URL(file!.uri)).not.toThrow()
    expect(file!.uri).toContain("/D:/other/project/file.ts")
  })

  test("handles selection with query parameters on Windows", () => {
    const prompt: Prompt = [
      {
        type: "file",
        path: "src\\App.tsx",
        content: "@src\\App.tsx",
        start: 0,
        end: 11,
        selection: { startLine: 10, startChar: 0, endLine: 20, endChar: 5 },
      },
    ]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@src\\App.tsx",
      sessionDirectory: "C:\\project",
    })

    const file = result.files[0]
    expect(file).toBeDefined()
    // Should have query parameters
    expect(file!.uri).toContain("?start=10&end=20")
    // Should be valid URL
    expect(() => new URL(file!.uri)).not.toThrow()
    // Query params should parse correctly
    const url = new URL(file!.uri)
    expect(url.searchParams.get("start")).toBe("10")
    expect(url.searchParams.get("end")).toBe("20")
  })

  test("handles file paths with dots and special segments on Windows", () => {
    const prompt: Prompt = [
      { type: "file", path: "..\\..\\shared\\util.ts", content: "@..\\..\\shared\\util.ts", start: 0, end: 21 },
    ]

    const result = buildPromptRequest({
      prompt,
      context: [],
      images: [],
      text: "@..\\..\\shared\\util.ts",
      sessionDirectory: "C:\\projects\\myapp\\src",
    })

    const file = result.files[0]
    expect(file).toBeDefined()
    // Should be valid URL
    expect(() => new URL(file!.uri)).not.toThrow()
    // Should preserve .. segments (backend normalizes)
    expect(file!.uri).toContain("/..")
  })

  test("keeps skill mentions out of file attachments", () => {
    const skill = {
      id: "skill-review",
      name: "review",
    }
    const result = buildPromptRequest({
      prompt: [
        {
          type: "skill",
          id: Skill.ID.make(skill.id),
          name: Skill.Name.make(skill.name),
          content: "@review",
          start: 0,
          end: 7,
        },
      ],
      context: [],
      images: [],
      text: "@review",
      sessionDirectory: "/repo",
    })

    expect(result.files).toEqual([])
    expect(result.skills).toEqual([{ id: skill.id, name: skill.name, mention: { start: 0, end: 7, text: "@review" } }])
  })
})
