import { NodeSocket } from "@effect/platform-node"
import { Effect, Option, Schema, Stdio, Stream } from "effect"

const Response = Schema.fromJsonString(Schema.Struct({ value: Schema.NullOr(Schema.String) }))
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(65535))

// OpenSSH invokes the executable directly, including on Windows. Run outside
// normal CLI observability so neither prompts nor responses enter its logs.
export const askpass = Effect.gen(function* () {
  const port = yield* Schema.decodeUnknownEffect(Port)(process.env.OPENCODE_SSH_ASKPASS_PORT)
  const stdio = yield* Stdio.Stdio
  const socket = yield* NodeSocket.makeNet({ host: "127.0.0.1", port })
  const write = yield* socket.writer
  const reader = yield* socket.reader
  yield* write.write(
    JSON.stringify({
      token: process.env.OPENCODE_SSH_ASKPASS_TOKEN,
      text: process.argv.slice(2).join(" "),
      confirm: process.env.SSH_ASKPASS_PROMPT === "confirm",
    }) + "\n",
  )
  const result = yield* Effect.gen(function* () {
    const decoder = new TextDecoder()
    let text = ""
    while (true) {
      const frames = yield* reader.pull
      for (const frame of frames) text += typeof frame === "string" ? frame : decoder.decode(frame, { stream: true })
      const result = Schema.decodeUnknownOption(Response)(text)
      if (Option.isSome(result)) return result.value
    }
  })
  if (result.value === null) return 1
  yield* Stream.make(result.value + "\n").pipe(Stream.run(stdio.stdout({ endOnDone: false })))
  return 0
}).pipe(
  Effect.scoped,
  Effect.timeout("5 minutes"),
  Effect.orElseSucceed(() => 1),
)
