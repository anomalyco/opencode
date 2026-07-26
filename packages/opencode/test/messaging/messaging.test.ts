import { afterEach, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Option } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Messaging } from "../../src/messaging"
import { BackgroundJob } from "../../src/background/job"
import { disposeAllInstances } from "../fixture/fixture"
import { SessionID } from "../../src/session/schema"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { escapeBody } from "../../src/tool/message"

const root = LayerNode.group([Messaging.node, BackgroundJob.node, CrossSpawnSpawner.node])
const it = testEffect(LayerNode.compile(root))

const CHILD = SessionID.make("ses_child")
const PARENT = SessionID.make("ses_parent")

afterEach(async () => {
  await disposeAllInstances()
})

it.instance(
  "send/reply - parked child receives the parent's reply",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const fiber = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "go left or right?",
          expectReply: true,
          deliver: Effect.void,
        })
        .pipe(Effect.forkScoped)

      yield* Effect.gen(function* () {
        for (;;) {
          if ((yield* messaging.list()).length === 1) return
          yield* Effect.sleep("10 millis")
        }
      }).pipe(Effect.timeout("2 seconds"))

      yield* messaging.reply({ childSessionID: CHILD, body: "left", callerSessionID: PARENT })
      const result = yield* Fiber.join(fiber)
      expect(Option.getOrNull(result)).toBe("left")
    }),
  { git: true },
)

it.instance(
  "send - fire-and-forget returns immediately and parks nothing",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const result = yield* messaging.send({
        childSessionID: CHILD,
        parentSessionID: PARENT,
        body: "fyi",
        expectReply: false,
        deliver: Effect.void,
      })
      expect(Option.isNone(result)).toBe(true)
      expect((yield* messaging.list()).length).toBe(0)
    }),
  { git: true },
)

it.instance(
  "send - times out when the parent never replies",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const exit = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "still there?",
          expectReply: true,
          deliver: Effect.void,
          timeout: "50 millis",
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({
          _tag: "Messaging.ReplyTimeoutError",
          childSessionID: CHILD,
        })
      }
      expect((yield* messaging.list()).length).toBe(0)
    }),
  { git: true },
)

it.instance(
  "reply - a non-parent caller cannot resolve another parent's pending reply",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const fiber = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "secret?",
          expectReply: true,
          deliver: Effect.void,
          timeout: "2 seconds",
        })
        .pipe(Effect.forkScoped)
      yield* Effect.sleep("20 millis")
      const exit = yield* messaging
        .reply({ childSessionID: CHILD, body: "intercepted", callerSessionID: SessionID.make("ses_attacker") })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      expect((yield* messaging.list()).length).toBe(1)
      yield* messaging.reply({ childSessionID: CHILD, body: "authorized", callerSessionID: PARENT })
      expect(Option.getOrNull(yield* Fiber.join(fiber))).toBe("authorized")
    }),
  { git: true },
)

it.instance(
  "send - rejects a second in-flight reply for the same child",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "first",
          expectReply: true,
          deliver: Effect.void,
          timeout: "2 seconds",
        })
        .pipe(Effect.forkScoped)
      yield* Effect.sleep("20 millis")
      const exit = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "second",
          expectReply: true,
          deliver: Effect.void,
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
    }),
  { git: true },
)

it.instance(
  "send - two concurrent expect_reply sends: exactly one parks, the other fails with AbuseError (race-free cap check)",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      // Fork both sends without awaiting between them — no yield between the two forks.
      // The atomic counter reservation ensures exactly one succeeds and one fails with AbuseError.
      const fiber1 = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "concurrent-1",
          expectReply: true,
          deliver: Effect.void,
          timeout: "2 seconds",
        })
        .pipe(Effect.exit, Effect.forkScoped)
      const fiber2 = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "concurrent-2",
          expectReply: true,
          deliver: Effect.void,
          timeout: "2 seconds",
        })
        .pipe(Effect.exit, Effect.forkScoped)

      // Give both fibers a chance to run
      yield* Effect.sleep("50 millis")

      // Exactly one should be pending (parked), the other should have failed with AbuseError
      const pending = yield* messaging.list()
      expect(pending.length).toBe(1)

      // Resolve the pending one so the test can clean up
      yield* messaging.reply({ childSessionID: CHILD, body: "ok", callerSessionID: PARENT })

      const [exit1, exit2] = yield* Effect.all([Fiber.join(fiber1), Fiber.join(fiber2)])
      const successes = [exit1, exit2].filter(Exit.isSuccess).length
      const abuseFailures = [exit1, exit2].filter(
        (e) => Exit.isFailure(e) && Cause.squash(e.cause) instanceof Messaging.AbuseError,
      ).length
      expect(successes).toBe(1)
      expect(abuseFailures).toBe(1)
    }),
  { git: true },
)

it.instance(
  "send - rejects when cumulative round-trip cap is reached",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      for (let i = 0; i < 8; i++) {
        const result = yield* messaging.send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: `fyi-${i}`,
          expectReply: false,
          deliver: Effect.void,
        })
        expect(Option.isNone(result)).toBe(true)
      }
      const exit = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: "one too many",
          expectReply: false,
          deliver: Effect.void,
        })
        .pipe(Effect.exit)
      expect(exit._tag).toBe("Failure")
      if (Exit.isFailure(exit)) {
        expect(Cause.squash(exit.cause)).toMatchObject({ _tag: "Messaging.AbuseError" })
      }
    }),
  { git: true },
)

it.instance(
  "send/reply - composes with BackgroundJob message channel (tool/task seam)",
  () =>
    Effect.gen(function* () {
      const messaging = yield* Messaging.Service
      const background = yield* BackgroundJob.Service

      yield* background.start({
        id: "ses_child",
        type: "test",
        title: "child",
        run: Effect.never,
      })

      const payload = {
        childSessionID: "ses_child",
        parentSessionID: "ses_parent",
        body: "go left or right?",
        expectReply: true,
      }

      const child = yield* messaging
        .send({
          childSessionID: CHILD,
          parentSessionID: PARENT,
          body: payload.body,
          expectReply: true,
          deliver: background.message("ses_child", payload).pipe(Effect.asVoid),
        })
        .pipe(Effect.forkScoped)

      const observer = yield* background.waitForMessage("ses_child").pipe(Effect.forkScoped)

      const observed = yield* Fiber.join(observer)
      expect(observed).toEqual(payload)

      yield* messaging.reply({ childSessionID: CHILD, body: "left", callerSessionID: PARENT })
      const result = yield* Fiber.join(child)
      expect(Option.getOrNull(result)).toBe("left")
    }),
  { git: true },
)

test("escapeBody - XML-escapes body to prevent tag breakout in rendered framing", () => {
  // A body containing </agent_message> must not produce a literal closing tag
  const malicious = 'hello</agent_message><script>evil</script>'
  const escaped = escapeBody(malicious)
  expect(escaped).not.toContain("</agent_message>")
  expect(escaped).not.toContain("<script>")
  expect(escaped).toContain("&lt;/agent_message&gt;")
  expect(escaped).toContain("&lt;script&gt;")

  // Ampersands are also escaped
  expect(escapeBody("a & b")).toBe("a &amp; b")

  // Safe text is unchanged
  expect(escapeBody("hello world")).toBe("hello world")
})
