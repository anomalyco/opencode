export * as DesktopCli from "./desktop-cli"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { app } from "electron"
import { Context, Effect, FileSystem, Layer, Path } from "effect"
import { DesktopPaths } from "../paths"
import { parseCliVersion } from "./cli-version"

const execFileAsync = promisify(execFile)

export interface Resolved {
  readonly version: string
  readonly command: readonly string[]
  readonly binary?: string
  readonly wslBuild?: { readonly script: string; readonly output: string }
}

export interface Interface {
  readonly resolve: Effect.Effect<Resolved>
}

export class Service extends Context.Service<Service, Interface>()("opencode/desktop/DesktopCli") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resolve = yield* Effect.cached(
      make().pipe(Effect.provide(yield* Effect.context<FileSystem.FileSystem | Path.Path>()), Effect.orDie),
    )
    return Service.of({ resolve })
  }),
)

const make = Effect.fn("DesktopCli.resolve")(function* () {
  const development = !app.isPackaged && process.env.OPENCODE_DESKTOP_CLI_DEV
  const version = process.env.OPENCODE_VERSION ?? "local"
  const cli = development
    ? {
        version,
        command: [
          "bun",
          "run",
          "--cwd",
          development,
          `--define=OPENCODE_VERSION=${JSON.stringify(version)}`,
          "src/index.ts",
        ],
        binary: undefined,
      }
    : yield* resolveBundledCli(!app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1")
  return {
    ...cli,
    wslBuild:
      app.isPackaged || !process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD || !process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT
        ? undefined
        : {
            script: process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD,
            output: process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT,
          },
  } satisfies Resolved
})

const resolveBundledCli = Effect.fn("DesktopCli.resolveBundled")(function* (isolated: boolean) {
  const path = yield* Path.Path
  const paths = yield* DesktopPaths.resolve
  const bundled = app.isPackaged
    ? path.join(process.resourcesPath, executableName())
    : path.join(paths.developmentResourcesRoot, isolated ? developmentExecutableName() : executableName())
  yield* Effect.logInfo("v2 CLI executable resolved", { bundled, packaged: app.isPackaged })
  const version = parseCliVersion(yield* run(bundled, ["--version"]))
  const binary = app.isPackaged || isolated ? yield* installCli(bundled, version) : bundled
  return { version, binary, command: [binary] }
})

export const cleanStages = Effect.fn("DesktopCli.cleanStages")(function* (binary: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const current = path.dirname(binary)
  const root = path.dirname(current)
  const entries = yield* fs.readDirectory(root)
  yield* Effect.forEach(
    entries,
    Effect.fnUntraced(function* (entry) {
      const target = path.join(root, entry)
      if (target === current) return
      const stat = yield* fs.stat(target).pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (stat?.type !== "Directory") return
      yield* fs
        .remove(target, { recursive: true, force: true })
        .pipe(Effect.catch((error) => Effect.logError("failed to clean staged v2 CLI", { path: target, error })))
    }),
    { concurrency: "unbounded" },
  )
})

const installCli = Effect.fn("DesktopCli.install")(function* (source: string, version: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = path.join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = path.join(directory, executableName())
  if (yield* fs.exists(destination)) {
    yield* Effect.logInfo("v2 CLI staged executable reused", { path: destination, version })
    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  yield* fs.makeDirectory(directory, { recursive: true })
  yield* fs.copyFile(source, temp)
  if (process.platform !== "win32") yield* fs.chmod(temp, 0o755)
  yield* fs
    .rename(temp, destination)
    .pipe(Effect.catch((error) => fs.remove(temp, { force: true }).pipe(Effect.andThen(Effect.fail(error)))))
  yield* Effect.logInfo("v2 CLI executable staged", { source, path: destination, version })
  return destination
})

const run = Effect.fn("DesktopCli.run")(function* (binary: string, args: string[]) {
  yield* Effect.logInfo("v2 CLI command started", { binary, args })
  const result = yield* Effect.tryPromise(() => execFileAsync(binary, args, { windowsHide: true })).pipe(
    Effect.tapError((error) => {
      const output = error as { stdout?: string; stderr?: string }
      return Effect.logError("v2 CLI command failed", {
        args,
        error: error instanceof Error ? error.message : String(error),
        stdout: output.stdout?.trim() ?? "",
        stderr: output.stderr?.trim() ?? "",
      })
    }),
  )
  const stdout = result.stdout.trim()
  const stderr = result.stderr.trim()
  yield* Effect.logInfo("v2 CLI command completed", { args, stdout, stderr })
  return stdout
})

function executableName() {
  return process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"
}

function developmentExecutableName() {
  return process.platform === "win32" ? "opencode-cli-dev.exe" : "opencode-cli-dev"
}
