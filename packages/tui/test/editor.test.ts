import { afterEach, expect, test } from "bun:test"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { normalizePromptContent, openEditor, parseEditorCommand } from "../src/editor"

const editor = process.env.EDITOR
const visual = process.env.VISUAL

afterEach(() => {
  process.env.EDITOR = editor
  process.env.VISUAL = visual
})

test("rejects when the external editor cannot start", async () => {
  delete process.env.VISUAL
  process.env.EDITOR = "opencode-editor-that-does-not-exist"
  const renderer = {
    suspend() {},
    resume() {},
    requestRender() {},
    currentRenderBuffer: { clear() {} },
  }

  await expect(openEditor({ value: "original", renderer: renderer as never })).rejects.toThrow()
})

test("keeps a quoted editor path with spaces intact", () => {
  expect(parseEditorCommand('"/mnt/c/Program Files/Notepad++/notepad++.exe" -multiInst -nosession')).toEqual([
    "/mnt/c/Program Files/Notepad++/notepad++.exe",
    "-multiInst",
    "-nosession",
  ])
})

test("preserves backslashes and handles single quotes and repeated whitespace", () => {
  expect(parseEditorCommand('"C:\\Program Files\\Vim\\vim.exe" -f')).toEqual(["C:\\Program Files\\Vim\\vim.exe", "-f"])
  expect(parseEditorCommand("'/opt/my editor'   -w")).toEqual(["/opt/my editor", "-w"])
  expect(parseEditorCommand("vim")).toEqual(["vim"])
  expect(parseEditorCommand("   ")).toEqual([])
})

test("opens an editor whose path contains spaces", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "opencode editor test "))
  const windows = process.platform === "win32"
  const script = path.join(directory, windows ? "my editor.cmd" : "my editor")
  await writeFile(script, windows ? '@echo off\r\necho EDITED>>"%~1"\r\n' : '#!/bin/sh\necho EDITED >> "$1"\n')
  if (!windows) await chmod(script, 0o755)

  delete process.env.VISUAL
  process.env.EDITOR = `"${script}"`
  const renderer = {
    suspend() {},
    resume() {},
    requestRender() {},
    currentRenderBuffer: { clear() {} },
  }

  try {
    const result = await openEditor({ value: "original\n", renderer: renderer as never })
    expect(result).toContain("EDITED")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("normalizes a single trailing editor newline for one-line prompts", () => {
  expect(normalizePromptContent("hello\n")).toBe("hello")
  expect(normalizePromptContent("hello\r\n")).toBe("hello")
})

test("preserves multiline prompts that end with a newline", () => {
  expect(normalizePromptContent("hello\nworld\n")).toBe("hello\nworld\n")
})
