import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ensureMachineClient, formatMachineList, reportMachineError } from "./common"

const handler = Effect.fn("cli.machine.list")(function* () {
  const client = yield* ensureMachineClient()
  const machines = yield* Effect.tryPromise({
    try: (signal) => client.experimental.machine.list({ signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(formatMachineList(machines) + EOL)
})

export default Runtime.handler(Commands.commands.machine.commands.list, () =>
  handler().pipe(Effect.catch((error) => reportMachineError(error))),
)
