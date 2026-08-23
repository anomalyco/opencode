import { describe, test, expect, afterAll } from "bun:test"
import path from "path"
import fs from "fs/promises"
import os from "os"
import * as LSPServer from "@/lsp/server"
import type { InstanceContext } from "@/project/instance-context"

// Regression tests for Filesystem.up's handling of wildcard ("glob") root markers.
//
// Several language servers declare their project root with a glob pattern instead of a
// concrete filename: Haskell's "*.cabal", Terraform's "*.tf", Julia's "*.jl", and Xcode/
// Swift's "*.xcodeproj" / "*.xcworkspace" bundles. Filesystem.up previously probed these
// with a literal exists(join(dir, target)) check, which can never match a wildcard, so the
// server silently fell back to the workspace root. These tests lock in the scan-based fix.

const tmpBase = path.join(os.tmpdir(), "opencode-glob-root")

function makeCtx(directory: string): InstanceContext {
  return { directory, worktree: "/", project: {} as any }
}

async function touch(p: string) {
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, "", "utf-8")
}

async function mkdir(p: string) {
  await fs.mkdir(p, { recursive: true })
}

afterAll(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true }).catch(() => {})
})

describe("glob root markers", () => {
  test("HLS: *.cabal resolves to the cabal package directory, not the workspace root", async () => {
    const root = path.join(tmpBase, "hls")
    const pkg = path.join(root, "packages", "mylib")
    await touch(path.join(pkg, "mylib.cabal"))
    const file = path.join(pkg, "src", "Main.hs")
    await touch(file)

    const result = await LSPServer.HLS.root(file, makeCtx(root))
    expect(result).toBe(pkg)
  })

  test("TerraformLS: *.tf resolves to the module directory", async () => {
    const root = path.join(tmpBase, "tf")
    const mod = path.join(root, "modules", "vpc")
    await touch(path.join(mod, "main.tf"))
    await touch(path.join(root, ".terraform.lock.hcl"))

    const result = await LSPServer.TerraformLS.root(path.join(mod, "main.tf"), makeCtx(root))
    expect(result).toBe(mod)
  })

  test("JuliaLS: *.jl resolves to the directory holding the nearest .jl file", async () => {
    const root = path.join(tmpBase, "julia")
    const pkg = path.join(root, "src")
    const file = path.join(pkg, "Foo.jl")
    await touch(file)

    const result = await LSPServer.JuliaLS.root(file, makeCtx(root))
    expect(result).toBe(pkg)
  })

  test("SourceKit: *.xcodeproj (a directory bundle) resolves to the project directory", async () => {
    const root = path.join(tmpBase, "swift")
    const project = path.join(root, "MyApp")
    await mkdir(path.join(project, "MyApp.xcodeproj"))
    const file = path.join(project, "Sources", "main.swift")
    await touch(file)

    const result = await LSPServer.SourceKit.root(file, makeCtx(root))
    expect(result).toBe(project)
  })

  test("literal (non-glob) markers keep working — no regression", async () => {
    const root = path.join(tmpBase, "literal")
    const pkg = path.join(root, "packages", "other")
    await touch(path.join(pkg, "hie.yaml"))
    const file = path.join(pkg, "src", "Lib.hs")
    await touch(file)

    const result = await LSPServer.HLS.root(file, makeCtx(root))
    expect(result).toBe(pkg)
  })
})
