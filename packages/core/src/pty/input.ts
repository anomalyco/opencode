import { Effect } from "effect"

const inputDecoder = new TextDecoder("utf-8", { fatal: true })

export function handlePtyInput(
  handler: { onMessage: (message: string | ArrayBuffer) => void },
  message: string | Uint8Array,
) {
  if (typeof message === "string") {
    handler.onMessage(message)
    return Effect.void
  }
  return Effect.try({
    try: () => inputDecoder.decode(message),
    catch: () => new Error("invalid PTY websocket input"),
  }).pipe(
    Effect.catch(() => Effect.succeed(undefined)),
    Effect.flatMap((decoded) => {
      if (decoded === undefined) return Effect.void
      handler.onMessage(decoded)
      return Effect.void
    }),
  )
}
