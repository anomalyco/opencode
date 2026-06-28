import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.task.commands.list,
  Effect.fn("cli.task.list")(function* () {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()

    const response = yield* Effect.promise(() =>
      client.v2.task.list({
        location: { directory: process.cwd() },
      }),
    )

    if (response.data) {
      const list = response.data.data
      if (list.length === 0) {
        process.stdout.write(`No background tasks registered.${EOL}`)
        return
      }
      process.stdout.write(
        `ID\t\t\tNAME\t\t\tSTATUS\t\tPID\tPORT\tCOMMAND${EOL}`
      )
      process.stdout.write(`--------------------------------------------------------------------------------${EOL}`)
      for (const t of list) {
        process.stdout.write(
          `${t.id}\t${t.name.slice(0, 15).padEnd(15)}\t${t.status.padEnd(10)}\t${String(t.pid ?? "-").padEnd(6)}\t${String(t.port ?? "-").padEnd(5)}\t${t.command}${EOL}`
        )
      }
    } else {
      process.stderr.write(`Failed to list tasks: ${JSON.stringify(response.error)}${EOL}`)
    }
  }),
)
