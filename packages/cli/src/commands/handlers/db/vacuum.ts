import { Service } from "@opencode/client/effect/service"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ServiceConfig } from "../../../services/service-config"
import { databasePath } from "../../../database-path"
import { errorMessage } from "../../../util/error"
import { compactDatabase } from "./maintenance"

const handler = Effect.fn("cli.db.vacuum")(function* (_input: Runtime.Input<typeof Commands.commands.db.commands.vacuum>) {
  const serviceOptions = yield* ServiceConfig.options()
  const active = yield* Service.status({ ...serviceOptions, version: undefined })
  if (active) throw new Error(`Stop the background service before vacuuming the database (service is ${active.state}).`)

  const global = yield* Global.Service
  const result = yield* Effect.try({
    try: () => compactDatabase(databasePath(global.data)),
    catch: (cause) => cause,
  })

  const reclaimed = Math.max(0, result.beforeBytes - result.afterBytes)
  process.stdout.write(`Database vacuum complete; reclaimed ${(reclaimed / 1024 / 1024).toFixed(1)} MiB.${EOL}`)
})

export default Runtime.handler(Commands.commands.db.commands.vacuum, (input) =>
  handler(input).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        process.stderr.write(errorMessage(error) + EOL)
        process.exitCode = 1
      }),
    ),
  ),
)
