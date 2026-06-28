import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"
import { Option } from "effect"

export default Runtime.handler(
  Commands.commands.task.commands.start,
  Effect.fn("cli.task.start")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const name = input.name
    const command = input.command
    const cwd = Option.getOrUndefined(input.cwd)
    const port = Option.getOrUndefined(input.port)

    const response = yield* Effect.promise(() =>
      client.v2.task.start({
        location: { directory: process.cwd() },
        name,
        command,
        cwd,
        port,
      }),
    )

    if (response.data) {
      const task = response.data.data
      process.stdout.write(`Task started successfully! ID: ${task.id} (PID: ${task.pid})${EOL}`)
    } else {
      process.stderr.write(`Failed to start task: ${JSON.stringify(response.error)}${EOL}`)
    }
  }),
)
