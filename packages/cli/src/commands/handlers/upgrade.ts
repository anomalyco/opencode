import { intro, log, outro, spinner } from "@clack/prompts"
import { Effect, Option } from "effect"
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"
import { Updater } from "../../services/updater"
import { handlePromptErrors } from "../../ui/prompt"
import { OPENCODE_VERSION } from "../../version"
import { stripVTControlCharacters } from "node:util"

export default Runtime.handler(
  Commands.commands.upgrade,
  Effect.fn("cli.upgrade")(
    function* (input) {
      intro("Upgrade")
      const updater = yield* Updater.Service
      const method = Option.getOrUndefined(input.method) ?? (yield* updater.method())
      if (!method)
        return yield* Effect.fail(
          new Error("Could not detect the installation method. Pass --method to choose how to upgrade OpenCode."),
        )

      log.info(`Using method: ${method}`)
      const target = Option.getOrUndefined(input.target) ?? (yield* updater.latest())
      const version = target.trim().replace(/^v/, "")
      if (version === OPENCODE_VERSION) {
        log.warn(`OpenCode upgrade skipped: ${version} is already installed`)
        outro("Done")
        return
      }

      log.info(`From ${OPENCODE_VERSION} → ${version}`)
      const progress = spinner()
      progress.start("Upgrading...")
      yield* updater.upgrade(method, target).pipe(
        Effect.tap(() => Effect.sync(() => progress.stop("Upgrade complete"))),
        Effect.tapCause(() => Effect.sync(() => progress.stop("Upgrade failed", 1))),
      )
      outro("Done")
    },
    (effect) =>
      handlePromptErrors(
        effect.pipe(
          Effect.mapError((error) =>
            error instanceof Updater.UpgradeError ? new Error(formatUpgradeError(error), { cause: error }) : error,
          ),
        ),
      ),
  ),
)

function formatUpgradeError(error: Updater.UpgradeError) {
  const clean = (value: string) => stripVTControlCharacters(value).replaceAll("\r", "").trim()
  const line = (value: string) => clean(value).replace(/\s+/g, " ")
  const detail = wrap(clean(error.detail), Math.max(24, (process.stdout.columns ?? 80) - 7)).join("\n")
  return [
    line(error.title),
    "",
    detail,
    ...(error.command ? ["", field("Command", line(error.command))] : []),
    field("Retry", line(error.retry)),
  ].join("\n")
}

function field(label: string, value: string) {
  const prefix = label.padEnd(9)
  const width = Math.max(24, Math.min(61, (process.stdout.columns ?? 80) - prefix.length - 10))
  const lines = wrap(value, width)
  return lines.map((line, index) => `${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`).join("\n")
}

function wrap(value: string, width: number) {
  return value.split("\n").flatMap((source) => {
    if (source.length <= width) return [source]
    return source.split(/\s+/).reduce<string[]>((result, word) => {
      const index = result.length - 1
      if (index < 0 || result[index].length + word.length + 1 > width) result.push(word)
      else result[index] += ` ${word}`
      return result
    }, [])
  })
}
