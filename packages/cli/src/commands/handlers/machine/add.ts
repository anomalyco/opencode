import { Effect } from "effect"
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { serverURLs } from "../../../services/service-urls"
import { ensureMachineClient, formatMachineAdd, machineReach, reportMachineError } from "./common"

const handler = Effect.fn("cli.machine.add")(function* (
  input: Runtime.Input<typeof Commands.commands.machine.commands.add>,
) {
  const client = yield* ensureMachineClient()
  const urls = yield* serverURLs(client, input.url)
  const reach = machineReach(urls)
  const invited = yield* Effect.tryPromise({
    try: (signal) =>
      client.experimental.machine.add(
        {
          name: input.name,
          reach,
          ...(input.replace ? { replace: true } : {}),
        },
        { signal },
      ),
    catch: (cause) => cause,
  })
  process.stdout.write(
    formatMachineAdd({
      name: invited.name,
      join: invited.join,
      expires: invited.expires,
      // A server from before this field existed returns none; show what was sent.
      reach: invited.reach ?? reach,
      tty: Boolean(process.stdout.isTTY),
    }),
  )
})

export default Runtime.handler(Commands.commands.machine.commands.add, (input) =>
  handler(input).pipe(Effect.catch((error) => reportMachineError(error, input.name))),
)
