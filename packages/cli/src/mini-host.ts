import type { MiniFrontendInput } from "@opencode-ai/tui/mini"
import { createModelPreferenceRepository } from "@opencode-ai/tui/model-preference"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Global } from "@opencode-ai/core/global"
import fs from "node:fs"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { ReadStream } from "node:tty"

export const INTERACTIVE_INPUT_ERROR = "opencode mini requires a controlling terminal for input"

export type InteractiveStdin = {
  stdin: NodeJS.ReadStream
  cleanup(): void
}

type MiniHost = MiniFrontendInput["host"]

function preferences(statePath: string): MiniHost["preferences"] {
  const repository = createModelPreferenceRepository(path.join(statePath, "model.json"))
  return {
    async resolveVariant(model) {
      if (!model) return
      return repository.resolveVariant(model)
    },
    async saveVariant(model, variant) {
      if (!model) return
      await repository.saveVariant(model, variant).catch(() => undefined)
    },
  }
}

function signal(name: "SIGINT" | "SIGUSR2"): MiniHost["signals"]["sigint"] {
  return {
    subscribe(listener) {
      let subscribed = true
      process.on(name, listener)
      return () => {
        if (!subscribed) return
        subscribed = false
        process.off(name, listener)
      }
    },
  }
}

function createTrace(
  logPath: string,
  diagnostics: { pid: number; cwd: string; argv: string[] },
): MiniHost["diagnostics"]["trace"] {
  if (!process.env.OPENCODE_DIRECT_TRACE) return
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")
  const target = path.join(logPath, "direct", `${stamp}-${diagnostics.pid}.jsonl`)
  const text = (data: unknown) =>
    JSON.stringify(data, (_key, value) => (typeof value === "bigint" ? String(value) : value), 0)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(
    path.join(logPath, "direct", "latest.json"),
    text({
      time: new Date().toISOString(),
      ...diagnostics,
      path: target,
    }) + "\n",
  )
  const trace = {
    write(type: string, data?: unknown) {
      fs.appendFileSync(
        target,
        text({
          time: new Date().toISOString(),
          pid: diagnostics.pid,
          type,
          data,
        }) + "\n",
      )
    },
  }
  trace.write("trace.start", {
    argv: diagnostics.argv,
    cwd: diagnostics.cwd,
    path: target,
  })
  return trace
}

function openTerminalStdin(target: string): NodeJS.ReadStream {
  return new ReadStream(fs.openSync(target, "r"))
}

export function resolveInteractiveStdin(
  stdin: NodeJS.ReadStream = process.stdin,
  open: (target: string) => NodeJS.ReadStream = openTerminalStdin,
  platform: NodeJS.Platform = process.platform,
): InteractiveStdin {
  if (stdin.isTTY) return { stdin, cleanup() {} }
  const target = platform === "win32" ? "CONIN$" : "/dev/tty"
  try {
    const source = open(target)
    let cleaned = false
    return {
      stdin: source,
      cleanup() {
        if (cleaned) return
        cleaned = true
        source.destroy()
      },
    }
  } catch (error) {
    throw new Error(INTERACTIVE_INPUT_ERROR, { cause: error })
  }
}

/** @internal Exported for owner-local resource cleanup tests. */
export async function usingInteractiveStdin<T>(
  run: (terminal: InteractiveStdin) => Promise<T>,
  resolve: () => InteractiveStdin = resolveInteractiveStdin,
) {
  const terminal = resolve()
  try {
    return await run(terminal)
  } finally {
    terminal.cleanup()
  }
}

/** @internal Exported for owner-local host capability tests. */
export function createMiniHost(input: {
  terminal: InteractiveStdin
  directory: string
  paths?: { home: string; state: string; log: string }
}): MiniHost {
  const paths = input.paths ?? {
    home: Global.Path.home,
    state: Global.Path.state,
    log: Global.Path.log,
  }
  const diagnostics = {
    pid: process.pid,
    cwd: input.directory,
    argv: process.argv.slice(2),
  }
  return {
    terminal: { stdin: input.terminal.stdin },
    platform: process.platform,
    stdout: {
      write(value) {
        process.stdout.write(value)
      },
    },
    files: {
      readText: (url) => readFile(new URL(url), "utf8"),
    },
    editor: {
      async open(options) {
        const { openEditor } = await import("@opencode-ai/tui/editor")
        return openEditor(options)
      },
    },
    paths: { home: paths.home },
    signals: {
      sigint: signal("SIGINT"),
      sigusr2: signal("SIGUSR2"),
    },
    startup: {
      showTiming: Flag.OPENCODE_SHOW_TTFD,
      now: () => performance.now(),
    },
    diagnostics: {
      trace: createTrace(paths.log, diagnostics),
    },
    preferences: preferences(paths.state),
  }
}
