import { Effect } from "effect"
import { EOL } from "node:os"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { ensureMachineClient, reportMachineError } from "./common"

const handler = Effect.fn("cli.machine.remove")(function* (
  input: Runtime.Input<typeof Commands.commands.machine.commands.remove>,
) {
  const client = yield* ensureMachineClient()
  yield* Effect.tryPromise({
    try: (signal) => client.experimental.machine.remove({ name: input.name }, { signal }),
    catch: (cause) => cause,
  })
  process.stdout.write(`Removed machine ${input.name}.${EOL}`)
})

export default Runtime.handler(Commands.commands.machine.commands.remove, (input) =>
  handler(input).pipe(Effect.catch((error) => reportMachineError(error, input.name))),
)
