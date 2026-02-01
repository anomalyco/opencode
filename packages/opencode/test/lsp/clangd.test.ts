import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import os from "node:os"
import path from "node:path"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { LSPServer } from "../../src/lsp/server"
import { findCompileCommandsDir } from "../../src/lsp/clangd"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"

describe("LSPServer.Clangd", () => {
  let tmpDir: string

  beforeEach(async () => {
    await Log.init({ print: true })
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "opencode-clangd-test-"))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe("root detection", () => {
    test("always returns Instance.directory (clangd finds .clangd automatically)", async () => {
      // Create project structure:
      // tmpDir/
      //   .clangd
      //   src/
      //     main.cpp
      // Note: clangd automatically searches for .clangd, compile_flags.txt
      // in all parent directories of the active file
      await writeFile(path.join(tmpDir, ".clangd"), "")
      await mkdir(path.join(tmpDir, "src"))
      const cppFile = path.join(tmpDir, "src", "main.cpp")
      await writeFile(cppFile, "#include <iostream>")

      const root = await Instance.provide({
        directory: tmpDir,
        fn: () => LSPServer.Clangd.root(cppFile),
      })

      expect(root).toBe(tmpDir)
    })
  })

  describe("extensions", () => {
    test("supports C/C++ file extensions", () => {
      const extensions = LSPServer.Clangd.extensions
      expect(extensions).toContain(".c")
      expect(extensions).toContain(".cpp")
      expect(extensions).toContain(".cc")
      expect(extensions).toContain(".cxx")
      expect(extensions).toContain(".c++")
      expect(extensions).toContain(".h")
      expect(extensions).toContain(".hpp")
      expect(extensions).toContain(".hh")
      expect(extensions).toContain(".hxx")
      expect(extensions).toContain(".h++")
    })
  })

  describe("findCompileCommandsDir", () => {
    test("finds compile_commands.json in CMake build directory (highest priority)", async () => {
      await writeFile(path.join(tmpDir, "CMakeLists.txt"), "cmake_minimum_required(VERSION 3.10)")
      await writeFile(path.join(tmpDir, "compile_commands.json"), "[]")
      const buildDir = path.join(tmpDir, "build")
      await mkdir(buildDir)
      await writeFile(path.join(buildDir, "CMakeCache.txt"), "")
      await writeFile(path.join(buildDir, "compile_commands.json"), "[]")

      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect(result).toBe(buildDir)
    })

    test("finds compile_commands.json in root directory when no CMake build", async () => {
      await writeFile(path.join(tmpDir, "compile_commands.json"), "[]")

      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect(result).toBe(tmpDir)
    })

    test("finds compile_commands.json in first-level subdirectory", async () => {
      const outDir = path.join(tmpDir, "out")
      await mkdir(outDir)
      await writeFile(path.join(outDir, "compile_commands.json"), "[]")

      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect(result).toBe(outDir)
    })

    test("returns undefined when compile_commands.json not found", async () => {
      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect(result).toBeUndefined()
    })

    test("prefers CMake build directory over root directory", async () => {
      await writeFile(path.join(tmpDir, "compile_commands.json"), "[]")
      const buildDir = path.join(tmpDir, "build-debug")
      await mkdir(buildDir)
      await writeFile(path.join(buildDir, "CMakeCache.txt"), "")
      await writeFile(path.join(buildDir, "compile_commands.json"), "[]")

      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect(result).toBe(buildDir)
    })

    test("finds compile_commands.json when multiple CMake build directories exist", async () => {
      const debugDir = path.join(tmpDir, "build-debug")
      const releaseDir = path.join(tmpDir, "build-release")
      await mkdir(debugDir)
      await mkdir(releaseDir)
      await writeFile(path.join(debugDir, "CMakeCache.txt"), "")
      await writeFile(path.join(debugDir, "compile_commands.json"), "[]")
      await writeFile(path.join(releaseDir, "CMakeCache.txt"), "")
      await writeFile(path.join(releaseDir, "compile_commands.json"), "[]")

      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect([debugDir, releaseDir]).toContain(result!)
    })

    test("skips CMake build directories without compile_commands.json", async () => {
      await writeFile(path.join(tmpDir, "compile_commands.json"), "[]")
      const buildDir = path.join(tmpDir, "build")
      await mkdir(buildDir)
      await writeFile(path.join(buildDir, "CMakeCache.txt"), "")

      const result = await Instance.provide({
        directory: tmpDir,
        fn: () => findCompileCommandsDir(tmpDir),
      })

      expect(result).toBe(tmpDir)
    })
  })
})
