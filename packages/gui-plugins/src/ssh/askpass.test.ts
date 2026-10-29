import { expect } from "bun:test"
import { NodeSocket } from "@effect/platform-node"
import { Deferred, Effect, Fiber, Layer, Queue, Scope, Exit } from "effect"
import net from "node:net"
import { Socket } from "effect/socket"
import { testEffect } from "../../../core/test/lib/effect"
import { createAskpass } from "./askpass"

const it = testEffect(Layer.empty)

const request = Effect.fn("test.askpass.request")(function* (
  env: Record<string, string>,
  text: string,
  confirm = false,
) {
  const socket = yield* NodeSocket.makeNet({ host: "127.0.0.1", port: Number(env.OPENCODE_SSH_ASKPASS_PORT) })
  const writer = yield* socket.writer
  const result = { text: "" }
  yield* Effect.gen(function* () {
    const pull = yield* Socket.readerString(socket)
    yield* writer.write(JSON.stringify({ token: env.OPENCODE_SSH_ASKPASS_TOKEN, text, confirm }) + "\n")

    while (true) result.text += (yield* pull).join("")
  }).pipe(Effect.ignore)

  return result.text
}, Effect.scoped)

it.live(
  "per-prompt replies are isolated, including confirmation and OTP",
  Effect.gen(function* () {
    const prompts = yield* Queue.unbounded<{ id: string; text: string; confirm: boolean }>()

    const bridge = yield* createAskpass({
      binary: "unused",
      prompt: (prompt) => Queue.offer(prompts, prompt).pipe(Effect.asVoid),
      clear: () => Effect.void,
    })

    const password = yield* request(bridge.env, "Password:").pipe(Effect.forkScoped)
    const first = yield* Queue.take(prompts)
    expect(first.text).toBe("Password:")
    const otp = yield* request(bridge.env, "Verification code:").pipe(Effect.forkScoped)
    yield* bridge.respond(first.id, "private response")
    expect(yield* Fiber.join(password)).toBe('{"value":"private response"}')
    const second = yield* Queue.take(prompts)
    expect(second.text).toBe("Verification code:")
    yield* bridge.respond(second.id, "123456")
    expect(yield* Fiber.join(otp)).toBe('{"value":"123456"}')
  }),
)

it.live(
  "closing the scope closes waiting helpers; invalid bridge credentials cannot prompt",
  Effect.gen(function* () {
    const parent = yield* Scope.Scope
    const scope = yield* Scope.fork(parent)
    const prompted = yield* Deferred.make<void>()

    const bridge = yield* createAskpass({
      binary: "unused",
      prompt: () => Deferred.succeed(prompted, undefined).pipe(Effect.asVoid),
      clear: () => Effect.void,
    }).pipe(Scope.provide(scope))

    expect(yield* request({ ...bridge.env, OPENCODE_SSH_ASKPASS_TOKEN: "incorrect" }, "Password:")).toBe("")
    const reply = yield* request(bridge.env, "Trust fingerprint?", true).pipe(Effect.forkScoped)
    yield* Deferred.await(prompted)
    yield* Scope.close(scope, Exit.void)
    expect(yield* Fiber.join(reply)).toBe("")
  }),
)

it.live(
  "oversized requests never prompt; disconnecting a helper clears its prompt",
  Effect.gen(function* () {
    const prompts = yield* Queue.unbounded<string>()
    const cleared = yield* Deferred.make<string>()

    const bridge = yield* createAskpass({
      binary: "unused",
      prompt: (prompt) => Queue.offer(prompts, prompt.id).pipe(Effect.asVoid),
      clear: (id) => Deferred.succeed(cleared, id).pipe(Effect.asVoid),
    })

    expect(yield* request(bridge.env, "x".repeat(16_384))).toBe("")
    expect(yield* Queue.size(prompts)).toBe(0)

    const helper = yield* request(bridge.env, "Password:").pipe(Effect.forkScoped)
    const id = yield* Queue.take(prompts)
    yield* Fiber.interrupt(helper)
    expect(yield* Deferred.await(cleared)).toBe(id)
  }),
)

it.live(
  "a request split inside a multi-byte character arrives intact",
  Effect.gen(function* () {
    const prompts = yield* Queue.unbounded<string>()

    const bridge = yield* createAskpass({
      binary: "unused",
      prompt: (prompt) => Queue.offer(prompts, prompt.text).pipe(Effect.asVoid),
      clear: () => Effect.void,
    })

    const payload = Buffer.from(
      JSON.stringify({ token: bridge.env.OPENCODE_SSH_ASKPASS_TOKEN, text: "Passwort für host:", confirm: false }) +
        "\n",
    )

    // Split between the two bytes of "ü" so they arrive as separate reads.
    const split = payload.indexOf(0xc3) + 1

    const client = yield* Effect.acquireRelease(
      Effect.callback<net.Socket>((resume) => {
        const socket = net.createConnection(Number(bridge.env.OPENCODE_SSH_ASKPASS_PORT), "127.0.0.1", () =>
          resume(Effect.succeed(socket)),
        )
      }),
      (socket) => Effect.sync(() => socket.destroy()),
    )

    client.setNoDelay(true)
    client.write(payload.subarray(0, split))
    yield* Effect.sleep("50 millis")
    client.write(payload.subarray(split))
    expect(yield* Queue.take(prompts)).toBe("Passwort für host:")
  }),
)
