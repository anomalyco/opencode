import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.task.commands.stop,
  Effect.fn("cli.task.stop")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const taskID = input.taskId

    const response = yield* Effect.promise(() =>
      client.v2.task.stop({
        taskID,
        location: { directory: process.cwd() },
      }),
    )

    if (response.data) {
      const task = response.data.data
      process.stdout.write(`Task stopped. ID: ${task.id}, Status: ${task.status}${EOL}`)
    } else {
      process.stderr.write(`Failed to stop task: ${JSON.stringify(response.error)}${EOL}`)
    }
  }),
)
