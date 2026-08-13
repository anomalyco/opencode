import { Service } from "@opencode-ai/client/service"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, copyFile, mkdir, readdir, rename, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { app } from "electron"
import { parseCliVersion } from "./cli-version"

const execFileAsync = promisify(execFile)
const root = dirname(fileURLToPath(import.meta.url))

type Logger = {
  log(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
}

export async function startBackgroundCli(logger: Logger) {
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
    : await resolveBundledCli(isolated, logger)
  if (isolated) process.env.XDG_STATE_HOME = app.getPath("userData")
  const service = await Service.ensure({
    file:
      isolated && process.env.OPENCODE_DESKTOP_SERVER_CHANNEL === "local"
        ? join(app.getPath("userData"), "opencode", "service-local.json")
        : undefined,
    version: cli.version,
    command: [...cli.command, "serve", "--service"],
    onStart: (reason, previousVersion) => logger.log("v2 CLI background service starting", { reason, previousVersion }),
  })
  if (service.auth?.type !== "basic") throw new Error("V2 CLI background service did not provide authentication")
  logger.log("v2 CLI background service ready", {
    username: service.auth.username,
    version: cli.version,
    ...endpoint(service.url),
  })
  if (isolated && cli.binary) await cleanCliStages(cli.binary, logger)
  return {
    url: service.url,
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
}

async function resolveBundledCli(isolated: boolean, logger: Logger) {
  const bundled = app.isPackaged
    ? join(process.resourcesPath, executableName())
    : join(root, "../../resources", isolated ? developmentExecutableName() : executableName())
  logger.log("v2 CLI executable resolved", { bundled, packaged: app.isPackaged })
  const version = parseCliVersion(await run(bundled, ["--version"], logger))
  const binary = app.isPackaged || isolated ? await installCli(bundled, version, logger) : bundled
  return { version, binary, command: [binary] }
}

async function cleanCliStages(binary: string, logger: Logger) {
  const current = dirname(binary)
  const root = dirname(current)
  await Promise.all(
    (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && join(root, entry.name) !== current)
      .map((entry) =>
        rm(join(root, entry.name), { recursive: true, force: true }).catch((error) =>
          logger.error("failed to clean staged v2 CLI", { path: join(root, entry.name), error }),
        ),
      ),
  )
}

async function installCli(source: string, version: string, logger: Logger) {
  const directory = join(app.getPath("userData"), "cli", version.replace(/[^a-zA-Z0-9._-]/g, "-"))
  const destination = join(directory, executableName())
  if (existsSync(destination)) {
    logger.log("v2 CLI staged executable reused", { path: destination, version })
    return destination
  }

  const temp = destination + `.${process.pid}.tmp`
  await mkdir(directory, { recursive: true })
  await copyFile(source, temp)
  if (process.platform !== "win32") await chmod(temp, 0o755)
  await rename(temp, destination).catch(async (error) => {
    await rm(temp, { force: true })
    throw error
  })
  logger.log("v2 CLI executable staged", { source, path: destination, version })
  return destination
}

async function run(binary: string, args: string[], logger: Logger) {
  logger.log("v2 CLI command started", { binary, args })
  return execFileAsync(binary, args, { windowsHide: true }).then(
    (result) => {
      const stdout = result.stdout.trim()
      const stderr = result.stderr.trim()
      logger.log("v2 CLI command completed", { args, stdout, stderr })
      return stdout
    },
    (error: unknown) => {
      const output = error as { stdout?: string; stderr?: string }
      logger.error("v2 CLI command failed", {
        args,
        error: error instanceof Error ? error.message : String(error),
        stdout: output.stdout?.trim() ?? "",
        stderr: output.stderr?.trim() ?? "",
      })
      throw error
    },
  )
}

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
