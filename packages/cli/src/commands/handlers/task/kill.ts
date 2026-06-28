import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.task.commands.kill,
  Effect.fn("cli.task.kill")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const taskID = input.taskId

    const response = yield* Effect.promise(() =>
      client.v2.task.kill({
        taskID,
        location: { directory: process.cwd() },
      }),
    )

    if (response.data) {
      const task = response.data.data
      process.stdout.write(`Task force killed. ID: ${task.id}, Status: ${task.status}${EOL}`)
    } else {
      process.stderr.write(`Failed to kill task: ${JSON.stringify(response.error)}${EOL}`)
    }
  }),
)
