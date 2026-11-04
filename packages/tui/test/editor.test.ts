import { afterEach, expect, test } from "bun:test"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { normalizePromptContent, openEditor } from "../src/editor"
import { tmpdir } from "./fixture/fixture"

const editor = process.env.EDITOR
const visual = process.env.VISUAL

afterEach(() => {
  process.env.EDITOR = editor
  process.env.VISUAL = visual
})

function renderer(events: string[] = []) {
  return {
    async suspend() {
      events.push("suspend")
    },
    async resume() {
      events.push("resume")
    },
  }
}

test("rejects when the external editor cannot start", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = "opencode-editor-that-does-not-exist"

  await expect(openEditor({ value: "original", renderer: renderer() as never })).rejects.toThrow()
})

test.skipIf(process.platform === "win32")("returns the edited prompt and resumes the renderer", async () => {
  await using tmp = await tmpdir()
  const script = path.join(tmp.path, "editor.sh")
  await writeFile(script, '#!/bin/sh\nprintf edited >> "$1"\n', { mode: 0o755 })
  delete process.env.VISUAL
  process.env.EDITOR = script
  const events: string[] = []

  expect(await openEditor({ value: "original ", renderer: renderer(events) as never })).toBe("original edited")
  expect(events).toEqual(["suspend", "resume"])
})

test("says which variable to set when no external editor is configured", async () => {
  delete process.env.VISUAL
  delete process.env.EDITOR
  let suspended = false
  const renderer = {
    suspend() {
      suspended = true
    },
    resume() {},
    requestRender() {},
    currentRenderBuffer: { clear() {} },
  }

  await expect(openEditor({ value: "original", renderer: renderer as never })).rejects.toThrow("$EDITOR")
  expect(suspended).toBe(false)
})

test("normalizes a single trailing editor newline for one-line prompts", () => {
  expect(normalizePromptContent("hello\n")).toBe("hello")
  expect(normalizePromptContent("hello\r\n")).toBe("hello")
})

test("preserves multiline prompts that end with a newline", () => {
  expect(normalizePromptContent("hello\nworld\n")).toBe("hello\nworld\n")
})
