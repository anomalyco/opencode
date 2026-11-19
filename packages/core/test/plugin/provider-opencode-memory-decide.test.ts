import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber } from "effect"
import { FetchHttpClient, HttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { OpencodeMemoryDecide } from "@opencode/core/plugin/provider/opencode-memory-decide"
import { testEffect } from "../lib/effect"
import { eventually } from "../lib/eventually"

const it = testEffect(FetchHttpClient.layer)

type Asked = {
  model: string
  state: string
  questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }>
}

/** Console's decision endpoint, answering each request with `answer`, a status, or a promise it settles later. */
const endpoint = (answer: (asked: Asked, index: number) => unknown) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const asked = new Array<Asked & { path: string; authorization: string | null }>()
      const server = Bun.serve({
        port: 0,
        fetch: async (request) => {
          const body = (await request.json()) as Asked
          asked.push({
            ...body,
            path: new URL(request.url).pathname,
            authorization: request.headers.get("authorization"),
          })
          const result = await answer(body, asked.length - 1)
          return typeof result === "number"
            ? Response.json({ error: "no" }, { status: result })
            : Response.json({ model: "jev-1.13", answers: result })
        },
      })
      return { server, asked }
    }),
    (fake) => Effect.promise(() => fake.server.stop(true)),
  )

const decider = (origin: string | undefined) =>
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    return OpencodeMemoryDecide.make({
      http,
      console: Effect.succeed(
        origin === undefined
          ? undefined
          : { key: "ws", server: `${origin}/console`, headers: Effect.succeed({ authorization: "Bearer member" }) },
      ),
    })
  })

const noul = (p: number) => ({ type: "noul", noul: p })
const given = [
  { id: "mem_a", revision: 1, title: "Deploys use wrangler", text: "Run wrangler deploy." },
  { id: "mem_b", revision: 2, title: "Tests", text: "Run bun test." },
]
const entry = {
  id: "mem_a",
  kind: "procedure" as const,
  title: "Deploys use wrangler",
  body: "Run wrangler deploy.",
  revision: 1,
  score: 0.4,
}

describe("OpencodeMemoryDecide", () => {
  it.live(
    "asks Console's decision endpoint with the member's credential, the pinned model and the bench's questions",
    () =>
      Effect.gen(function* () {
        const fake = yield* endpoint((asked) => {
          if (asked.questions.lasting) return { lasting: noul(0.83) }
          if (asked.questions.corrects)
            return {
              corrects: {
                type: "choice",
                choice: "mem_b",
                confidence: 0.9,
                probabilities: { none: 0.1, mem_a: 0.2, mem_b: 0.7 },
              },
            }
          if (asked.questions.durable) return { durable: noul(0.8), fix_record: noul(0.25) }
          return { applies: noul(0.66) }
        })
        const decide = yield* decider(fake.server.url.origin)

        expect(yield* decide.lasting("We squash merges from now on")).toBe(0.83)
        expect(fake.asked[0]).toMatchObject({
          path: "/inference/systemone/v1/systemone",
          authorization: "Bearer member",
          model: "jev-1.13",
          state:
            "Latest message from a user to an AI coding agent working in their repository:\n\nWe squash merges from now on",
        })
        expect(fake.asked[0]?.questions.lasting).toEqual({
          type: "noul",
          instructions:
            "Does this message state something that should hold for future work in this repository beyond the current task, such as a team rule, convention or decision, or a correction of a standing practice?",
          criteria: {
            true: "The message states a lasting team rule, convention or decision, corrects or reverses a standing practice or an earlier rule, or asserts a durable fact about how the team or repository works. It counts even when the same message also asks for a task.",
            false:
              "Everything in the message is about the current task only: a request for this change (even with words like always, never, must or don't describing the requested behaviour), a temporary constraint, a correction of the agent's current work, a preference for this conversation, a question, or a rule someone else stated that the user asks to check.",
          },
        })

        // The best entry, never "none", with its probability.
        expect(yield* decide.corrects("The tests run with vitest now", given)).toEqual({ id: "mem_b", p: 0.7 })
        expect(fake.asked[1]?.state).toBe(
          "Team notes from shared memory that an AI coding agent was shown:\n\n[mem_a] Deploys use wrangler\nRun wrangler deploy.\n\n[mem_b] Tests\nRun bun test.\n\nThe user's latest message to the agent:\n\nThe tests run with vitest now",
        )
        expect(fake.asked[1]?.questions.corrects?.type).toBe("choice")
        expect(fake.asked[1]?.questions.corrects?.criteria.mem_b).toBe(
          'The message says or implies that note mem_b ("Tests") is wrong, outdated or has changed.',
        )
        expect(Object.keys(fake.asked[1]?.questions.corrects?.criteria ?? {})).toEqual(["none", "mem_a", "mem_b"])

        // Durable, and not mainly a record of one fix.
        expect(
          yield* decide.durable({ kind: "gotcha", title: "Dates are UTC", body: "Claim: x" }, "github.com/acme/app"),
        ).toBeCloseTo(0.6, 10)
        expect(Object.keys(fake.asked[2]?.questions ?? {})).toEqual(["durable", "fix_record"])
        expect(fake.asked[2]?.state).toBe(
          "Candidate lesson for a team's shared memory, written after an AI coding agent's task in the github.com/acme/app repository:\n\nKind: gotcha\nTitle: Dates are UTC\n\nClaim: x",
        )

        // At a failure, the command and the end of what it printed come with the task.
        const output = `${"x".repeat(2500)}\nError: wrangler not found`
        expect(
          yield* decide.applies(
            { type: "failure", command: "bun run deploy", output, exitCode: 1 },
            "Deploy the worker",
            entry,
          ),
        ).toBe(0.66)
        expect(fake.asked[3]?.state).toBe(
          `Task given to an AI coding agent:\nDeploy the worker\n\nThe agent ran \`bun run deploy\` and it failed with:\n${output.slice(-2000)}\n\nNote from the team's shared memory (procedure): Deploys use wrangler\nRun wrangler deploy.`,
        )
      }),
  )

  it.live("waits out Console's rate limit within the deadline", () =>
    Effect.gen(function* () {
      const fake = yield* endpoint((_, index) => (index < 2 ? 429 : { lasting: noul(0.91) }))
      const decide = yield* decider(fake.server.url.origin)
      expect(yield* decide.lasting("We squash merges")).toBe(0.91)
      expect(fake.asked).toHaveLength(3)
    }),
  )

  it.live("answers nothing on a refusal, a malformed answer or without a connection", () =>
    Effect.gen(function* () {
      const fake = yield* endpoint((asked) => (asked.state.includes("refused") ? 403 : { other: noul(1) }))
      const decide = yield* decider(fake.server.url.origin)
      expect(yield* decide.lasting("refused")).toBeUndefined()
      expect(yield* decide.lasting("malformed")).toBeUndefined()
      expect(yield* decide.corrects("malformed", given)).toBeUndefined()
      const offline = yield* decider(undefined)
      expect(yield* offline.lasting("anything")).toBeUndefined()
      expect(fake.asked).toHaveLength(3)
    }),
  )

  it.effect("answers nothing once its five seconds are up", () =>
    Effect.gen(function* () {
      const fake = yield* endpoint(() => new Promise(() => {}))
      const decide = yield* decider(fake.server.url.origin)
      const pending = yield* decide.lasting("slow").pipe(Effect.forkChild({ startImmediately: true }))
      yield* eventually(
        Effect.sync(() => fake.asked.length),
        (count) => count === 1,
      )
      yield* TestClock.adjust("4 seconds")
      expect(pending.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect(yield* Fiber.join(pending)).toBeUndefined()
    }),
  )

  it.live("keeps at most four decisions in flight", () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      let open = 0
      let most = 0
      const fake = yield* endpoint(async () => {
        open++
        most = Math.max(most, open)
        await Effect.runPromise(Deferred.await(release))
        open--
        return { lasting: noul(0.5) }
      })
      const decide = yield* decider(fake.server.url.origin)
      const all = yield* Effect.forEach([1, 2, 3, 4, 5, 6], (n) => decide.lasting(`message ${n}`), {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild({ startImmediately: true }))
      yield* eventually(
        Effect.sync(() => fake.asked.length),
        (count) => count === 4,
      )
      yield* Effect.promise(() => Bun.sleep(100))
      expect(fake.asked).toHaveLength(4)
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(all)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
      expect(most).toBe(4)
    }),
  )
})
