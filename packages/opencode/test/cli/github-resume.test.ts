import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"
import {
  GITHUB_RUN_METADATA_KEY,
  GITHUB_RUN_RESUME_PROMPT,
  githubRunPrompt,
  shouldSendContinuation,
} from "../../src/cli/cmd/github"

// Same-runner retries resolve by workflow identity, not by "latest session".
const it = testEffect(Layer.mergeAll(Session.defaultLayer))

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const addMessage = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const info = yield* Session.use.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID,
      agent: "build",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
      time: { created: Date.now() },
    })
    yield* Session.use.updatePart({ id: PartID.ascending(), sessionID, messageID: info.id, type: "text", text: "hi" })
  })

// Mirrors the handler's session resolution against the real service.
const resolve = (runId: string) =>
  Effect.gen(function* () {
    const prior = yield* Session.use.findByMetadata({ key: GITHUB_RUN_METADATA_KEY, value: runId })
    const priorMessageCount = prior ? (yield* Session.use.messages({ sessionID: prior.id, limit: 1 })).length : 0
    return { prior, continuation: shouldSendContinuation({ foundPrior: prior !== undefined, priorMessageCount }) }
  })

describe("github run session resolution", () => {
  it.instance(
    "continues the prior session when it has recorded history",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        const runId = "gh-run-with-history"
        const created = yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: runId } })
        yield* addMessage(created.id)

        const { prior, continuation } = yield* resolve(runId)

        expect(prior?.id).toBe(created.id)
        expect(continuation).toBe(true)
      }),
    { git: true },
  )

  it.instance(
    "reuses the session but sends the full prompt when the prior attempt left no history",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        const runId = "gh-run-empty"
        const created = yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: runId } })

        const { prior, continuation } = yield* resolve(runId)

        // Found and reused, but no nudge: an attempt that died during setup has no
        // task in history, so the model must get the full prompt.
        expect(prior?.id).toBe(created.id)
        expect(continuation).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "starts fresh for a run id with no prior session",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: "gh-run-old" } })
        yield* Session.use.create({}) // unrelated, non-github session

        const { prior, continuation } = yield* resolve("gh-run-never-seen")

        expect(prior).toBeUndefined()
        expect(continuation).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "isolates sessions by run id",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        const a = yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: "gh-run-a" } })
        const b = yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: "gh-run-b" } })

        expect((yield* Session.use.findByMetadata({ key: GITHUB_RUN_METADATA_KEY, value: "gh-run-a" }))?.id).toBe(a.id)
        expect((yield* Session.use.findByMetadata({ key: GITHUB_RUN_METADATA_KEY, value: "gh-run-b" }))?.id).toBe(b.id)
      }),
    { git: true },
  )

  it.instance(
    "resumes the original session, not a fork that copied its run id",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        const runId = "gh-run-forked"
        const original = yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: runId } })
        yield* Effect.sleep("1 millis")
        // Forks copy metadata in this codebase, so the fork carries the same run id
        // and is not distinguishable by parentID (forks have none). The lookup must
        // still resolve to a single, deterministic session.
        const fork = yield* Session.use.fork({ sessionID: original.id })
        expect(fork.metadata?.[GITHUB_RUN_METADATA_KEY]).toBe(runId)

        const prior = yield* Session.use.findByMetadata({ key: GITHUB_RUN_METADATA_KEY, value: runId })
        expect(prior?.id).toBe(original.id)
      }),
    { git: true },
  )

  it.instance(
    "finds an old matching session without depending on the session list limit",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        const runId = "gh-run-old-match"
        const created = yield* Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: runId } })

        yield* Effect.all(
          Array.from({ length: 125 }, (_, index) =>
            Session.use.create({ metadata: { [GITHUB_RUN_METADATA_KEY]: `other-${index}` } }),
          ),
          { concurrency: 1 },
        )

        const prior = yield* Session.use.findByMetadata({ key: GITHUB_RUN_METADATA_KEY, value: runId })
        expect(prior?.id).toBe(created.id)
      }),
    { git: true },
  )
})

describe("shouldSendContinuation (pure)", () => {
  test("no prior session means full prompt", () => {
    expect(shouldSendContinuation({ foundPrior: false, priorMessageCount: 0 })).toBe(false)
  })

  test("prior session with no messages means full prompt", () => {
    expect(shouldSendContinuation({ foundPrior: true, priorMessageCount: 0 })).toBe(false)
  })

  test("prior session with history means continuation nudge", () => {
    expect(shouldSendContinuation({ foundPrior: true, priorMessageCount: 1 })).toBe(true)
  })
})

describe("githubRunPrompt", () => {
  test("keeps the full prompt and files for a fresh run", () => {
    const promptFiles = ["screenshot"]
    expect(githubRunPrompt({ continuation: false, message: "full prompt", promptFiles })).toEqual({
      message: "full prompt",
      promptFiles,
    })
  })

  test("sends only the continuation nudge when resuming a recorded attempt", () => {
    expect(githubRunPrompt({ continuation: true, message: "full prompt", promptFiles: ["screenshot"] })).toEqual({
      message: GITHUB_RUN_RESUME_PROMPT,
      promptFiles: [],
    })
  })
})
