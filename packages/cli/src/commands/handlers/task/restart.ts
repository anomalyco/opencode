import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.task.commands.restart,
  Effect.fn("cli.task.restart")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const taskID = input.taskId

    const response = yield* Effect.promise(() =>
      client.v2.task.restart({
        taskID,
        location: { directory: process.cwd() },
      }),
    )

    if (response.data) {
      const task = response.data.data
      process.stdout.write(`Task restarted. New ID: ${task.id} (PID: ${task.pid})${EOL}`)
    } else {
      process.stderr.write(`Failed to restart task: ${JSON.stringify(response.error)}${EOL}`)
    }
  }),
)
