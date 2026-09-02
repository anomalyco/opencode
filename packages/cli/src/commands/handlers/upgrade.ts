import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Updater } from "../../services/updater"
import { handlePromptErrors } from "../../ui/prompt"
import { OPENCODE_VERSION } from "../../version"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(function* (input) {
    intro("Upgrade")
    const updater = yield* Updater.Service
    const method = Option.getOrUndefined(input.method) ?? (yield* updater.method())
    if (!method)
      return yield* Effect.fail(
        new Error("Could not detect the installation method. Pass --method to choose how to upgrade OpenCode."),
      )

    log.info(`Using method: ${method}`)
    const target = yield* updater.latest()
    const version = (Option.getOrUndefined(input.target) ?? target.version).trim().replace(/^v/, "")
    if (version === OPENCODE_VERSION && (target.package === updater.package || method === "curl")) {
      log.warn(`OpenCode upgrade skipped: ${version} is already installed`)
      outro("Done")
      return
    }

    log.info(`From ${OPENCODE_VERSION} → ${version}`)
    if (updater.package && target.package !== updater.package && method !== "curl") {
      log.info(`Package: ${updater.package} → ${target.package}`)
    }
    const progress = spinner()
    progress.start("Upgrading...")
    yield* updater.upgrade(method, { ...target, version }).pipe(
      Effect.tap(() => Effect.sync(() => progress.stop("Upgrade complete"))),
      Effect.tapCause(() => Effect.sync(() => progress.stop("Upgrade failed", 1))),
    )
    outro("Done")
  }, handlePromptErrors),
)
