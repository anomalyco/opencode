import { expect } from "bun:test"
import { NodeSocket } from "@effect/platform-node"
import { Deferred, Effect, Fiber, Layer, Queue, Scope, Exit } from "effect"
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
  const write = yield* socket.writer
  const result = { text: "" }
  yield* Effect.all(
    [
      socket
        .runString((text) => {
          result.text += text
        })
        .pipe(Effect.ignore),
      write(JSON.stringify({ token: env.OPENCODE_SSH_ASKPASS_TOKEN, text, confirm, pid }) + "\n").pipe(Effect.ignore),
    ],
    { concurrency: "unbounded" },
  )
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
