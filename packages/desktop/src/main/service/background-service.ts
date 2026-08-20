import { Service } from "@opencode-ai/client/service"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { app } from "electron"
import { Effect, FileSystem, Path } from "effect"
import { parseCliVersion } from "./cli-version"
import { DesktopPaths } from "../paths"

const execFileAsync = promisify(execFile)

export const startBackgroundCli = Effect.fn("BackgroundService.start")(function* () {
  return yield* start().pipe(Effect.orDie)
})

const start = Effect.fn("BackgroundService.startInternal")(function* () {
  const path = yield* Path.Path
  const context = yield* Effect.context()
  const runFork = Effect.runForkWith(context)
  const isolated = !app.isPackaged && process.env.OPENCODE_DESKTOP_ISOLATED_SERVER === "1"
  const development = !app.isPackaged && process.env.OPENCODE_DESKTOP_CLI_DEV
  const developmentVersion = process.env.OPENCODE_VERSION ?? "local"
  const cli = development
    ? {
        version: developmentVersion,
        command: [
          "bun",
          "run",
          "--cwd",
          development,
          `--define=OPENCODE_VERSION=${JSON.stringify(developmentVersion)}`,
          "src/index.ts",
        ],
        binary: undefined,
      }
    : yield* resolveBundledCli(isolated)
  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const service = yield* Effect.tryPromise(() =>
    Service.ensure({
      file:
        isolated && process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
          ? path.join(app.getPath("userData"), "opencode", "service-local.json")
          : undefined,
      version: cli.version,
      command: [...cli.command, "serve", "--service", ...(isolated ? ["--port", "0"] : [])],
      onStart: (reason, previousVersion) =>
        runFork(Effect.logInfo("v2 CLI background service starting", { reason, previousVersion })),
    }),
  )
  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  const url = new URL(service.url)
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1"
  yield* Effect.logInfo("v2 CLI background service ready", {
    username: service.auth.username,
    version: cli.version,
    ...endpoint(url.origin),
  })
  if (isolated && cli.binary) yield* cleanCliStages(cli.binary)
  return {
    url: url.origin,
    username: service.auth.username,
    password: service.auth.password,
    version: cli.version,
    wslBuild:
      app.isPackaged || !process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD || !process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT
        ? undefined
        : {
            script: process.env.OPENCODE_DESKTOP_WSL_CLI_BUILD,
            output: process.env.OPENCODE_DESKTOP_WSL_CLI_OUTPUT,
          },
  }
})

const resolveBundledCli = Effect.fn("BackgroundService.resolveBundledCli")(function* (isolated: boolean) {
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

const cleanCliStages = Effect.fn("BackgroundService.cleanCliStages")(function* (binary: string) {
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
      yield* fs.remove(target, { recursive: true, force: true }).pipe(
        Effect.catch((error) => Effect.logError("failed to clean staged v2 CLI", { path: target, error })),
      )
    }),
    { concurrency: "unbounded" },
  )
})

const installCli = Effect.fn("BackgroundService.installCli")(function* (source: string, version: string) {
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

const run = Effect.fn("BackgroundService.run")(function* (binary: string, args: string[]) {
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

function endpoint(url: string | undefined) {
  if (!url || !URL.canParse(url)) return {}
  const parsed = new URL(url)
  return { url, hostname: parsed.hostname, port: parsed.port }
}

function executableName() {
  return process.platform === "win32" ? "opencode-cli.exe" : "opencode-cli"
}

function developmentExecutableName() {
  return process.platform === "win32" ? "opencode-cli-dev.exe" : "opencode-cli-dev"
}
