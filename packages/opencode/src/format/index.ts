import { App } from "../app/app"
import { BunProc } from "../bun"
import { Bus } from "../bus"
import { File } from "../file"
import { Log } from "../util/log"
import path from "path"

export namespace Format {
  const log = Log.create({ service: "format" })

  const state = App.state("format", () => {
    const enabled: Record<string, boolean> = {}

    return {
      enabled,
    }
  })

  async function isEnabled(item: Definition) {
    const s = state()
    let status = s.enabled[item.name]
    if (status === undefined) {
      status = await item.enabled()
      s.enabled[item.name] = status
    }
    return status
  }

  async function getFormatter(ext: string) {
    const result = []
    for (const item of FORMATTERS) {
      if (!item.extensions.includes(ext)) continue
      if (!isEnabled(item)) continue
      result.push(item)
    }
    return result
  }

  export function init() {
    log.info("init")
    Bus.subscribe(File.Event.Edited, async (payload) => {
      const file = payload.properties.file
      log.info("formatting", { file })
      const ext = path.extname(file)

      for (const item of await getFormatter(ext)) {
        log.info("running", { command: item.command })
        const proc = Bun.spawn({
          cmd: item.command.map((x) => x.replace("$FILE", file)),
          cwd: App.info().path.cwd,
          env: item.environment,
          stdout: "ignore",
          stderr: "ignore",
        })
        const exit = await proc.exited
        if (exit !== 0)
          log.error("failed", {
            command: item.command,
            ...item.environment,
          })
      }
    })
  }

  interface Definition {
    name: string
    command: string[]
    environment?: Record<string, string>
    extensions: string[]
    enabled(): Promise<boolean>
  }

  const FORMATTERS: Definition[] = [
    {
      name: "prettier",
      command: [BunProc.which(), "run", "prettier", "--write", "$FILE"],
      environment: {
        BUN_BE_BUN: "1",
      },
      extensions: [
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".ts",
        ".tsx",
        ".mts",
        ".cts",
        ".html",
        ".htm",
        ".css",
        ".scss",
        ".sass",
        ".less",
        ".vue",
        ".svelte",
        ".json",
        ".jsonc",
        ".yaml",
        ".yml",
        ".toml",
        ".xml",
        ".md",
        ".mdx",
        ".graphql",
        ".gql",
      ],
      async enabled() {
        try {
          const proc = Bun.spawn({
            cmd: [BunProc.which(), "run", "prettier", "--version"],
            cwd: App.info().path.cwd,
            env: {
              BUN_BE_BUN: "1",
            },
            stdout: "ignore",
            stderr: "ignore",
          })
          const exit = await proc.exited
          return exit === 0
        } catch {
          return false
        }
      },
    },
    {
      name: "mix",
      command: ["mix", "format", "$FILE"],
      extensions: [".ex", ".exs", ".eex", ".heex", ".leex", ".neex", ".sface"],
      async enabled() {
        try {
          const proc = Bun.spawn({
            cmd: ["mix", "--version"],
            cwd: App.info().path.cwd,
            stdout: "ignore",
            stderr: "ignore",
          })
          const exit = await proc.exited
          return exit === 0
        } catch {
          return false
        }
      },
    },
    {
      name: "gofmt",
      command: ["gofmt", "-w", "$FILE"],
      extensions: [".go"],
      async enabled() {
        try {
          const proc = Bun.spawn({
            cmd: ["gofmt", "-h"],
            cwd: App.info().path.cwd,
            stdout: "ignore",
            stderr: "ignore",
          })
          const exit = await proc.exited
          return exit === 0
        } catch {
          return false
        }
      },
    },
  ]
}
