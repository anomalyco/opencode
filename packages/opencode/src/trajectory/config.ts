import fs from "fs"
import path from "path"
import { parse } from "jsonc-parser"
import { Instance } from "../project/instance"

export namespace TrajectoryConfig {
  export interface Options {
    enabled: boolean
    outputPath: string
    filenameTemplate: string
    bufferSize: number
    flushStrategy: "immediate" | "end_of_stream" | "buffered"
    captureStreamEvents: boolean
  }

  const DEFAULTS: Options = {
    enabled: true,
    outputPath: ".opencode/trajectories",
    filenameTemplate: "trajectory_{sessionID}_{timestamp}.jsonl",
    bufferSize: 1000,
    flushStrategy: "end_of_stream",
    captureStreamEvents: true,
  }

  const configs = new Map<
    string,
    {
      options: Options
      loaded: boolean
    }
  >()

  export function get(): Options {
    const base = directory()
    const data = state(base)
    if (!data.loaded) {
      const fromDisk = load(base, worktree(base))
      data.options = { ...data.options, ...fromDisk }
      data.loaded = true
    }
    return data.options
  }

  export function set(options: Partial<Options>): void {
    const data = state(directory())
    data.options = { ...data.options, ...options }
    data.loaded = true
  }

  export function resolveFilename(
    sessionID: string,
    context: {
      agent: string
      model: string
      timestamp: number
    },
  ): string {
    const safeModel = context.model.replace(/[\\/]/g, "-")
    const template = get().filenameTemplate
    return template
      .replaceAll("{sessionID}", sessionID)
      .replaceAll("{agent}", context.agent)
      .replaceAll("{model}", safeModel)
      .replaceAll("{timestamp}", String(context.timestamp))
  }

  function load(base: string, root: string): Partial<Options> {
    const found: Partial<Options> = {}
    const roots = new Set<string>([
      base,
      root,
      path.join(base, ".opencode"),
      path.join(root, ".opencode"),
    ])

    for (const dir of roots) {
      if (!dir) continue
      const targets = ["opencode.jsonc", "opencode.json"]
      for (const file of targets) {
        const full = path.join(dir, file)
        Object.assign(found, read(full))
      }
    }

    return found
  }

  function read(filePath: string): Partial<Options> {
    const exists = fs.existsSync(filePath)
    if (!exists) return {}
    const text = fs.readFileSync(filePath, "utf-8")
    const parsed = parse(text) as { trajectory?: Partial<Options> } | undefined
    if (!parsed || !parsed.trajectory) return {}
    const cfg = parsed.trajectory
    const next: Partial<Options> = {}
    if (cfg.enabled !== undefined) next.enabled = cfg.enabled
    if (cfg.outputPath) next.outputPath = cfg.outputPath
    if (cfg.filenameTemplate) next.filenameTemplate = cfg.filenameTemplate
    if (cfg.bufferSize !== undefined) next.bufferSize = cfg.bufferSize
    if (cfg.flushStrategy) next.flushStrategy = cfg.flushStrategy
    if (cfg.captureStreamEvents !== undefined) next.captureStreamEvents = cfg.captureStreamEvents
    return next
  }

  function state(base: string) {
    const existing = configs.get(base)
    if (existing) return existing
    const fresh = {
      options: { ...DEFAULTS },
      loaded: false,
    }
    configs.set(base, fresh)
    return fresh
  }

  function directory() {
    try {
      return Instance.directory
    } catch {
      return process.cwd()
    }
  }

  function worktree(base: string) {
    try {
      return Instance.worktree
    } catch {
      return base
    }
  }
}
