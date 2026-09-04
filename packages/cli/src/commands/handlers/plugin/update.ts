import { EOL } from "node:os"
import { Cause, Effect, Exit, Option } from "effect"
import { Npm } from "@opencode-ai/util/npm"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { inspect } from "./inventory"

export default Runtime.handler(
  Commands.commands.plugin.commands.update,
  Effect.fn("cli.plugin.update")(function* (input) {
    const result = yield* inspect(Option.getOrUndefined(input.target))
    for (const item of result.items) {
      if (!item.error) continue
      process.stderr.write(`Failed to check ${item.runtime} plugin "${item.name}": ${item.error}${EOL}`)
    }
    const selected = result.items.filter((item) => item.outdated)
    if (!selected.length) {
      process.stdout.write("No plugin updates available" + EOL)
      if (result.items.some((item) => item.error)) process.exitCode = 1
      return
    }

    const npm = yield* Npm.Service
    const updated = yield* Effect.forEach(
      selected,
      (item) =>
        (item.runtime === "Server"
          ? Effect.promise(() => result.client.plugin.update({ location: result.location, targets: [item.target] }))
          : npm.update(item.target).pipe(Effect.asVoid)
        ).pipe(
          Effect.exit,
          Effect.map((result) => ({ item, result })),
        ),
      { concurrency: "unbounded" },
    )
    for (const item of updated) {
      if (Exit.isSuccess(item.result)) {
        process.stdout.write(`Updated ${item.item.runtime} plugin "${item.item.name}"${EOL}`)
        continue
      }
      process.stderr.write(
        `Failed to update ${item.item.runtime} plugin "${item.item.name}": ${Cause.pretty(item.result.cause)}${EOL}`,
      )
      process.exitCode = 1
    }
  }),
)
