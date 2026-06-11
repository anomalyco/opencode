import { Effect } from "effect"
import { Effect as _Effect } from "effect"
import type { ChildProcessWithoutNullStreams } from "child_process"
import path from "path"
import os from "os"
import { Global } from "@opencode-ai/core/global"
import { text } from "node:stream/consumers"
import fs from "fs/promises"
import { Filesystem } from "@/util/filesystem"
import type { InstanceContext } from "../project/instance-context"
import { Archive } from "@/util/archive"
import { Process } from "@/util/process"
import { which } from "@opencode-ai/core/util/which"
import { Module } from "@opencode-ai/core/util/module"
import { spawn } from "./launch"
import { Npm } from "@opencode-ai/core/npm"
import type { RuntimeFlags } from "@/effect/runtime-flags"

const pathExists = async (p: string) =>
  fs
    .stat(p)
    .then(() => true)
    .catch(() => false)
const run = (cmd: string[], opts: Process.RunOptions = {}) => Process.run(cmd, { ...opts, nothrow: true })
const output = (cmd: string[], opts: Process.RunOptions = {}) => Process.text(cmd, { ...opts, nothrow: true })

export interface Handle {
  process: ChildProcessWithoutNullStreams
  initialization?: Record<string, any>
}

type RootFunction = (file: string, ctx: InstanceContext) => Promise<string | undefined>

const NearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file, ctx) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: ctx.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: ctx.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return ctx.directory
    return path.dirname(first.value)
  }
}

const StrictNearestRoot = (includePatterns: string[], excludePatterns?: string[]): RootFunction => {
  return async (file, ctx) => {
    if (excludePatterns) {
      const excludedFiles = Filesystem.up({
        targets: excludePatterns,
        start: path.dirname(file),
        stop: ctx.directory,
      })
      const excluded = await excludedFiles.next()
      await excludedFiles.return()
      if (excluded.value) return undefined
    }
    const files = Filesystem.up({
      targets: includePatterns,
      start: path.dirname(file),
      stop: ctx.directory,
    })
    const first = await files.next()
    await files.return()
    if (!first.value) return undefined
    return path.dirname(first.value)
  }
}

export interface Info {
  id: string
  extensions: string[]
  global?: boolean
  root: RootFunction
  spawn(root: string, ctx: InstanceContext, flags: RuntimeFlags.Info): Promise<Handle | undefined>
}

/* … many servers omitted for brevity … */

export const Gopls: Info = {
  id: "gopls",
  root: async (file, ctx) => {
    const work = await NearestRoot(["go.work"])(file, ctx)
    if (work) return work
    return NearestRoot(["go.mod", "go.sum"])(file, ctx)
  },
  extensions: [".go"],
  async spawn(root, _ctx, flags) {
    let bin = which("gopls")
    if (!bin) {
      if (!which("go")) {
        throw new Error("Go runtime not found. Please install Go first; gopls will then be installed automatically.")
      }
      if (flags.disableLspDownload) return

      const proc = Process.spawn(["go", "install", "golang.org/x/tools/gopls@latest"], {
        env: { ...process.env, GOBIN: Global.Path.bin },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "pipe",
      })
      const exit = await proc.exited
      if (exit !== 0) {
        throw new Error("Failed to install gopls via 'go install'. Please install gopls manually.")
      }
      bin = path.join(Global.Path.bin, "gopls" + (process.platform === "win32" ? ".exe" : ""))
    }
    return {
      process: spawn(bin!, {
        cwd: root,
      }),
    }
  },
}

/* … remainder unchanged … */
