import { afterEach, expect, test } from "bun:test"
import { normalizePromptContent, openEditor } from "../src/editor"

const editor = process.env.EDITOR
const visual = process.env.VISUAL

afterEach(() => {
  if (editor === undefined) delete process.env.EDITOR
  else process.env.EDITOR = editor
  if (visual === undefined) delete process.env.VISUAL
  else process.env.VISUAL = visual
})

const stubRenderer = () => ({
  suspend() {},
  resume() {},
  requestRender() {},
  currentRenderBuffer: { clear() {} },
})

test("rejects when the external editor cannot start", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = "opencode-editor-that-does-not-exist"

  await expect(openEditor({ value: "original", renderer: stubRenderer() as never })).rejects.toThrow()
})

test("returns empty content saved by the external editor", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = `${process.execPath} -e Bun.write(process.argv[1],'')`

  await expect(openEditor({ value: "original", renderer: stubRenderer() as never })).resolves.toBe("")
})

test("rejects when the external editor exits without saving", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = `${process.execPath} -e process.exit(1)`

  await expect(openEditor({ value: "original", renderer: stubRenderer() as never })).rejects.toThrow()
})

test("returns undefined when no editor is configured", async () => {
  delete process.env.VISUAL
  delete process.env.EDITOR

  await expect(openEditor({ value: "original", renderer: stubRenderer() as never })).resolves.toBeUndefined()
})

test("normalizes a single trailing editor newline for one-line prompts", () => {
  expect(normalizePromptContent("hello\n")).toBe("hello")
  expect(normalizePromptContent("hello\r\n")).toBe("hello")
})

test("preserves multiline prompts that end with a newline", () => {
  expect(normalizePromptContent("hello\nworld\n")).toBe("hello\nworld\n")
})
