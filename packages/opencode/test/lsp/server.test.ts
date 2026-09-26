import { describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import fs from "fs/promises"
import path from "path"
import { Npm } from "@opencode-ai/core/npm"
import { ProjectV2 } from "@opencode-ai/core/project"
import { RuntimeFlags } from "@/effect/runtime-flags"
import type { InstanceContext } from "@/project/instance-context"
import * as LSPServer from "@/lsp/server"
import { tmpdir } from "../fixture/fixture"

const createContext = (directory: string): InstanceContext => ({
  directory,
  worktree: directory,
  project: {
    id: ProjectV2.ID.global,
    worktree: directory,
    time: {
      created: 0,
      updated: 0,
    },
    sandboxes: [],
  },
})

const flags = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* RuntimeFlags.Service
    }).pipe(Effect.provide(RuntimeFlags.layer())),
  )

const writeTypescript = async (dir: string) => {
  const tsserver = path.join(dir, "node_modules", "typescript", "lib", "tsserver.js")
  await fs.mkdir(path.dirname(tsserver), { recursive: true })
  await Bun.write(path.join(dir, "package.json"), "{}")
  await Bun.write(path.join(dir, "node_modules", "typescript", "package.json"), '{"name":"typescript"}')
  await Bun.write(tsserver, "")
  return tsserver
}

describe("LSP server definitions", () => {
  test("TypeScript root detects child package configuration", async () => {
    await using tmp = await tmpdir()

    for (const marker of ["package.json", "tsconfig.json", "jsconfig.json"]) {
      const root = path.join(tmp.path, marker)
      await fs.mkdir(path.join(root, "src"), { recursive: true })
      await Bun.write(path.join(root, marker), "{}")

      expect(await LSPServer.Typescript.root(path.join(root, "src", "server.ts"), createContext(tmp.path))).toBe(root)
    }
  })

  test("TypeScript spawn prefers the child root tsserver", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "apps", "api")
    const childTsserver = await writeTypescript(root)
    await writeTypescript(tmp.path)
    const npmWhich = spyOn(Npm, "which").mockResolvedValue(process.execPath)

    try {
      const result = await LSPServer.Typescript.spawn(root, createContext(tmp.path), await flags())

      expect(result?.initialization?.tsserver).toEqual({ path: childTsserver })
      result?.process.kill()
    } finally {
      npmWhich.mockRestore()
    }
  })

  test("TypeScript spawn falls back to the launch directory tsserver", async () => {
    await using tmp = await tmpdir()
    const root = path.join(tmp.path, "workspace", "apps", "api")
    const directory = path.join(tmp.path, "launch")
    await fs.mkdir(root, { recursive: true })
    const launchTsserver = await writeTypescript(directory)
    const npmWhich = spyOn(Npm, "which").mockResolvedValue(process.execPath)

    try {
      const result = await LSPServer.Typescript.spawn(root, createContext(directory), await flags())

      expect(result?.initialization?.tsserver).toEqual({ path: launchTsserver })
      result?.process.kill()
    } finally {
      npmWhich.mockRestore()
    }
  })
})
