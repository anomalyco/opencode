import { EOL } from "node:os"
import { Effect, Option } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { format, inspect } from "./inventory"

export default Runtime.handler(
  Commands.commands.plugin.commands.check,
  Effect.fn("cli.plugin.check")(function* (input) {
    const result = yield* inspect(Option.getOrUndefined(input.target))
    process.stdout.write((format(result.items) || "No package plugins found") + EOL)
    if (result.items.some((item) => item.error)) process.exitCode = 1
  }),
)
