import { EOL } from "os"
import { Effect } from "effect"
import { Global } from "@opencode-ai/util/global"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"

export default Runtime.handler(
  Commands.commands.debug.commands.paths,
  Effect.fn("cli.debug.paths")(function* () {
    const global = yield* Global.Service
    process.stdout.write(
      Object.entries(global)
        .map(([key, value]) => `${key.padEnd(10)} ${value}${EOL}`)
        .join(""),
    )
  }),
)
