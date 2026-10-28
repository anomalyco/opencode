import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import {
  buildEditorInvocation,
  normalizePromptContent,
  openEditor,
  openFileAtLocation,
  splitCommand,
} from "../src/editor"
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

test("splits an editor command without treating quotes as arguments", () => {
  expect(splitCommand(`code --extensions-dir "C:\\my dir\\ext"`)).toEqual([
    "code",
    "--extensions-dir",
    "C:\\my dir\\ext",
  ])
  expect(splitCommand("'nvim' -u NONE")).toEqual(["nvim", "-u", "NONE"])
})

test("builds editor invocations with line and column support", () => {
  expect(
    buildEditorInvocation({
      editor: "code --wait",
      file: { file: "C:\\repo\\a.ts", line: 12, column: 3 },
      platform: "win32",
    }),
  ).toEqual({
    command: "code",
    args: ["--wait", "--goto", "C:\\repo\\a.ts:12:3"],
    terminal: false,
    shell: true,
  })
  expect(buildEditorInvocation({ editor: "nvim", file: { file: "/repo/a.ts", line: 4 }, platform: "linux" })).toEqual({
    command: "nvim",
    args: ["+4", "/repo/a.ts"],
    terminal: true,
    shell: false,
  })
  expect(
    buildEditorInvocation({ editor: "nano", file: { file: "/a.ts", line: 4, column: 2 }, platform: "linux" }),
  ).toEqual({
    command: "nano",
    args: ["+4,2", "/a.ts"],
    terminal: true,
    shell: false,
  })
  expect(
    buildEditorInvocation({ editor: "emacs", file: { file: "/a.ts", line: 4, column: 2 }, platform: "linux" }),
  ).toEqual({
    command: "emacs",
    args: ["+4:2", "/a.ts"],
    terminal: true,
    shell: false,
  })
  expect(
    buildEditorInvocation({ editor: "unknown-editor", file: { file: "/a.ts", line: 4 }, platform: "linux" }),
  ).toEqual({
    command: "unknown-editor",
    args: ["/a.ts"],
    terminal: false,
    shell: false,
  })
})

test("treats a quoted editor executable as a path, not a shell command shim", () => {
  expect(
    buildEditorInvocation({
      editor: `"C:\\Program Files\\Code\\Code.exe" --reuse-window`,
      file: { file: "C:\\repo\\a.ts" },
      platform: "win32",
    }),
  ).toEqual({
    command: "C:\\Program Files\\Code\\Code.exe",
    args: ["--reuse-window", "C:\\repo\\a.ts"],
    terminal: false,
    shell: false,
  })
})

test("refuses to open a path that does not exist", async () => {
  await using tmp = await tmpdir()
  await expect(
    openFileAtLocation({ path: path.join(tmp.path, "missing.ts"), renderer: renderer() as never }),
  ).rejects.toThrow("does not exist")
})

test("refuses to launch an executable file when no editor is configured", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "build.cmd")
  await writeFile(file, "@echo off\n")
  delete process.env.EDITOR
  delete process.env.VISUAL

  await expect(openFileAtLocation({ path: file, renderer: renderer() as never })).rejects.toThrow("Refusing to launch")
})

test.skipIf(process.platform === "win32")("refuses to launch a file with an executable bit and no editor", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "tool.sh")
  await writeFile(file, "#!/bin/sh\n", { mode: 0o755 })
  delete process.env.EDITOR
  delete process.env.VISUAL

  await expect(openFileAtLocation({ path: file, renderer: renderer() as never })).rejects.toThrow("Refusing to launch")
})

test.skipIf(process.platform === "win32")("passes the line to a terminal editor and resumes the renderer", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "target.ts")
  const script = path.join(tmp.path, "vim")
  await writeFile(file, "const value = 1\n")
  await writeFile(script, '#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\n', { mode: 0o755 })
  delete process.env.EDITOR
  process.env.VISUAL = script
  const events: string[] = []

  await openFileAtLocation({ path: file, line: 7, renderer: renderer(events) as never })

  expect(events).toEqual(["suspend", "resume"])
  expect((await readFile(`${script}.args`, "utf8")).trim().split("\n")).toEqual(["+7", file])
})

test.skipIf(process.platform === "win32")("passes line and column to an editor process", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "target.ts")
  const script = path.join(tmp.path, "code")
  await writeFile(file, "const value = 1\n")
  await writeFile(script, '#!/bin/sh\nprintf "%s\\n" "$@" > "$0.args"\n', { mode: 0o755 })
  delete process.env.EDITOR
  process.env.VISUAL = script

  await openFileAtLocation({ path: file, line: 12, column: 3, renderer: renderer() as never })

  expect(await editorArgs(`${script}.args`, 2)).toEqual(["--goto", `${file}:12:3`])
})

test.skipIf(process.platform !== "win32")("opens a path through a Windows command shim", async () => {
  await using tmp = await tmpdir()
  const file = path.join(tmp.path, "target.ts")
  const script = path.join(tmp.path, "vim.cmd")
  const argsFile = path.join(tmp.path, "vim.args")
  await writeFile(file, "const value = 1\n")
  await writeFile(script, `@echo off\r\n(for %%a in (%*) do @echo %%~a) > "${argsFile}"\r\n`)
  delete process.env.EDITOR
  process.env.VISUAL = script
  const events: string[] = []

  await openFileAtLocation({ path: file, line: 7, renderer: renderer(events) as never })

  expect(events).toEqual(["suspend", "resume"])
  expect((await readFile(argsFile, "utf8")).trim().split(/\r?\n/)).toEqual(["+7", file])
})

async function editorArgs(file: string, expected = 1) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(file)) {
      const args = (await readFile(file, "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
      if (args.length >= expected) return args
    }
    await Bun.sleep(20)
  }
  throw new Error(`Editor did not write ${file}`)
}
