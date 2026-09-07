export * as Installation from "./installation"

import { AppProcess } from "@opencode-ai/util/process"
import { Global } from "@opencode-ai/util/global"
import { Duration, Effect, FileSystem, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import path from "node:path"

export const methods = ["curl", "npm", "pnpm", "bun", "yarn"] as const
export type Method = (typeof methods)[number]

export type ShellChange = {
  readonly path: string
  readonly content: string
}

export interface Interface {
  readonly installedPackage: string | undefined
  readonly method: () => Effect.Effect<Method | undefined>
  readonly uninstall: (method: Exclude<Method, "curl">) => Effect.Effect<void, Error>
  readonly shellChanges: () => Effect.Effect<ReadonlyArray<ShellChange>>
}

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    bin: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
)

export const make = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem
  const global = yield* Global.Service
  const appProcess = yield* AppProcess.Service
  const installedPackage = yield* Effect.gen(function* () {
    const executable = yield* fs.realPath(process.execPath)
    const directory = path.dirname(path.dirname(executable))
    const manifest = yield* fs
      .readFileString(path.join(directory, "package.json"))
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Manifest)))
    return Object.values(manifest.bin ?? {}).some((bin) => path.resolve(directory, bin) === executable)
      ? manifest.name
      : undefined
  }).pipe(Effect.orElseSucceed(() => undefined))

  const run = Effect.fnUntraced(
    function* (command: ReadonlyArray<string>, timeout: Duration.Input = "10 seconds") {
      const result = yield* appProcess.run(ChildProcess.make(command[0], command.slice(1)), {
        timeout,
        maxOutputBytes: 100_000,
        maxErrorBytes: 100_000,
      })
      return {
        code: result.exitCode,
        stdout: result.stdout.toString("utf8"),
        stderr: result.stderr.toString("utf8"),
      }
    },
    Effect.catch((error) =>
      Effect.succeed({
        code: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      }),
    ),
  )

  const method = Effect.fn("cli.installation.method")(function* () {
    const binary = path.join(
      global.home,
      ".opencode",
      "bin",
      process.platform === "win32" ? "opencode2.exe" : "opencode2",
    )
    if (path.resolve(process.execPath) === path.resolve(binary)) return "curl"
    if (!installedPackage) return undefined

    const checks: ReadonlyArray<{ method: Method; command: string[] }> = [
      { method: "npm", command: ["npm", "list", "-g", "--depth=0", installedPackage] },
      { method: "pnpm", command: ["pnpm", "list", "-g", "--depth=0", installedPackage] },
      { method: "bun", command: ["bun", "pm", "ls", "-g"] },
      { method: "yarn", command: ["yarn", "global", "list"] },
    ]
    const results = yield* Effect.forEach(
      checks,
      (check) => run(check.command).pipe(Effect.map((result) => ({ check, result }))),
      { concurrency: "unbounded" },
    )
    return results.find((result) => result.result.stdout.includes(installedPackage))?.check.method
  })

  const uninstall = Effect.fn("cli.installation.uninstall")(function* (method: Exclude<Method, "curl">) {
    if (!installedPackage) return yield* Effect.fail(new Error("Could not identify the installed OpenCode package"))
    const result = yield* run(uninstallCommand(method, installedPackage), "5 minutes")
    if (result.code !== 0)
      return yield* Effect.fail(new Error(result.stderr.trim() || `Failed to uninstall with ${method}`))
    return undefined
  })

  const shellChanges = Effect.fn("cli.installation.shell-changes")(function* () {
    const bin = path.join(global.home, ".opencode", "bin")
    const files = yield* fs.readDirectory(bin).pipe(Effect.orElseSucceed(() => []))
    // V1 and other installed binaries still need this shared PATH entry.
    if (files.some((name) => name !== path.basename(process.execPath))) return []
    const shell = path.basename(process.env.SHELL || "bash")
    const entry = shell === "fish" ? `fish_add_path ${bin}` : `export PATH=${bin}:$PATH`
    const changes = yield* Effect.forEach(shellConfigFiles(shell, global.home), (file) =>
      fs.readFileString(file).pipe(
        Effect.flatMap((content) => {
          const updated = removeShellEntry(content, entry)
          return Effect.succeed(updated === undefined ? undefined : { path: file, content: updated })
        }),
        Effect.orElseSucceed(() => undefined),
      ),
    )
    return changes.filter((change) => change !== undefined)
  })

  return { installedPackage, method, uninstall, shellChanges } satisfies Interface
})

export function uninstallCommand(method: Exclude<Method, "curl">, name: string): [string, ...string[]] {
  const commands: Record<Exclude<Method, "curl">, [string, ...string[]]> = {
    npm: ["npm", "uninstall", "--global", name],
    pnpm: ["pnpm", "remove", "--global", name],
    bun: ["bun", "remove", "--global", name],
    yarn: ["yarn", "global", "remove", name],
  }
  return commands[method]
}

export function binaryRemovalCommand(executable = process.execPath) {
  return process.platform === "win32"
    ? `Remove-Item -LiteralPath '${executable.replaceAll("'", "''")}'`
    : `rm -- '${executable.replaceAll("'", "'\\''")}'`
}

function shellConfigFiles(shell: string, home: string) {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config")
  const zsh = process.env.ZDOTDIR || home
  const candidates: Record<string, string[]> = {
    fish: [path.join(home, ".config", "fish", "config.fish")],
    zsh: [
      path.join(zsh, ".zshrc"),
      path.join(zsh, ".zshenv"),
      path.join(xdg, "zsh", ".zshrc"),
      path.join(xdg, "zsh", ".zshenv"),
    ],
    bash: [
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
      path.join(home, ".profile"),
      path.join(xdg, "bash", ".bashrc"),
      path.join(xdg, "bash", ".bash_profile"),
    ],
    ash: [path.join(home, ".ashrc"), path.join(home, ".profile")],
    sh: [path.join(home, ".ashrc"), path.join(home, ".profile")],
  }
  return [...new Set(candidates[shell] ?? [])]
}

function removeShellEntry(content: string, entry: string) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n"
  const lines = content.split(/\r?\n/)
  const marker = lines.findIndex((line, index) => line === "# opencode" && lines[index + 1] === entry)
  if (marker === -1) return undefined
  const start = marker > 0 && lines[marker - 1] === "" ? marker - 1 : marker
  return [...lines.slice(0, start), ...lines.slice(marker + 2)].join(newline)
}
