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
  pid?: number,
) {
  const socket = yield* NodeSocket.makeNet({ host: "127.0.0.1", port: Number(env.OPENCODE_SSH_ASKPASS_PORT) })
  const writer = yield* socket.writer
  const result = { text: "" }
  yield* Effect.gen(function* () {
    const pull = yield* Socket.readerString(socket)
    yield* writer.write(JSON.stringify({ token: env.OPENCODE_SSH_ASKPASS_TOKEN, text, confirm, pid }) + "\n")

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

it.live(
  "reuses host-qualified passwords across helper processes but asks again for rejected credentials",
  Effect.gen(function* () {
    const prompts = yield* Queue.unbounded<{ id: string; text: string; confirm: boolean }>()
    let count = 0

    const bridge = yield* createAskpass({
      binary: "unused",
      reusePassword: true,
      prompt: (prompt) => Effect.sync(() => count++).pipe(Effect.andThen(Queue.offer(prompts, prompt)), Effect.asVoid),
      clear: () => Effect.void,
    })

    const text = "user@host's password: "
    const first = yield* request(bridge.env, text, false, 100).pipe(Effect.forkScoped)
    const prompt = yield* Queue.take(prompts)
    yield* bridge.respond(prompt.id, "first password")
    expect(yield* Fiber.join(first)).toBe('{"value":"first password"}')

    const second = yield* request(bridge.env, text, false, 200).pipe(Effect.forkScoped)
    expect(yield* Fiber.join(second).pipe(Effect.timeout("1 second"))).toBe('{"value":"first password"}')

    expect(count).toBe(1)

    const retry = yield* request(bridge.env, text, false, 200).pipe(Effect.forkScoped)
    const rejected = yield* Queue.take(prompts)
    yield* bridge.respond(rejected.id, "correct password")
    expect(yield* Fiber.join(retry)).toBe('{"value":"correct password"}')
    expect(count).toBe(2)
    expect(yield* request(bridge.env, text, false, 300)).toBe('{"value":"correct password"}')
    yield* bridge.forget
    const fresh = yield* request(bridge.env, text, false, 400).pipe(Effect.forkScoped)
    const forgotten = yield* Queue.take(prompts)
    yield* bridge.respond(forgotten.id, "new password")
    expect(yield* Fiber.join(fresh)).toBe('{"value":"new password"}')
    expect(count).toBe(3)
  }),
)

it.live(
  "prompts separately for non-password challenges, older helpers, and disabled reuse",
  Effect.gen(function* () {
    for (const item of [
      { text: "Verification code:", confirm: false, pid: 100, reusePassword: true },
      { text: "user@host's password: ", confirm: true, pid: 100, reusePassword: true },
      { text: "Password:", confirm: false, pid: 100, reusePassword: true },
      { text: "Enter passphrase for key '/key':", confirm: false, pid: 100, reusePassword: true },
      { text: "user@host's password: ", confirm: false, pid: undefined, reusePassword: true },
      { text: "user@host's password: ", confirm: false, pid: 100, reusePassword: false },
    ]) {
      const prompts = yield* Queue.unbounded<{ id: string; text: string; confirm: boolean }>()

      const bridge = yield* createAskpass({
        binary: "unused",
        reusePassword: item.reusePassword,
        prompt: (prompt) => Queue.offer(prompts, prompt).pipe(Effect.asVoid),
        clear: () => Effect.void,
      })

      for (const pid of [item.pid, item.pid === undefined ? undefined : item.pid + 1]) {
        const reply = yield* request(bridge.env, item.text, item.confirm, pid).pipe(Effect.forkScoped)
        const prompt = yield* Queue.take(prompts)
        expect(prompt).toMatchObject({ text: item.text, confirm: item.confirm })
        yield* bridge.respond(prompt.id, "response")
        expect(yield* Fiber.join(reply)).toBe('{"value":"response"}')
      }
    }
  }),
)
