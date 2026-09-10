import { describe, test, expect, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import * as LSPServer from "@/lsp/server"
import type { InstanceContext } from "@/project/instance-context"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpBase = path.join(os.tmpdir(), "opencode-typescript-root-test")

function makeCtx(directory: string): InstanceContext {
  return { directory, worktree: "/", project: {} as any }
}

async function mkdirp(p: string) {
  await fs.mkdir(p, { recursive: true })
}

async function touch(p: string) {
  await mkdirp(path.dirname(p))
  await fs.writeFile(p, "", "utf-8")
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Typescript.root", () => {
  test("nested tsconfig in workspace with no parent lockfile returns sub-project directory", async () => {
    const workspace = path.join(tmpBase, "nested-tsconfig")
    await mkdirp(workspace)
    const projectDir = path.join(workspace, "frontend")
    await touch(path.join(projectDir, "tsconfig.json"))
    const srcDir = path.join(projectDir, "src", "lib", "services")
    await mkdirp(srcDir)
    await touch(path.join(srcDir, "query.service.ts"))

    const file = path.join(srcDir, "query.service.ts")
    const result = await LSPServer.Typescript.root(file, makeCtx(workspace))
    expect(result).toBe(projectDir)
  })

  test("sibling sub-projects each resolve to their own tsconfig.json directory", async () => {
    const workspace = path.join(tmpBase, "sibling-tsconfigs")
    await mkdirp(workspace)
    for (const name of ["frontend", "backend", "website", "sdk-ts"]) {
      await touch(path.join(workspace, name, "tsconfig.json"))
      const srcDir = path.join(workspace, name, "src")
      await mkdirp(srcDir)
      await touch(path.join(srcDir, "index.ts"))
    }

    const expected = new Map(
      await Promise.all(
        ["frontend", "backend", "website", "sdk-ts"].map(async (name) => [
          name,
          await LSPServer.Typescript.root(
            path.join(workspace, name, "src", "index.ts"),
            makeCtx(workspace),
          ),
        ] as const),
      ),
    )

    expect(expected.get("frontend")).toBe(path.join(workspace, "frontend"))
    expect(expected.get("backend")).toBe(path.join(workspace, "backend"))
    expect(expected.get("website")).toBe(path.join(workspace, "website"))
    expect(expected.get("sdk-ts")).toBe(path.join(workspace, "sdk-ts"))
    expect(new Set(expected.values()).size).toBe(4)
  })

  test("tsconfig co-located with lockfile: tsconfig wins (nearest first)", async () => {
    const workspace = path.join(tmpBase, "tsconfig-with-lockfile")
    await mkdirp(workspace)
    await touch(path.join(workspace, "package-lock.json"))
    const projectDir = path.join(workspace, "app")
    await touch(path.join(projectDir, "tsconfig.json"))
    await touch(path.join(projectDir, "package-lock.json"))
    const srcDir = path.join(projectDir, "src")
    await mkdirp(srcDir)
    await touch(path.join(srcDir, "main.ts"))

    const file = path.join(srcDir, "main.ts")
    const result = await LSPServer.Typescript.root(file, makeCtx(workspace))
    expect(result).toBe(projectDir)
  })

  test("lockfile only, no tsconfig.json: falls back to lockfile directory (backward compat)", async () => {
    const workspace = path.join(tmpBase, "lockfile-only")
    await mkdirp(workspace)
    await touch(path.join(workspace, "package-lock.json"))
    const srcDir = path.join(workspace, "src")
    await mkdirp(srcDir)
    await touch(path.join(srcDir, "index.ts"))

    const file = path.join(srcDir, "index.ts")
    const result = await LSPServer.Typescript.root(file, makeCtx(workspace))
    expect(result).toBe(workspace)
  })

  test("no markers at all: falls back to ctx.directory (backward compat)", async () => {
    const workspace = path.join(tmpBase, "no-markers")
    await mkdirp(workspace)
    const srcDir = path.join(workspace, "src")
    await mkdirp(srcDir)
    await touch(path.join(srcDir, "index.ts"))

    const file = path.join(srcDir, "index.ts")
    const result = await LSPServer.Typescript.root(file, makeCtx(workspace))
    expect(result).toBe(workspace)
  })

  test("deno.json in path: root is undefined (exclusion preserved)", async () => {
    const workspace = path.join(tmpBase, "deno-excluded")
    await mkdirp(workspace)
    const projectDir = path.join(workspace, "deno-app")
    await touch(path.join(projectDir, "deno.json"))
    await touch(path.join(projectDir, "tsconfig.json"))
    const srcDir = path.join(projectDir, "src")
    await mkdirp(srcDir)
    await touch(path.join(srcDir, "main.ts"))

    const file = path.join(srcDir, "main.ts")
    const result = await LSPServer.Typescript.root(file, makeCtx(workspace))
    expect(result).toBeUndefined()
  })

  test("tsconfig wins over a more distant lockfile at the workspace root", async () => {
    const workspace = path.join(tmpBase, "distant-lockfile")
    await mkdirp(workspace)
    await touch(path.join(workspace, "yarn.lock"))
    const projectDir = path.join(workspace, "packages", "core")
    await touch(path.join(projectDir, "tsconfig.json"))
    const srcDir = path.join(projectDir, "src")
    await mkdirp(srcDir)
    await touch(path.join(srcDir, "index.ts"))

    const file = path.join(srcDir, "index.ts")
    const result = await LSPServer.Typescript.root(file, makeCtx(workspace))
    expect(result).toBe(projectDir)
  })
})