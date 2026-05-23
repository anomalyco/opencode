import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import * as LSPServer from "@/lsp/server"
import { tmpdir } from "../fixture/fixture"

async function touch(root: string, relPath: string, content = "") {
  const full = path.join(root, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)
}

async function setupFakeClangd(base: string) {
  const fakeBinDir = path.join(base, "fake-bin")
  await fs.mkdir(fakeBinDir, { recursive: true })
  const argsFile = path.join(base, "clangd-args.txt")
  // Simple POSIX-safe script: write one arg per line
  await fs.writeFile(
    path.join(fakeBinDir, "clangd"),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsFile}"\nexit 0\n`,
  )
  await fs.chmod(path.join(fakeBinDir, "clangd"), 0o755)
  return { fakeBinDir, argsFile }
}

async function waitForArgs(argsFile: string, timeoutMs = 2000): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const content = await fs.readFile(argsFile, "utf-8")
      return content.split("\n").filter(Boolean)
    } catch {
      // File not ready yet
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return []
}

function setPath(binDir: string): () => void {
  const original = process.env["PATH"]
  process.env["PATH"] = binDir + path.delimiter + (original ?? "")
  return () => { process.env["PATH"] = original }
}

const flags = { disableLspDownload: true } as any

describe("clangd compile_commands.json detection", () => {
  // 1. compile_commands.json at root → no extra args
  test("root-level compile_commands.json: no --compile-commands-dir", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "compile_commands.json", "[]")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args).toContain("--background-index")
      expect(args).toContain("--clang-tidy")
      expect(args.find((a) => a.startsWith("--compile-commands-dir"))).toBeUndefined()
    } finally { restore() }
  })

  // 2. compile_flags.txt → skip detection
  test("compile_flags.txt present: skip detection, no --compile-commands-dir", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "compile_flags.txt", "-I/usr/include\n-std=c11")
    await touch(root, "CMakeLists.txt", "") // would trigger warning if not skipped
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args.find((a) => a.startsWith("--compile-commands-dir"))).toBeUndefined()
    } finally { restore() }
  })

  // 3. .clangd config → skip detection
  test(".clangd config present: skip detection", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, ".clangd", "CompileCommands: build")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args.find((a) => a.startsWith("--compile-commands-dir"))).toBeUndefined()
    } finally { restore() }
  })

  // 4. compile_commands.json in build/ → auto --compile-commands-dir=build
  test("build/compile_commands.json: pass --compile-commands-dir=build", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "CMakeLists.txt", "")
    await touch(root, "build/compile_commands.json", "[]")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args).toContain("--compile-commands-dir=build")
    } finally { restore() }
  })

  // 5. compile_commands.json in cmake-build-debug/ → auto-detect
  test("cmake-build-debug/compile_commands.json: pass --compile-commands-dir", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "CMakeLists.txt", "")
    await touch(root, "cmake-build-debug/compile_commands.json", "[]")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args).toContain("--compile-commands-dir=cmake-build-debug")
    } finally { restore() }
  })

  // 6. Linux kernel (Kbuild + Makefile) → no crash, no --compile-commands-dir
  test("kernel project (Kbuild + Makefile): spawn succeeds without error", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "Kbuild", "")
    await touch(root, "Makefile", "VERSION = 6")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args.find((a) => a.startsWith("--compile-commands-dir"))).toBeUndefined()
    } finally { restore() }
  })

  // 7. Bare project → no crash
  test("bare project: spawn succeeds, no --compile-commands-dir", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir, argsFile } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "main.c", "int main() { return 0; }")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
      const args = await waitForArgs(argsFile)
      expect(args.find((a) => a.startsWith("--compile-commands-dir"))).toBeUndefined()
    } finally { restore() }
  })

  // 8. Zephyr RTOS → highest priority, no crash
  test("Zephyr project (west.yml + CMakeLists.txt): spawn succeeds", async () => {
    await using tmp = await tmpdir()
    const { fakeBinDir } = await setupFakeClangd(tmp.path)
    const root = path.join(tmp.path, "project")
    await touch(root, "west.yml", "manifest:\n  projects: []")
    await touch(root, "CMakeLists.txt", "")
    const restore = setPath(fakeBinDir)
    try {
      const handle = await LSPServer.Clangd.spawn(root, {} as any, flags)
      expect(handle).toBeDefined()
    } finally { restore() }
  })
})
