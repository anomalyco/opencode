import { describe, expect } from "bun:test"
import type { DecisionAnswer, DecisionRequest } from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { TestClock } from "effect/testing"
import { ModelNotFoundError, ProviderRequestError } from "@opencode/core/generate"
import { OpencodeMemoryDecide } from "@opencode/core/plugin/provider/opencode-memory-decide"
import { testEffect } from "../lib/effect"
import { eventually } from "../lib/eventually"

const it = testEffect(Layer.empty)

/** OpenCode's decision generation, answering each request with `answer`: answers, or an error to fail with. */
const generation = (
  answer: (request: DecisionRequest, index: number) => Effect.Effect<ReadonlyArray<DecisionAnswer>, unknown>,
) => {
  const asked = new Array<DecisionRequest>()
  // Each run is a request, as OpenCode's decision generation makes one per run.
  const decisions = (request: DecisionRequest) =>
    Effect.suspend(() => {
      asked.push(request)
      return answer(request, asked.length - 1).pipe(Effect.map((answers) => ({ answers: [...answers] })))
    })
  return { asked, decisions: decisions as Parameters<typeof OpencodeMemoryDecide.make>[0]["decisions"] }
}

const predicate = (name: string, probability: number): DecisionAnswer => ({ type: "predicate", name, probability })
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
const limited = new ProviderRequestError({
  providerID: "opencode",
  reason: "rate_limit",
  message: "slow down",
  status: 429,
})

describe("OpencodeMemoryDecide", () => {
  it.live("asks the configured decision model the bench's questions, through OpenCode's decision generation", () =>
    Effect.gen(function* () {
      const fake = generation((request) => {
        const question = request.questions[0]!
        if (question.name === "lasting") return Effect.succeed([predicate("lasting", 0.83)])
        if (question.name === "corrects")
          return Effect.succeed([
            {
              type: "choice",
              name: "corrects",
              choice: "mem_b",
              confidence: 0.9,
              probabilities: [
                { value: "none", probability: 0.1 },
                { value: "mem_a", probability: 0.2 },
                { value: "mem_b", probability: 0.7 },
              ],
            },
          ])
        if (question.name === "durable")
          return Effect.succeed([predicate("durable", 0.8), predicate("fix_record", 0.25)])
        if (question.name === "stated") return Effect.succeed([predicate("stated", 0.2)])
        return Effect.succeed([predicate("applies", 0.66), predicate("repo_wide", 0.3)])
      })
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })

      expect(yield* decide.lasting("We squash merges from now on")).toBe(0.83)
      expect(fake.asked[0]).toEqual({
        model: Model.Ref.make({ providerID: Provider.ID.make("opencode"), id: Model.ID.make("jev-1.13") }),
        input: [
          {
            type: "text",
            text: "Latest message from a user to an AI coding agent working in their repository:\n\nWe squash merges from now on",
          },
        ],
        questions: [
          {
            type: "predicate",
            name: "lasting",
            instructions:
              "Does this message state something that should hold for future work in this repository beyond the current task, such as a team rule, convention or decision, or a correction of a standing practice?",
            criteria: {
              true: "The message states a lasting team rule, convention or decision, corrects or reverses a standing practice or an earlier rule, or asserts a durable fact about how the team or repository works. It counts even when the same message also asks for a task.",
              false:
                "Everything in the message is about the current task only: a request for this change (even with words like always, never, must or don't describing the requested behaviour), a temporary constraint, a correction of the agent's current work, a preference for this conversation, a question, or a rule someone else stated that the user asks to check.",
            },
          },
        ],
      })

      // The best entry, never "none", with its probability.
      expect(yield* decide.corrects("The tests run with vitest now", given)).toEqual({ id: "mem_b", p: 0.7 })
      expect(fake.asked[1]?.input).toEqual([
        {
          type: "text",
          text: "Team notes from shared memory that an AI coding agent was shown:\n\n[mem_a] Deploys use wrangler\nRun wrangler deploy.\n\n[mem_b] Tests\nRun bun test.\n\nThe user's latest message to the agent:\n\nThe tests run with vitest now",
        },
      ])
      const choice = fake.asked[1]?.questions[0]
      expect(choice?.type === "choice" && choice.choices.map((item) => item.value)).toEqual(["none", "mem_a", "mem_b"])
      expect(choice?.type === "choice" && choice.choices[2]?.description).toBe(
        'The message says or implies that note mem_b ("Tests") is wrong, outdated or has changed.',
      )

      // Durable, and not mainly a record of one fix.
      expect(
        yield* decide.durable({ kind: "gotcha", title: "Dates are UTC", body: "Claim: x" }, "github.com/acme/app"),
      ).toBeCloseTo(0.6, 10)
      expect(fake.asked[2]?.questions.map((question) => question.name)).toEqual(["durable", "fix_record"])

      // At a failure, the command and the end of what it printed come with the task; whether the note applies and
      // whether it's a rule for all the repository's work are asked in one call.
      const output = `${"x".repeat(2500)}\nError: wrangler not found`
      expect(
        yield* decide.applies(
          { type: "failure", command: "bun run deploy", output, exitCode: 1 },
          "Deploy the worker",
          entry,
        ),
      ).toEqual({ applies: 0.66, repo: 0.3 })
      expect(fake.asked[3]?.input).toEqual([
        {
          type: "text",
          text: `Task given to an AI coding agent:\nDeploy the worker\n\nThe agent ran \`bun run deploy\` and it failed with:\n${output.slice(-2000)}\n\nNote from the team's shared memory (procedure): Deploys use wrangler\nRun wrangler deploy.`,
        },
      ])
      expect(fake.asked[3]?.questions.map((question) => question.name)).toEqual(["applies", "repo_wide"])

      // Before an action, the command about to run comes with the task.
      yield* decide.applies(
        { type: "action", action: "commit", command: "git commit -m wip" },
        "Deploy the worker",
        entry,
      )
      expect(fake.asked[4]?.input).toEqual([
        {
          type: "text",
          text: "Task given to an AI coding agent:\nDeploy the worker\n\nThe agent is about to run `git commit -m wip`.\n\nNote from the team's shared memory (procedure): Deploys use wrangler\nRun wrangler deploy.",
        },
      ])

      // Whether the repository's instructions already state the note, shown at most 12,000 characters of them.
      const instructions = `Use wrangler.\n${"y".repeat(13_000)}`
      expect(yield* decide.stated(instructions, entry)).toBe(0.2)
      expect(fake.asked[5]?.input).toEqual([
        {
          type: "text",
          text: `Instructions an AI coding agent was given for this repository:\n\n${instructions.slice(0, 12_000)}\n\nNote from the team's shared memory (procedure): Deploys use wrangler\nRun wrangler deploy.`,
        },
      ])
      expect(fake.asked[5]?.questions.map((question) => question.name)).toEqual(["stated"])
    }),
  )

  it.live("asks another model when config names one, and none when config turns decisions off", () =>
    Effect.gen(function* () {
      const fake = generation(() => Effect.succeed([predicate("lasting", 0.5)]))
      const clef = Model.Ref.make({ providerID: Provider.ID.make("cloudflare-workers-ai"), id: Model.ID.make("clef") })
      const on = OpencodeMemoryDecide.make({ decisions: fake.decisions, model: Effect.succeed(clef) })
      expect(yield* on.available).toBe(true)
      yield* on.lasting("hi")
      expect(fake.asked.map((request) => request.model)).toEqual([clef])
      // Without a model the judgements are off, and the caller can tell before asking.
      const off = OpencodeMemoryDecide.make({ decisions: fake.decisions, model: Effect.succeed(undefined) })
      expect(yield* off.available).toBe(false)
      expect(yield* off.lasting("hi")).toBeUndefined()
      expect(fake.asked).toHaveLength(1)
    }),
  )

  it.live("waits out a rate limit within the deadline", () =>
    Effect.gen(function* () {
      const fake = generation((_, index) =>
        index < 2 ? Effect.fail(limited) : Effect.succeed([predicate("lasting", 0.91)]),
      )
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
      expect(yield* decide.lasting("We squash merges")).toBe(0.91)
      expect(fake.asked).toHaveLength(3)
    }),
  )

  it.live("answers nothing for a model that doesn't resolve, a refusal or another failure", () =>
    Effect.gen(function* () {
      const fake = generation((request) => {
        const text = request.input[0]?.type === "text" ? request.input[0].text : ""
        if (text.includes("missing"))
          return Effect.fail(
            new ModelNotFoundError({
              providerID: "opencode",
              modelID: "jev-1.13",
              message: "No decision model opencode/jev-1.13",
            }),
          )
        if (text.includes("refused"))
          return Effect.succeed([{ type: "error", name: "lasting", reason: "refusal" } satisfies DecisionAnswer])
        return Effect.fail(
          new ProviderRequestError({ providerID: "opencode", reason: "provider", message: "down", status: 503 }),
        )
      })
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
      expect(yield* decide.lasting("missing")).toBeUndefined()
      expect(yield* decide.lasting("refused")).toBeUndefined()
      expect(yield* decide.lasting("down")).toBeUndefined()
      expect(yield* decide.corrects("down", given)).toBeUndefined()
      // Only a rate limit is waited out: every other failure is asked once.
      expect(fake.asked).toHaveLength(4)
    }),
  )

  it.effect("answers nothing once its five seconds are up", () =>
    Effect.gen(function* () {
      const fake = generation(() => Effect.never)
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
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
      const fake = generation(() =>
        Effect.gen(function* () {
          open++
          most = Math.max(most, open)
          yield* Deferred.await(release)
          open--
          return [predicate("lasting", 0.5)]
        }),
      )
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
      const all = yield* Effect.forEach([1, 2, 3, 4, 5, 6], (n) => decide.lasting(`message ${n}`), {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild({ startImmediately: true }))
      yield* eventually(
        Effect.sync(() => fake.asked.length),
        (count) => count === 4,
      )
      yield* Effect.promise(() => Bun.sleep(50))
      expect(fake.asked).toHaveLength(4)
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(all)).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
      expect(most).toBe(4)
    }),
  )
})
