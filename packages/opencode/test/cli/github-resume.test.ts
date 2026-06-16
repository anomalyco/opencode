import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Session } from "@/session/session"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"
import { testEffect } from "../lib/effect"
import { findResumableSession, GITHUB_RUN_METADATA_KEY, shouldSendContinuation } from "../../src/cli/cmd/github"

// `opencode github run` stamps GITHUB_RUN_ID into session metadata at creation
// and, on a retry within the same runner (a wrapper re-spawn after a transient
// failure), looks the prior session up by that key to continue rather than start
// fresh. The resolution sequence in the handler is: list -> findResumableSession
// -> count prior messages -> shouldSendContinuation. These tests drive that exact
// sequence against the real Session service and SQLite so the metadata round-trip
// and the empty-session fallback are what's verified, not hand-built stand-ins.
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
    const prior = findResumableSession(yield* Session.use.list(), runId)
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

        const sessions = yield* Session.use.list()
        expect(findResumableSession(sessions, "gh-run-a")?.id).toBe(a.id)
        expect(findResumableSession(sessions, "gh-run-b")?.id).toBe(b.id)
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
        // Forks copy metadata in this codebase, so the fork carries the same run id
        // and is not distinguishable by parentID (forks have none). The lookup must
        // still resolve to a single, deterministic session.
        const fork = yield* Session.use.fork({ sessionID: original.id })
        expect(fork.metadata?.[GITHUB_RUN_METADATA_KEY]).toBe(runId)

        const sessions = yield* Session.use.list()
        const matches = sessions.filter((s) => s.metadata?.[GITHUB_RUN_METADATA_KEY] === runId)
        expect(matches.length).toBe(2)

        const earliest = matches.reduce((a, b) => (a.time.created <= b.time.created ? a : b))
        expect(findResumableSession(sessions, runId)?.id).toBe(earliest.id)
      }),
    { git: true },
  )
})

describe("findResumableSession (pure)", () => {
  test("picks the earliest-created session when several share a run id", () => {
    const runId = "dup"
    const sessions = [
      { id: "later", metadata: { [GITHUB_RUN_METADATA_KEY]: runId }, time: { created: 200 } },
      { id: "original", metadata: { [GITHUB_RUN_METADATA_KEY]: runId }, time: { created: 100 } },
      { id: "unrelated", metadata: { [GITHUB_RUN_METADATA_KEY]: "other" }, time: { created: 50 } },
    ]
    expect(findResumableSession(sessions, runId)?.id).toBe("original")
  })

  test("returns undefined when no session carries the run id", () => {
    const sessions = [{ id: "x", metadata: { [GITHUB_RUN_METADATA_KEY]: "a" }, time: { created: 1 } }]
    expect(findResumableSession(sessions, "b")).toBeUndefined()
  })
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
