import { describe, expect, spyOn, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import * as Lsp from "../../src/lsp/index"
import { LSPServer } from "../../src/lsp/server"
import { Instance } from "../../src/project/instance"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"

async function cmd(dir: string, name: string, body: string) {
  const ext = process.platform === "win32" ? ".cmd" : ""
  const file = path.join(dir, name + ext)
  await fs.writeFile(file, process.platform === "win32" ? body : `#!/bin/sh\n${body}`)
  if (process.platform !== "win32") await fs.chmod(file, 0o755)
  return file
}

describe("lsp.spawn", () => {
  test("does not spawn builtin LSP for files outside instance", async () => {
    await using tmp = await tmpdir()
    const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.touchFile(path.join(tmp.path, "..", "outside.ts"))
          await Lsp.LSP.hover({
            file: path.join(tmp.path, "..", "hover.ts"),
            line: 0,
            character: 0,
          })
        },
      })

      expect(spy).toHaveBeenCalledTimes(0)
    } finally {
      spy.mockRestore()
      await Instance.disposeAll()
    }
  })

  test("would spawn builtin LSP for files inside instance", async () => {
    await using tmp = await tmpdir()
    const spy = spyOn(LSPServer.Typescript, "spawn").mockResolvedValue(undefined)

    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await Lsp.LSP.hover({
            file: path.join(tmp.path, "src", "inside.ts"),
            line: 0,
            character: 0,
          })
        },
      })

      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
      await Instance.disposeAll()
    }
  })

  test("uses bundle exec for ruby-lsp in Bundler projects", async () => {
    await using tmp = await tmpdir()
    const dir = path.join(tmp.path, "bin")
    await fs.mkdir(dir)
    const body =
      process.platform === "win32"
        ? '@echo off\r\nif "%~1"=="exec" if "%~2"=="rubocop" if "%~3"=="--version" exit /b 0\r\nif "%~1"=="exec" if "%~2"=="rubocop" if "%~3"=="--lsp" powershell -NoProfile -Command "Start-Sleep -Seconds 30"\r\nexit /b 1\r\n'
        : 'if [ "$1" = "exec" ] && [ "$2" = "rubocop" ] && [ "$3" = "--version" ]; then\n  exit 0\nfi\nif [ "$1" = "exec" ] && [ "$2" = "rubocop" ] && [ "$3" = "--lsp" ]; then\n  while :; do sleep 1; done\nfi\nexit 1\n'
    const bundle = await cmd(dir, "bundle", body)
    const prev = process.env.PATH
    process.env.PATH = [dir, prev].filter(Boolean).join(path.delimiter)
    await Bun.write(path.join(tmp.path, "Gemfile"), 'source "https://rubygems.org"\n')

    let handle: Awaited<ReturnType<typeof LSPServer.Rubocop.spawn>> | undefined
    try {
      handle = await Instance.provide({
        directory: tmp.path,
        fn: () => LSPServer.Rubocop.spawn(tmp.path),
      })
      expect(handle).toBeDefined()
      expect(handle!.process.spawnfile).toBe(bundle)
      expect(handle!.process.spawnargs.slice(1)).toEqual(["exec", "rubocop", "--lsp"])
    } finally {
      if (handle?.process) await Process.stop(handle.process)
      process.env.PATH = prev
      await Instance.disposeAll()
    }
  })
})
