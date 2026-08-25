import { afterEach, expect, test } from "bun:test"
import { normalizePromptContent, openEditor } from "../src/editor"

const editor = process.env.EDITOR
const visual = process.env.VISUAL

afterEach(() => {
  process.env.EDITOR = editor
  process.env.VISUAL = visual
})

test("returns undefined when the external editor cannot start", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = "opencode-editor-that-does-not-exist"
  const renderer = {
    suspend() {},
    resume() {},
    requestRender() {},
    currentRenderBuffer: { clear() {} },
  }

  const result = await openEditor({ value: "original", renderer: renderer as never })
  expect(result).toBeUndefined()
})

test("resolves with undefined when editor exits non-zero", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = 'node -e "process.exit(1)"'
  const renderer = {
    suspend() {},
    resume() {},
    requestRender() {},
    currentRenderBuffer: { clear() {} },
  }

  const result = await openEditor({ value: "original", renderer: renderer as never })
  expect(result).toBeUndefined()
})

test("normalizes a single trailing editor newline for one-line prompts", () => {
  expect(normalizePromptContent("hello\n")).toBe("hello")
  expect(normalizePromptContent("hello\r\n")).toBe("hello")
})

test("preserves multiline prompts that end with a newline", () => {
  expect(normalizePromptContent("hello\nworld\n")).toBe("hello\nworld\n")
})
