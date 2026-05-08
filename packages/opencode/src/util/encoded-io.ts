import { Effect } from "effect"
import { Encoding } from "@/util/encoding"

/**
 * Effect wrappers around {@link Encoding.read} and {@link Encoding.write} so
 * tool code can preserve file encoding without leaking Node/async boilerplate
 * into each call site. Uses {@link Effect.tryPromise} so I/O failures surface
 * as typed errors that can be recovered with `.pipe(Effect.catch(...))`.
 */
const wrap = (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause)))

export const read = (path: string) => Effect.tryPromise({ try: () => Encoding.read(path), catch: wrap })

export const write = (path: string, text: string, encoding: string = Encoding.DEFAULT) =>
  Effect.tryPromise({ try: () => Encoding.write(path, text, encoding), catch: wrap })

export * as EncodedIO from "./encoded-io"
