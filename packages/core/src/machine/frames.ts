export * as Frames from "./frames.js"

import { Deferred, Effect, Queue, Result, Stream } from "effect"
import type { Carrier } from "./link.js"
import type { Noise } from "./noise.js"

// What the link carries once its handshake is done. Each carrier message is one Noise transport message, and its
// plaintext is one frame: a tag byte, then a piece of an application message, one wire.ts message as UTF-8 JSON.
//
//   0x00  final   the last or only piece of a message, of any length, empty included
//   0x01  more    a piece the next frame continues, always exactly PIECE (65,518) bytes
//
// A message too long for one frame is split across frames in order, and pieces of two messages never interleave in one
// direction. Every failure to decrypt, reassemble, decode or validate ends the link: nothing is skipped and nothing is
// answered.

const FINAL = 0
const MORE = 1
/** Noise's largest message, 65,535 bytes, less its 16-byte tag and the frame's tag byte. */
const PIECE = 65_535 - 16 - 1
/**
 * The largest message either side sends or accepts, in bytes of JSON. The largest file the home reads whole is
 * video-generate's 100 MiB input (`MAX_INPUT_BYTES`), which base64 turns into about 133.4 MiB; the rest is headroom for
 * the JSON around it. A worker refuses a larger read with an `fs` error instead of sending it.
 */
export const MAX_MESSAGE = 160 * 1024 * 1024

/** One cipher per direction, each rekeying itself: see `rekeying`. */
export type Ciphers = ReturnType<typeof rekeying>

export interface Codec<In, Out> {
  readonly decode: (bytes: Uint8Array) => Effect.Effect<In, unknown>
  readonly encode: (message: Out) => Effect.Effect<Uint8Array, unknown>
}

/** Whether a frame's plaintext is a piece the next frame continues, so its message is still half across. */
export const continues = (frame: Uint8Array) => frame[0] === MORE

/** The next message's bytes, reassembled from its frames, failing on a bad frame or a message over `MAX_MESSAGE`. */
export const read = (carrier: Carrier, cipher: Ciphers["receive"]) =>
  Effect.gen(function* () {
    const pieces: Uint8Array[] = []
    let size = 0
    while (true) {
      const frame = yield* Effect.fromResult(cipher.decrypt(yield* carrier.receive))
      const tag = frame[0]
      // A full `more` bounds the pieces held for one message by MAX_MESSAGE / PIECE, whatever the peer sends.
      if (tag !== FINAL && (tag !== MORE || frame.length !== PIECE + 1)) return yield* Effect.fail("BadFrame" as const)
      size += frame.length - 1
      if (size > MAX_MESSAGE) return yield* Effect.fail("TooLong" as const)
      pieces.push(frame.subarray(1))
      if (tag === FINAL) return new Uint8Array(Buffer.concat(pieces))
    }
  })

/** Sends one message as frames, in order, refusing one over `MAX_MESSAGE` before anything is sent. */
export const write = (carrier: Carrier, cipher: Ciphers["send"], message: Uint8Array) =>
  message.length > MAX_MESSAGE
    ? Effect.fail("TooLong" as const)
    : Effect.forEach(
        Array.from({ length: Math.max(1, Math.ceil(message.length / PIECE)) }, (_, index) => index * PIECE),
        (offset) => {
          const last = offset + PIECE >= message.length
          const frame = new Uint8Array(
            Buffer.concat([Uint8Array.of(last ? FINAL : MORE), message.subarray(offset, offset + PIECE)]),
          )
          return Effect.flatMap(Effect.fromResult(cipher.encrypt(frame)), carrier.send)
        },
        { discard: true },
      )

/**
 * Carries messages over a link whose handshake is done, until it ends.
 *
 * `send` queues a message for one fiber, forked in the caller's scope, that alone encrypts and writes; the queue holds
 * messages until that fiber takes them, so a slow carrier holds back only what was already sent. `messages` reads as
 * it is pulled, so a peer cannot get further ahead than the carrier buffers, and only pulling notices a carrier that
 * ended or a bad frame. The link ends then, on a message to send over `MAX_MESSAGE`, or when the scope closes:
 * `messages` ends and every later `send` is dropped. The caller then closes the carrier and the scope.
 *
 * `messages` has one reader: two would split a message's pieces between them. Nothing here bounds the bytes waiting in
 * the outbox behind a carrier that stops reading, or the time between pieces of one message: the endpoint that owns the
 * socket sets those limits (an idle timeout, a send buffer limit) and closes the scope on every exit.
 */
export const open = <In, Out>(carrier: Carrier, ciphers: Ciphers, codec: Codec<In, Out>) =>
  Effect.gen(function* () {
    const outbox = yield* Queue.unbounded<Out>()
    const ended = yield* Deferred.make<void>()
    const end = Effect.andThen(Deferred.succeed(ended, undefined), Queue.shutdown(outbox))
    // On the scope, not only on the writer: a writer interrupted before its first step never runs its own finalizers.
    yield* Effect.addFinalizer(() => end)
    yield* Effect.forkScoped(
      Effect.forever(
        Effect.flatMap(Queue.take(outbox), (message) =>
          Effect.flatMap(codec.encode(message), (bytes) => write(carrier, ciphers.send, bytes)),
        ),
      ).pipe(Effect.ignore, Effect.ensuring(end)),
    )
    return {
      send: (message: Out) => {
        Queue.offerUnsafe(outbox, message)
      },
      // Checked before each read, since `interruptWhen` would start the read first and deliver a frame already waiting.
      messages: Stream.fromEffectRepeat(
        Effect.suspend(() =>
          Deferred.isDoneUnsafe(ended)
            ? Effect.fail("Ended" as const)
            : Effect.flatMap(read(carrier, ciphers.receive), codec.decode),
        ).pipe(Effect.onError(() => end)),
      ).pipe(Stream.interruptWhen(Deferred.await(ended)), Stream.ignore),
    }
  })

// Each direction rekeys itself after every `interval`th transport message it carries, the welcome included: the sender
// once it has encrypted that message and the receiver once it has decrypted it. Both sides count the same messages, so
// nothing on the wire says when. A transport restored from a snapshot counts on from its nonces: each direction's count
// is the nonce of its next message, since both start at zero and step once per message.
export const rekeying = (transport: Noise.Transport, interval: number, counted = { sent: 0, received: 0 }) => {
  let sent = counted.sent
  let received = counted.received
  return {
    send: {
      encrypt: (plaintext: Uint8Array) =>
        Result.map(transport.send.encrypt(plaintext), (ciphertext) => {
          if (++sent % interval === 0) transport.send.rekey()
          return ciphertext
        }),
    },
    receive: {
      decrypt: (ciphertext: Uint8Array) =>
        Result.map(transport.receive.decrypt(ciphertext), (plaintext) => {
          if (++received % interval === 0) transport.receive.rekey()
          return plaintext
        }),
    },
  }
}
