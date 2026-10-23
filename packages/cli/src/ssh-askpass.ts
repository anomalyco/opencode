import { NodeSocket } from "@effect/platform-node"
import { Effect, Schema, Stdio, Stream } from "effect"
import { Socket } from "effect/socket"

const Response = Schema.fromJsonString(Schema.Struct({ value: Schema.NullOr(Schema.String) }))
const Port = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(65535))

// OpenSSH invokes the executable directly, including on Windows. Run outside
// normal CLI observability so neither prompts nor responses enter its logs.
export const askpass = Effect.gen(function* () {
  const port = yield* Schema.decodeUnknownEffect(Port)(process.env.OPENCODE_SSH_ASKPASS_PORT)
  const stdio = yield* Stdio.Stdio
  const socket = yield* NodeSocket.makeNet({ host: "127.0.0.1", port })
  const pull = yield* Socket.readerBytes(socket)
  const writer = yield* socket.writer
  yield* writer.write(
    JSON.stringify({
      token: process.env.OPENCODE_SSH_ASKPASS_TOKEN,
      text: process.argv.slice(2).join(" "),
      pid: process.ppid,
      confirm: process.env.SSH_ASKPASS_PROMPT === "confirm",
    }) + "\n",
  )
  // One streaming decoder, so a character split across reads decodes intact.
  const decoder = new TextDecoder()
  const response = { text: "" }
  yield* Effect.gen(function* () {
    while (true) for (const chunk of yield* pull) response.text += decoder.decode(chunk, { stream: true })
  }).pipe(Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void))
  const result = yield* Schema.decodeUnknownEffect(Response)(response.text)
  if (result.value === null) return 1
  yield* Stream.make(result.value + "\n").pipe(Stream.run(stdio.stdout({ endOnDone: false })))
  return 0
}).pipe(
  Effect.scoped,
  Effect.timeout("5 minutes"),
  Effect.orElseSucceed(() => 1),
)
