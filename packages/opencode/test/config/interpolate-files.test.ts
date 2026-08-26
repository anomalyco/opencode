import { expect, test, describe } from "bun:test"
import { ConfigMarkdown } from "@/config/markdown"
import path from "path"

describe("ConfigMarkdown: file interpolation", async () => {
  const fixturesDir = path.join(import.meta.dir, "fixtures/interpolate")

  test("should return content unchanged when no file references exist", async () => {
    const result = await ConfigMarkdown.interpolateFiles("just plain text", fixturesDir)
    expect(result.content).toBe("just plain text")
    expect(result.errors).toHaveLength(0)
  })

  test("should interpolate a simple file reference", async () => {
    const content = "Before\n{file:./simple.md}\nAfter"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("simple included content")
    expect(result.content).not.toContain("{file:")
    expect(result.errors).toHaveLength(0)
  })

  test("should strip frontmatter from included files", async () => {
    const content = "{file:./with-frontmatter.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("body content here")
    expect(result.content).not.toContain("---")
    expect(result.content).not.toContain("description:")
  })

  test("should handle relative paths with ../", async () => {
    const content = "{file:./subdir/parent-ref.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("simple included content")
  })

  test("should handle missing files gracefully", async () => {
    const content = "Start\n{file:./missing.md}\nEnd"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("<!-- File not found: ./missing.md -->")
    expect(result.content).toContain("Start")
    expect(result.content).toContain("End")
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      type: "not_found",
      refPath: "./missing.md",
      resolvedPath: path.resolve(fixturesDir, "./missing.md"),
    })
  })

  test("should handle circular references", async () => {
    const content = "{file:./circular-a.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("content from A")
    expect(result.content).toContain("<!-- Circular file reference:")
    expect(result.errors.length).toBeGreaterThanOrEqual(1)
    expect(result.errors.some((e) => e.type === "circular")).toBe(true)
  })

  test("should respect max depth", async () => {
    const content = "{file:./deep-1.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("<!-- Max include depth exceeded:")
    expect(result.errors.some((e) => e.type === "max_depth")).toBe(true)
  })

  test("should allow same file included from different branches", async () => {
    const content = "First: {file:./simple.md}\nSecond: {file:./simple.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    const count = (result.content.match(/simple included content/g) || []).length
    expect(count).toBe(2)
  })

  test("should interpolate recursively in included files", async () => {
    const content = "{file:./nested-parent.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("nested parent content")
    expect(result.content).toContain("simple included content")
  })

  test("should handle empty included file", async () => {
    const content = "Before\n{file:./empty.md}\nAfter"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("Before")
    expect(result.content).toContain("After")
  })

  test("should handle multiple different file references", async () => {
    const content = "{file:./simple.md}\n---\n{file:./with-frontmatter.md}"
    const result = await ConfigMarkdown.interpolateFiles(content, fixturesDir)
    expect(result.content).toContain("simple included content")
    expect(result.content).toContain("body content here")
  })
})
