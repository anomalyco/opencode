import { EOL } from "os"
import * as Effect from "effect/Effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.task.commands.delete,
  Effect.fn("cli.task.delete")(function* (input) {
    const daemon = yield* Daemon.Service
    const client = yield* daemon.client()
    const taskID = input.taskId

    const response = yield* Effect.promise(() =>
      client.v2.task.delete({
        taskID,
        location: { directory: process.cwd() },
      }),
    )

    if (!response.error) {
      process.stdout.write(`Task and logs deleted successfully.${EOL}`)
    } else {
      process.stderr.write(`Failed to delete task: ${JSON.stringify(response.error)}${EOL}`)
    }
  }),
)
