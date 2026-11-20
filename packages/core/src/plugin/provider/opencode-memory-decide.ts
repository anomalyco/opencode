export * as OpencodeMemoryDecide from "./opencode-memory-decide.js"

import type { Context } from "@opencode/plugin/effect/plugin"
import type { DecisionQuestion, DecisionResult } from "@opencode/schema/generate"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Clock, Effect, Schedule, Semaphore } from "effect"
import { ProviderRequestError } from "../../generate.js"
import type { OpencodeMemoryCapture } from "./opencode-memory-capture.js"
import type { OpencodeMemoryPolicy } from "./opencode-memory-policy.js"

/** The decision model the questions and thresholds below were chosen on, unless config names another. */
export const MODEL = Model.Ref.make({ providerID: Provider.ID.make("opencode"), id: Model.ID.make("jev-1.13") })
/** How much of the repository's instructions D5 is shown: an AGENTS.md of about 3,000 tokens. */
const MAX_INSTRUCTIONS = 12_000
/** The longest a decision may take; past it the caller does what it does without one. */
const DEADLINE = "5 seconds"

// Thresholds chosen on a labelled bench (2026-11-19) at each question's precision point.
/** D1.z0: the message states a lasting rule, decision or correction. */
export const LASTING = 0.7
/** D2.z0: the message corrects the given entry with the highest probability. */
export const CORRECTS = 0.5
/** D3.t2: a distilled candidate is a durable lesson, not a note about one task. */
export const DURABLE = 0.574
/** D4.t3: an entry applies to the task, or the failure, at hand. */
export const APPLIES = 0.64
/** D4b: an entry is a rule or procedure for all work in its repository. A placeholder until it's set from labels. */
export const REPO_WIDE = 0.5
/** D5: the repository's loaded instructions already state what an entry says. A placeholder until it's set from labels. */
export const STATED = 0.5

/** A yes-or-no question, scored by the probability of yes. */
const predicate = (name: string, instructions: string, yes: string, no: string): DecisionQuestion => ({
  type: "predicate",
  name,
  instructions,
  criteria: { true: yes, false: no },
})

const D1 = predicate(
  "lasting",
  "Does this message state something that should hold for future work in this repository beyond the current task, such as a team rule, convention or decision, or a correction of a standing practice?",
  "The message states a lasting team rule, convention or decision, corrects or reverses a standing practice or an earlier rule, or asserts a durable fact about how the team or repository works. It counts even when the same message also asks for a task.",
  "Everything in the message is about the current task only: a request for this change (even with words like always, never, must or don't describing the requested behaviour), a temporary constraint, a correction of the agent's current work, a preference for this conversation, a question, or a rule someone else stated that the user asks to check.",
)

const D3 = [
  predicate(
    "durable",
    "Would an agent working on a different, later task in this repository need this note, or does it only record this one task?",
    "Durable: a team rule, decision or convention (including one the user stated or reversed); how to run, build, lint or test this repository and its environment requirements; a known flaky or broken test and what to do about it; a pitfall or behaviour of existing code that other changes to that area would hit.",
    "Task-specific: the requirements or intended behaviour of the function or feature this task changed, how this one fix works or why it was needed, what the change did or its status, measurements or profiling of this task, or something only true today, even when written as a general rule.",
  ),
  predicate(
    "fix_record",
    "Is this note mainly a record of one specific fix or feature: the bug it fixed, the behaviour it made a function have, or how the change was implemented?",
    "The note's core is the behaviour or implementation of a particular change to particular code (what was wrong in a function and what it does now, or what was built), so it mostly restates the task.",
    "The note's core is a rule, procedure, environment fact, test-suite fact or pitfall that holds independently of any one change.",
  ),
]

const D4 = predicate(
  "applies",
  "Is this note specifically about what this task has to change, or about the failure just seen, so that reading it helps the agent do this task correctly?",
  "The note's own subject is the code, behaviour, rule or error this task deals with: it names the function, module, behaviour or failure the task is about; or it explains the exact error shown in the failure output and how to get past it (a required setting, command or procedure whose error text matches); or it is a team rule every change of this kind must follow (such as how changes are recorded). What it says agrees with what the task asks for.",
  "The note's subject is something else: another function, feature or bug in the same repository or file; general advice on running tests, linting, tooling or the environment that doesn't explain the error shown; or advice that conflicts with the behaviour or results the task explicitly asks for (a note saying to keep behaviour the task asks to change is misleading, not applicable).",
)

const D4b = predicate(
  "repo_wide",
  "Is this note a rule, convention or procedure that holds for all work in this repository, rather than a fact about particular code?",
  "The note states how all work in this repository is done: how commits, pull requests or changelogs are written, which commands build, lint or run the tests, which tools, package managers or styles to use, or another house rule any change here must follow.",
  "The note is about particular code: a function, module, feature, bug, error or file, a one-off situation, or general advice not specific to this repository.",
)

const D5 = predicate(
  "stated",
  "Do the repository's instructions already state what this note says?",
  "Everything the note tells an agent to do or know is already stated in the instructions, in the same or other words, so reading the note adds nothing.",
  "The note adds something the instructions don't state: a rule, command, fact or detail missing from them, or one that differs from what they say.",
)

/** Decisions in flight across this process, as Console's rate limit allows. */
const slots = Semaphore.makeUnsafe(4)

/**
 * The plugin's judgements, asked of a decision model through OpenCode's own decision generation, with the user's
 * credentials for its provider: `model` names it, or undefined when there's none, and then the judgements are off
 * (`available` says which). Each answers undefined when it can't be had (a refusal, a rate limit that outlasts the
 * deadline, the deadline itself or any other failure), which the caller takes as a no for that item.
 */
export const make = (input: {
  readonly decisions: Context["experimental"]["generate"]["decisions"]
  readonly model: Effect.Effect<Model.Ref | undefined>
}) => {
  const ask = (state: string, questions: ReadonlyArray<DecisionQuestion>) =>
    Effect.gen(function* () {
      const started = yield* Clock.currentTimeMillis
      const answers = yield* Effect.gen(function* () {
        const model = yield* input.model
        if (model === undefined) return undefined
        const result = yield* input.decisions({ model, input: [{ type: "text", text: state }], questions }).pipe(
          // A provider's rate limit clears within moments: wait, then ask again, within the deadline.
          Effect.retry({
            while: (cause) => cause instanceof ProviderRequestError && cause.status === 429,
            schedule: Schedule.exponential("200 millis"),
          }),
        )
        return result.answers
      }).pipe(
        slots.withPermit,
        Effect.timeout(DEADLINE),
        Effect.catchCause(() => Effect.succeed(undefined)),
      )
      const ms = (yield* Clock.currentTimeMillis) - started
      return { answers, ms }
    })
  const probability = (answers: DecisionResult["answers"] | undefined, name: string) => {
    const answer = answers?.find((item) => item.name === name)
    return answer?.type === "predicate" ? answer.probability : undefined
  }
  const logged = (
    question: string,
    ms: number,
    probability: number | undefined,
    extra: Record<string, unknown> = {},
  ) =>
    probability === undefined
      ? Effect.logDebug("memory decision failed, taken as no", { question, ms, ...extra })
      : Effect.logDebug("memory decision", { question, probability, ms, ...extra })

  return {
    /** Whether a decision model resolves, so the judgements that need one are on. */
    available: input.model.pipe(Effect.map((model) => model !== undefined)),
    /** D1: the probability that a user's message states a lasting team rule, decision or correction. */
    lasting: (message: string) =>
      Effect.gen(function* () {
        const result = yield* ask(
          `Latest message from a user to an AI coding agent working in their repository:\n\n${message}`,
          [D1],
        )
        const p = probability(result.answers, "lasting")
        yield* logged("D1.z0", result.ms, p)
        return p
      }),
    /** D2: the given entry a user's message corrects, by its probability, or none; one id at most. */
    corrects: (message: string, given: ReadonlyArray<OpencodeMemoryPolicy.Given>) =>
      Effect.gen(function* () {
        const notes = given.map((entry) => `[${entry.id}] ${entry.title}\n${entry.text}`).join("\n\n")
        const result = yield* ask(
          `Team notes from shared memory that an AI coding agent was shown:\n\n${notes}\n\nThe user's latest message to the agent:\n\n${message}`,
          [
            {
              type: "choice",
              name: "corrects",
              instructions:
                "Which of the team notes, if any, does the user's message correct, saying or implying that what the note states is wrong, outdated or has changed?",
              choices: [
                {
                  value: "none",
                  description:
                    "The message corrects none of the notes: it mentions, follows or asks about a note, corrects only the agent's own work, asks for a task, or changes a rule that no note states.",
                },
                ...given.map((entry) => ({
                  value: entry.id,
                  description: `The message says or implies that note ${entry.id} ("${entry.title}") is wrong, outdated or has changed.`,
                })),
              ],
            },
          ],
        )
        const answer = result.answers?.find((item) => item.name === "corrects")
        const best =
          answer?.type === "choice"
            ? answer.probabilities
                .filter((item) => item.value !== "none" && typeof item.value === "string")
                .reduce<{
                  id?: string
                  p: number
                }>((top, item) => (item.probability > top.p ? { id: String(item.value), p: item.probability } : top), {
                  p: 0,
                })
            : undefined
        yield* logged("D2.z0", result.ms, best?.p, best?.id === undefined ? {} : { entry: best.id })
        return best
      }),
    /** D3: the probability a distilled candidate is a durable lesson, not a record of one fix. */
    durable: (candidate: OpencodeMemoryCapture.Candidate, repo: string) =>
      Effect.gen(function* () {
        const result = yield* ask(
          `Candidate lesson for a team's shared memory, written after an AI coding agent's task in the ${repo} repository:\n\nKind: ${candidate.kind}\nTitle: ${candidate.title}\n\n${candidate.body}`,
          D3,
        )
        const durable = probability(result.answers, "durable")
        const fix = probability(result.answers, "fix_record")
        const p = durable === undefined || fix === undefined ? undefined : durable * (1 - fix)
        yield* logged("D3.t2", result.ms, p)
        return p
      }),
    /**
     * D4 and D4b, in one call: the probability an entry applies to the task at hand, the failure just seen or the
     * action about to run, and the probability it's a rule or procedure for all work in the repository.
     */
    applies: (moment: OpencodeMemoryPolicy.Moment, task: string, entry: OpencodeMemoryPolicy.Injected) =>
      Effect.gen(function* () {
        const happening =
          moment.type === "failure"
            ? `\n\nThe agent ran \`${moment.command}\` and it failed with:\n${moment.output.slice(-2000)}`
            : moment.type === "action"
              ? `\n\nThe agent is about to run \`${moment.command}\`.`
              : ""
        const result = yield* ask(
          `Task given to an AI coding agent:\n${task}${happening}\n\nNote from the team's shared memory (${entry.kind}): ${entry.title}\n${entry.body.slice(0, 3000)}`,
          [D4, D4b],
        )
        const applies = probability(result.answers, "applies")
        const repo = probability(result.answers, "repo_wide")
        yield* logged("D4.t3", result.ms, applies, { entry: entry.id })
        yield* logged("D4b", result.ms, repo, { entry: entry.id })
        return { applies, repo }
      }),
    /** D5: the probability the repository's loaded instructions already state what an entry says. */
    stated: (instructions: string, entry: OpencodeMemoryPolicy.Injected) =>
      Effect.gen(function* () {
        const result = yield* ask(
          `Instructions an AI coding agent was given for this repository:\n\n${instructions.slice(0, MAX_INSTRUCTIONS)}\n\nNote from the team's shared memory (${entry.kind}): ${entry.title}\n${entry.body.slice(0, 3000)}`,
          [D5],
        )
        const p = probability(result.answers, "stated")
        yield* logged("D5", result.ms, p, { entry: entry.id })
        return p
      }),
  }
}

export type Decide = ReturnType<typeof make>
