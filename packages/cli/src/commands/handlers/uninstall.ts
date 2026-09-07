import { confirm, intro, log, outro, spinner } from "@clack/prompts"
import { Service } from "@opencode-ai/client/effect/service"
import { Global } from "@opencode-ai/util/global"
import { Effect, FileSystem } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Installation } from "../../services/installation"
import { ServerConnection } from "../../services/server-connection"
import { ServiceConfig } from "../../services/service-config"
import { handlePromptErrors, prompt, requireInteractive } from "../../ui/prompt"

export default Runtime.handler(
  Commands.commands.uninstall,
  Effect.fn("cli.uninstall")(function* (input) {
    intro("Uninstall OpenCode")
    const fs = yield* FileSystem.FileSystem
    const global = yield* Global.Service
    const installation = yield* Installation.make()
    const method = yield* installation.method()
    log.info(`Installation method: ${method ?? "unknown"}`)
    if (!method && !input.dryRun)
      return yield* Effect.fail(
        new Error(
          "Could not detect the installation method. Uninstall OpenCode with your package manager or remove its binary manually.",
        ),
      )
    const removal =
      method && method !== "curl" && installation.installedPackage
        ? { method, command: Installation.uninstallCommand(method, installation.installedPackage) }
        : undefined
    const directories = [
      { path: global.data, label: "Data", keep: input.keepData },
      { path: global.cache, label: "Cache", keep: false },
      { path: global.config, label: "Config", keep: input.keepConfig },
      { path: global.state, label: "State", keep: false },
    ]
    const shell = method === "curl" ? yield* installation.shellChanges() : []

    log.message("Uninstall plan:")
    log.info("Stop the local background service")
    yield* Effect.forEach(
      directories,
      (directory) =>
        fs
          .exists(directory.path)
          .pipe(
            Effect.flatMap((exists) =>
              exists
                ? Effect.sync(() =>
                    log.info(`${directory.keep ? "Keep" : "Remove"} ${directory.label}: ${directory.path}`),
                  )
                : Effect.void,
            ),
          ),
      { discard: true },
    )
    shell.forEach((change) => log.info(`Remove installer PATH entry: ${change.path}`))
    if (removal) log.info(`Package: ${removal.command.join(" ")}`)
    if (method === "curl") log.info(`Binary (manual removal): ${process.execPath}`)
    if (input.dryRun) {
      outro("Dry run - no changes made")
      return undefined
    }
    if (!input.force) {
      yield* requireInteractive("Pass --force to uninstall without an interactive terminal, or --dry-run to preview.")
      if (!(yield* prompt(() => confirm({ message: "Are you sure you want to uninstall?", initialValue: false })))) {
        outro("Cancelled")
        return undefined
      }
    }

    const progress = spinner()
    yield* Effect.gen(function* () {
      progress.start("Stopping background service...")
      const options = yield* ServiceConfig.options()
      yield* ServerConnection.shutdownPersistentPty(options).pipe(Effect.ignore)
      yield* Service.stop(options)
      progress.stop("Background service stopped")

      if (removal) {
        progress.start(`Running ${removal.command.join(" ")}...`)
        yield* installation.uninstall(removal.method)
        progress.stop("Package removed")
      }
      yield* Effect.forEach(
        shell,
        (change) =>
          Effect.gen(function* () {
            progress.start(`Cleaning ${change.path}...`)
            yield* fs.writeFileString(change.path, change.content)
            progress.stop(`Cleaned ${change.path}`)
          }),
        { discard: true },
      )
      yield* Effect.forEach(
        directories.filter((directory) => !directory.keep),
        (directory) =>
          Effect.gen(function* () {
            progress.start(`Removing ${directory.label}...`)
            yield* fs.remove(directory.path, { recursive: true, force: true })
            progress.stop(`Removed ${directory.label}`)
          }),
        { discard: true },
      )
    }).pipe(Effect.tapCause(() => Effect.sync(() => progress.stop("Uninstall failed", 1))))

    if (method === "curl") {
      log.message("To finish removing the binary, run:")
      log.info(Installation.binaryRemovalCommand())
    }
    outro("Done")
    return undefined
  }, handlePromptErrors),
)
