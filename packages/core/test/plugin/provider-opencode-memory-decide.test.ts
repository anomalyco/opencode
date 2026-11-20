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
        if (question.name === "durable") return Effect.succeed([predicate("durable", 0.8)])
        return Effect.succeed([predicate("applies", 0.66)])
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

      // Durable: one question, its probability as it is.
      expect(
        yield* decide.durable({ kind: "gotcha", title: "Dates are UTC", body: "Claim: x" }, "github.com/acme/app"),
      ).toBe(0.8)
      expect(fake.asked[2]?.questions.map((question) => question.name)).toEqual(["durable"])

      // At a failure, the command and the end of what it printed come with the task.
      const output = `${"x".repeat(2500)}\nError: wrangler not found`
      expect(
        yield* decide.applies(
          { type: "failure", command: "bun run deploy", output, exitCode: 1 },
          "Deploy the worker",
          entry,
        ),
      ).toBe(0.66)
      expect(fake.asked[3]?.input).toEqual([
        {
          type: "text",
          text: `Task given to an AI coding agent:\nDeploy the worker\n\nThe agent ran \`bun run deploy\` and it failed with:\n${output.slice(-2000)}\n\nNote from the team's shared memory (procedure): Deploys use wrangler\nRun wrangler deploy.`,
        },
      ])
      expect(fake.asked[3]?.questions.map((question) => question.name)).toEqual(["applies"])
    }),
  )

  it.live(
    "asks whether a note is a rule for every change in the repository once per revision, as the bench framed it",
    () =>
      Effect.gen(function* () {
        const fake = generation((request) =>
          request.input[0]?.type === "text" && request.input[0].text.includes("Title: Flaky")
            ? Effect.fail(
                new ProviderRequestError({ providerID: "opencode", reason: "provider", message: "down", status: 503 }),
              )
            : Effect.succeed([predicate("repo_wide", 0.09)]),
        )
        const decide = OpencodeMemoryDecide.make({
          decisions: fake.decisions,
          model: Effect.succeed(OpencodeMemoryDecide.MODEL),
        })
        expect(yield* decide.repoWide(entry, "github.com/acme/app")).toBe(0.09)
        expect(fake.asked[0]?.input).toEqual([
          {
            type: "text",
            text: "Note from a team's shared memory about the github.com/acme/app repository:\n\nKind: procedure\nTitle: Deploys use wrangler\n\nRun wrangler deploy.",
          },
        ])
        expect(fake.asked[0]?.questions).toEqual([
          {
            type: "predicate",
            name: "repo_wide",
            instructions:
              "Does this note say how every change in this repository is made, checked or recorded, whatever code it touches, rather than describing particular code?",
            criteria: {
              true: "Yes when following the note is part of any task in this repository: how to commit, write commit messages, open PRs or record changes (changelog, news fragments); the commands, flags, interpreter or environment variables needed to run the tests, linters, type checks or docs build; which tools or package managers to use; a style rule for all code or all tests, such as how docstrings, exception messages or imports are written. Phrased as a gotcha or a procedure doesn't matter.",
              false:
                "No when the note is about particular code: a bug or its cause, how a particular function, module or feature behaves or must behave, a decision about one feature, steps that only apply when editing certain files, or one particular test's quirks (such as a flaky or slow test), even when written as a rule.",
            },
          },
        ])
        // The same revision isn't asked again; a new one is.
        expect(yield* decide.repoWide(entry, "github.com/acme/app")).toBe(0.09)
        expect(fake.asked).toHaveLength(1)
        yield* decide.repoWide({ ...entry, revision: 2 }, "github.com/acme/app")
        expect(fake.asked).toHaveLength(2)
        // An answer that couldn't be had isn't kept: it's asked again.
        const flaky = { ...entry, id: "mem_f", title: "Flaky" }
        expect(yield* decide.repoWide(flaky, "github.com/acme/app")).toBeUndefined()
        expect(yield* decide.repoWide(flaky, "github.com/acme/app")).toBeUndefined()
        expect(fake.asked).toHaveLength(4)
        expect(OpencodeMemoryDecide.REPO_WIDE).toBe(0.08)
      }),
  )

  it.live("takes a note the instructions hold verbatim as stated without asking, and asks the decision otherwise", () =>
    Effect.gen(function* () {
      const fake = generation((request) => {
        const text = request.input[0]?.type === "text" ? request.input[0].text : ""
        if (text.includes("Broken"))
          return Effect.fail(
            new ProviderRequestError({ providerID: "opencode", reason: "provider", message: "down", status: 503 }),
          )
        return Effect.succeed([
          predicate(
            "already_stated",
            text.includes("Paraphrased") ? 0.95 : text.includes("Contradicting") ? 0.02 : 0.93,
          ),
        ])
      })
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
      const instructions =
        "# AGENTS.md\n\n## Commit messages, written as follows\nRun the tests with: TZ=UTC bun run test --bail from the package!"
      // The start of its body, normalised, is in them.
      expect(
        yield* decide.stated(instructions, {
          ...entry,
          title: "Tests",
          body: "Run the tests with TZ=UTC bun run test --bail from the package, always.",
        }),
      ).toBe(true)
      expect(fake.asked).toHaveLength(0)
      // A body under 30 characters doesn't count.
      expect(OpencodeMemoryDecide.verbatim("tests and more", { body: "tests and more" })).toBe(false)
      // A title alone isn't enough: an entry contradicting the section it shares a title with is the decision's.
      const contradicting = {
        ...entry,
        title: "Commit Messages -- written as follows",
        body: "Contradicting: commit messages end with a period.",
      }
      expect(yield* decide.stated(instructions, contradicting)).toBe(false)
      expect(fake.asked).toHaveLength(1)

      // Otherwise the decision, at 0.94 or above, framed as the bench framed it with the end of the instructions cut.
      const long = `${instructions}\n${"y".repeat(13_000)}`
      expect(yield* decide.stated(long, { ...entry, title: "Paraphrased rule" })).toBe(true)
      expect(fake.asked[1]?.input).toEqual([
        {
          type: "text",
          text: `Repository instructions (AGENTS.md):\n\n${long.slice(0, 12_000)}\n\nNote from the team's shared memory:\nParaphrased rule\nRun wrangler deploy.`,
        },
      ])
      expect(fake.asked[1]?.questions).toEqual([
        {
          type: "predicate",
          name: "already_stated",
          instructions:
            "Does some part of these repository instructions already tell the agent what this note tells it, even in different words?",
          criteria: {
            true: "Some instruction gives the same rule, command, setting or action as the note's main point, worded differently or with a different example: for instance the same test command or environment variable, the same commit or changelog rule, the same instruction about a flaky test. Extra detail in the note, such as the reason, an error message it prints, or an alternative way to do the same thing, doesn't count as new.",
            false:
              "The instructions never give the note's main rule, command, setting or action: they cover other topics, mention the topic without the note's specific requirement, or say the opposite of the note.",
          },
        },
      ])
      expect(yield* decide.stated(long, { ...entry, title: "Another rule" })).toBe(false)
      expect(yield* decide.stated(long, { ...entry, title: "Broken rule" })).toBeUndefined()
    }),
  )

  it.live("asks which given note the user's message asks to forget, as D2 asks which it corrects", () =>
    Effect.gen(function* () {
      const fake = generation(() =>
        Effect.succeed([
          {
            type: "choice",
            name: "forgets",
            choice: "none",
            confidence: 0.6,
            probabilities: [
              { value: "none", probability: 0.6 },
              { value: "mem_a", probability: 0.1 },
              { value: "mem_b", probability: 0.3 },
            ],
          } satisfies DecisionAnswer,
        ]),
      )
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
      // The best note, never "none", with its probability; the caller holds it to the cut.
      expect(yield* decide.forgets("Forget the tests note", given)).toEqual({ id: "mem_b", p: 0.3 })
      expect(OpencodeMemoryDecide.FORGETS).toBe(0.5)
      expect(fake.asked[0]?.input).toEqual([
        {
          type: "text",
          text: "Team notes from shared memory that an AI coding agent was shown:\n\n[mem_a] Deploys use wrangler\nRun wrangler deploy.\n\n[mem_b] Tests\nRun bun test.\n\nThe user's message to the agent:\n\nForget the tests note",
        },
      ])
      const choice = fake.asked[0]?.questions[0]
      expect(choice?.name).toBe("forgets")
      expect(choice?.type === "choice" && choice.choices.map((item) => item.value)).toEqual(["none", "mem_a", "mem_b"])
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

  it.effect("tallies the decisions asked within counted: those that failed, ran out of time, and the 429s met", () =>
    Effect.gen(function* () {
      let limits = 0
      const fake = generation((request) => {
        const text = request.input[0]?.type === "text" ? request.input[0].text : ""
        if (text.includes("slow")) return Effect.never
        if (text.includes("down"))
          return Effect.fail(
            new ProviderRequestError({ providerID: "opencode", reason: "provider", message: "down", status: 503 }),
          )
        if (text.includes("limited") && limits++ < 2) return Effect.fail(limited)
        return Effect.succeed([predicate("lasting", 0.91)])
      })
      const decide = OpencodeMemoryDecide.make({
        decisions: fake.decisions,
        model: Effect.succeed(OpencodeMemoryDecide.MODEL),
      })
      const tallies = new Array<OpencodeMemoryDecide.Tally>()
      const pending = yield* decide
        .counted(
          Effect.all(["limited", "down", "slow", "fine"].map(decide.lasting), { concurrency: "unbounded" }),
          (tally) => Effect.sync(() => tallies.push({ ...tally })),
        )
        .pipe(Effect.forkChild({ startImmediately: true }))
      yield* eventually(
        Effect.sync(() => fake.asked.length),
        (count) => count === 4,
      )
      yield* TestClock.adjust("200 millis")
      yield* eventually(
        Effect.sync(() => fake.asked.length),
        (count) => count === 5,
      )
      yield* TestClock.adjust("400 millis")
      yield* eventually(
        Effect.sync(() => fake.asked.length),
        (count) => count === 6,
      )
      yield* TestClock.adjust("4400 millis")
      // The answers are what they'd be uncounted.
      expect(yield* Fiber.join(pending)).toEqual([0.91, undefined, undefined, 0.91])
      expect(tallies).toEqual([{ asked: 4, failed: 2, timedOut: 1, rateLimited: 2, ms: 5000 }])
      // Outside it nothing is tallied.
      yield* decide.lasting("down")
      expect(tallies).toHaveLength(1)
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
