import { describe, expect, test } from "bun:test"
import { Deferred, Effect, Exit, Fiber } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { AttachmentCoordinator } from "@/session/attachment/coordinator"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { SessionClosurePorts as Ports } from "@/session/closure/ports"
import { runAttached } from "../lib/attachment"
import type { TaskSelectedReturn } from "@/session/task-return"

const modelID = ModelV2.ID.make("test")
const providerID = ProviderV2.ID.make("test")
const fenceRef = () => Object.freeze(Object.create(null)) as Ports.ParticipantFenceRef

function assistant(sessionID: SessionID, value: string): SessionV1.WithParts {
  const messageID = MessageID.ascending()
  return {
    info: {
      id: messageID,
      role: "assistant",
      parentID: MessageID.ascending(),
      sessionID,
      mode: "test",
      agent: "test",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID,
      providerID,
      time: { created: Date.now(), completed: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID,
        sessionID,
        type: "text",
        text: value,
      },
    ],
  }
}

function selectedAssistant(value: TaskSelectedReturn) {
  if (value.type === "cancelled") return undefined
  if (!value.candidate && !value.observed) return value.fallback
  if (!value.candidate) return value.observed!.assistant
  if (!value.observed) return value.candidate.assistant
  return value.observed.order > value.candidate.order ? value.observed.assistant : value.candidate.assistant
}

function selectedText(value: TaskSelectedReturn) {
  return selectedAssistant(value)?.parts.findLast((part) => part.type === "text")?.text
}

const owner = Effect.fn("AttachmentCoordinatorTest.owner")(function* (
  scope: AttachmentCoordinator.Scope,
  reservation: AttachmentCoordinator.Reservation,
) {
  const claim = yield* scope.claimObserver(reservation)
  if (claim.type !== "owner") return yield* Effect.die(`expected owner, got ${claim.type}`)
})

const markTerminal = Effect.fn("AttachmentCoordinatorTest.markTerminal")(function* (
  scope: AttachmentCoordinator.Scope,
  reservation: AttachmentCoordinator.Reservation,
) {
  const marker = yield* scope.terminal(reservation)
  if (!marker) return yield* Effect.die("terminal transition was suppressed")
  return marker
})

describe("attachment coordinator", () => {
  test("isScope requires all five duck-typed methods including literal result", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        expect(AttachmentCoordinator.isScope(scope)).toBe(true)

        for (const key of ["observeTurn", "claimObserver", "settleTerminal", "degrade", "result"] as const) {
          const confusable = { ...scope } as Record<string, unknown>
          delete confusable[key]
          expect(AttachmentCoordinator.isScope(confusable)).toBe(false)
        }

        const renamed = { ...scope, resultValue: scope.result } as Record<string, unknown>
        delete renamed.result
        expect(AttachmentCoordinator.isScope(renamed)).toBe(false)
        yield* scope.close()
      }),
    )
  })

  test("reject removes a fresh reservation without creating attachment history", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())

        expect(scope.current()).toMatchObject({ epoch: 1, attached: 1, everAttached: false })
        yield* scope.reject(reservation)
        expect(scope.current()).toMatchObject({ epoch: 1, attached: 0, undelivered: 0, everAttached: false })
        expect(selectedText(yield* scope.result(assistant(scope.sessionID, "ordinary")))).toBe("ordinary")
        yield* scope.close()
      }),
    )
  })

  test("one child lifetime has one observer across same-ID reservations", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const jobID = SessionID.create()
        const first = yield* scope.reserve(jobID)
        const second = yield* scope.reserve(jobID)

        expect(second.token).toBe(first.token)
        expect((yield* scope.claimObserver(first)).type).toBe("owner")
        expect((yield* scope.claimObserver(second)).type).toBe("existing")
        expect(scope.current()).toMatchObject({ attached: 1, everAttached: true })
        yield* scope.claimCancellation("cancelled")
        yield* scope.finishContinuation()
        yield* scope.close()
      }),
    )
  })

  test("a claimed cohort token survives J -> U settlement for a late same-cohort reservation", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const jobID = SessionID.create()
        const first = yield* scope.reserve(jobID)
        const second = yield* scope.reserve(jobID)
        expect(second.token).toBe(first.token)

        yield* owner(scope, first)
        const marker = yield* markTerminal(scope, first)
        yield* scope.settleTerminal(marker)
        expect(scope.current()).toMatchObject({ attached: 0, undelivered: 0, failed: false })

        expect(yield* scope.claimObserver(second)).toEqual({ type: "existing" })
        expect(scope.current().failed).toBe(false)

        // Reusing the public child Session ID after terminalization creates a genuinely new cohort
        // token, which remains independently eligible for one observer election.
        const later = yield* scope.reserve(jobID)
        expect(later.token).not.toBe(first.token)
        expect((yield* scope.claimObserver(later)).type).toBe("owner")
        expect(scope.current().failed).toBe(false)

        yield* scope.finishContinuation()
        yield* scope.finishContinuation()
        yield* scope.close()
      }),
    )
  })

  test("degraded same-ID reservations atomically elect one fallback without creating active history", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const jobID = SessionID.create()
        const first = yield* scope.reserve(jobID)
        const second = yield* scope.reserve(jobID)

        yield* scope.degrade()
        expect(yield* scope.claimObserver(first)).toEqual({ type: "fallback" })
        expect(yield* scope.claimObserver(second)).toEqual({ type: "existing" })
        expect(scope.current()).toMatchObject({ attached: 1, everAttached: false, failed: true })

        // No active count was manufactured for fallback ownership, so degraded best evidence can
        // resolve even while the retained J marker remains as diagnostic state.
        const value = yield* scope.result(assistant(scope.sessionID, "best evidence"))
        expect(value).toMatchObject({ type: "evidence", degraded: true })
        expect(selectedText(value)).toBe("best evidence")
        yield* scope.close()
      }),
    )
  })

  test("absent removes J and returns the best observation only after active finalization", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "best observed output"), clean: true })
        yield* scope.absent(reservation)
        expect(scope.current()).toMatchObject({ attached: 0, failed: true, candidate: true })

        const done = yield* Deferred.make<void>()
        const result = yield* scope
          .result(assistant(scope.sessionID, "fallback"))
          .pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
        expect(yield* Deferred.isDone(done)).toBe(false)
        yield* scope.finishContinuation()
        const value = yield* Fiber.join(result)
        expect(value).toMatchObject({ type: "evidence", degraded: true })
        expect(selectedText(value)).toBe("best observed output")
        yield* scope.close()
      }),
    )
  })

  test("a held parent prompt preserves J -> U -> persist -> settle -> active-release ordering", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)

        const marker = yield* markTerminal(scope, reservation)
        expect(scope.current()).toMatchObject({ attached: 0, undelivered: 1, candidate: false })

        const promptStarted = yield* Deferred.make<void>()
        const promptRelease = yield* Deferred.make<void>()
        const settled = yield* Deferred.make<void>()
        const finishRelease = yield* Deferred.make<void>()
        const parentPrompt = yield* Effect.gen(function* () {
          yield* Deferred.succeed(promptStarted, undefined)
          yield* Deferred.await(promptRelease)
          yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "parent result"), clean: true })
          yield* scope.settleTerminal(marker)
          yield* Deferred.succeed(settled, undefined)
          yield* Deferred.await(finishRelease)
        }).pipe(Effect.ensuring(scope.finishContinuation()), Effect.forkChild)

        const done = yield* Deferred.make<void>()
        const result = yield* scope
          .result(assistant(scope.sessionID, "fallback"))
          .pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
        yield* Deferred.await(promptStarted)

        // The parent prompt is held after terminal observation: U=1 and active=1 jointly block result.
        expect(yield* Deferred.isDone(done)).toBe(false)
        expect(scope.current()).toMatchObject({ undelivered: 1, candidate: false })

        yield* Deferred.succeed(promptRelease, undefined)
        yield* Deferred.await(settled)
        expect(scope.current()).toMatchObject({ undelivered: 0, candidate: true })
        // U is settled only after persistence, but active remains held until the observer finalizer.
        expect(yield* Deferred.isDone(done)).toBe(false)

        yield* Deferred.succeed(finishRelease, undefined)
        yield* Fiber.join(parentPrompt)
        expect(selectedText(yield* Fiber.join(result))).toBe("parent result")
        yield* scope.close()
      }),
    )
  })

  test("a paused child with an outstanding descendant cannot outrank the done answer after its terminal", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const descendant = yield* scope.reserve(SessionID.create())
        yield* owner(scope, descendant)
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "paused with descendant"), clean: true })

        const done = yield* Deferred.make<void>()
        const result = yield* scope
          .result(assistant(scope.sessionID, "fallback"))
          .pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
        expect(yield* Deferred.isDone(done)).toBe(false)

        const marker = yield* markTerminal(scope, descendant)
        expect(scope.current()).toMatchObject({ attached: 0, undelivered: 1, candidate: false })
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "done child answer"), clean: true })
        yield* scope.settleTerminal(marker)
        expect(yield* Deferred.isDone(done)).toBe(false)
        yield* scope.finishContinuation()

        expect(selectedText(yield* Fiber.join(result))).toBe("done child answer")
        yield* scope.close()
      }),
    )
  })

  test("settleTerminal is exact and stale or repeated markers are no-ops", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const first = yield* coordinator.open(SessionID.create())
        const reservation = yield* first.reserve(SessionID.create())
        yield* owner(first, reservation)
        const marker = yield* markTerminal(first, reservation)

        const second = yield* coordinator.open(SessionID.create())
        const secondReservation = yield* second.reserve(SessionID.create())
        yield* owner(second, secondReservation)
        const secondMarker = yield* markTerminal(second, secondReservation)

        yield* second.settleTerminal(marker)
        expect(second.current().undelivered).toBe(1)
        yield* second.settleTerminal(secondMarker)
        yield* second.settleTerminal(secondMarker)
        expect(second.current().undelivered).toBe(0)

        yield* first.settleTerminal(marker)
        yield* first.finishContinuation()
        yield* second.finishContinuation()
        yield* first.close()
        yield* second.close()
      }),
    )
  })

  test("wake is epoch-deduplicated and keeps result blocked until the wake and continuation finish", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        const marker = yield* markTerminal(scope, reservation)
        yield* scope.settleTerminal(marker)

        expect(scope.needsWake()).toBe(true)
        expect(yield* scope.beginWake()).toBe(true)
        expect(yield* scope.beginWake()).toBe(false)
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "wake result"), clean: true })
        expect(scope.needsWake()).toBe(false)

        const done = yield* Deferred.make<void>()
        const result = yield* scope
          .result(assistant(scope.sessionID, "fallback"))
          .pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
        yield* scope.endWake()
        expect(yield* Deferred.isDone(done)).toBe(false)
        yield* scope.finishContinuation()
        expect(selectedText(yield* Fiber.join(result))).toBe("wake result")
        yield* scope.close()
      }),
    )
  })

  test("a new epoch can begin a fresh wake", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const first = yield* scope.reserve(SessionID.create())
        yield* owner(scope, first)
        yield* scope.settleTerminal(yield* markTerminal(scope, first))
        expect(yield* scope.beginWake()).toBe(true)
        yield* scope.endWake()
        expect(yield* scope.beginWake()).toBe(false)

        const second = yield* scope.reserve(SessionID.create())
        yield* owner(scope, second)
        yield* scope.settleTerminal(yield* markTerminal(scope, second))
        expect(yield* scope.beginWake()).toBe(true)
        yield* scope.endWake()
        yield* scope.finishContinuation()
        yield* scope.finishContinuation()
        yield* scope.close()
      }),
    )
  })

  test("stale wake exhaustion cannot degrade a newer epoch", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const first = yield* scope.reserve(SessionID.create())
        yield* owner(scope, first)
        yield* scope.settleTerminal(yield* markTerminal(scope, first))
        expect(yield* scope.beginWake()).toBe(true)

        const second = yield* scope.reserve(SessionID.create())
        yield* owner(scope, second)
        yield* scope.settleTerminal(yield* markTerminal(scope, second))
        yield* scope.exhaustWake()
        expect(scope.current().failed).toBe(false)

        yield* scope.endWake()
        expect(yield* scope.beginWake()).toBe(true)
        yield* scope.endWake()
        yield* scope.finishContinuation()
        yield* scope.finishContinuation()
        yield* scope.close()
      }),
    )
  })

  test("a new reservation invalidates an older clean candidate", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const first = yield* scope.reserve(SessionID.create())
        yield* owner(scope, first)
        yield* scope.settleTerminal(yield* markTerminal(scope, first))
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "old candidate"), clean: true })
        expect(scope.current().candidate).toBe(true)

        const second = yield* scope.reserve(SessionID.create())
        expect(scope.current().candidate).toBe(false)
        yield* scope.reject(second)
        yield* scope.finishContinuation()
        yield* scope.close()
      }),
    )
  })

  test("own and reserve clear older non-clean observed evidence", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make

        const owned = yield* coordinator.open(SessionID.create())
        yield* owned.observeTurn({ assistant: assistant(owned.sessionID, "owned observation"), clean: false })
        yield* owned.own(MessageID.ascending())
        expect(selectedText(yield* owned.result(assistant(owned.sessionID, "owned fallback")))).toBe("owned fallback")
        yield* owned.close()

        const reserved = yield* coordinator.open(SessionID.create())
        yield* reserved.observeTurn({ assistant: assistant(reserved.sessionID, "reserved observation"), clean: false })
        const reservation = yield* reserved.reserve(SessionID.create())
        yield* reserved.reject(reservation)
        expect(selectedText(yield* reserved.result(assistant(reserved.sessionID, "reserved fallback")))).toBe(
          "reserved fallback",
        )
        yield* reserved.close()
      }),
    )
  })

  test("claimObserver and terminal clear older non-clean observed evidence", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make

        const claimed = yield* coordinator.open(SessionID.create())
        const claimedReservation = yield* claimed.reserve(SessionID.create())
        yield* claimed.observeTurn({ assistant: assistant(claimed.sessionID, "claimed observation"), clean: false })
        yield* owner(claimed, claimedReservation)
        yield* claimed.degrade()
        const claimedResult = yield* claimed
          .result(assistant(claimed.sessionID, "claimed fallback"))
          .pipe(Effect.forkChild)
        yield* claimed.finishContinuation()
        expect(selectedText(yield* Fiber.join(claimedResult))).toBe("claimed fallback")
        yield* claimed.close()

        const terminal = yield* coordinator.open(SessionID.create())
        const terminalReservation = yield* terminal.reserve(SessionID.create())
        yield* owner(terminal, terminalReservation)
        yield* terminal.observeTurn({ assistant: assistant(terminal.sessionID, "terminal observation"), clean: false })
        yield* terminal.terminal(terminalReservation)
        yield* terminal.degrade()
        const terminalResult = yield* terminal
          .result(assistant(terminal.sessionID, "terminal fallback"))
          .pipe(Effect.forkChild)
        yield* terminal.finishContinuation()
        expect(selectedText(yield* Fiber.join(terminalResult))).toBe("terminal fallback")
        yield* terminal.close()
      }),
    )
  })

  test("cancellation exposes no older non-clean observed evidence", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "cancelled observation"), clean: false })
        yield* scope.claimCancellation("cancelled")
        expect(yield* scope.result(assistant(scope.sessionID, "cancelled fallback"))).toMatchObject({
          type: "cancelled",
          taskID: scope.sessionID,
          status: "cancelled",
        })
        yield* scope.close()
      }),
    )
  })

  test("empty text is an exact candidate and resolves without falling back", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        yield* scope.settleTerminal(yield* markTerminal(scope, reservation))
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, ""), clean: true })
        expect(scope.current().candidate).toBe(true)
        yield* scope.finishContinuation()
        expect(selectedText(yield* scope.result(assistant(scope.sessionID, "wrong fallback")))).toBe("")
        yield* scope.close()
      }),
    )
  })

  test("observeTurn snapshots candidate parts without aliasing the caller", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        yield* scope.settleTerminal(yield* markTerminal(scope, reservation))
        const observed = assistant(scope.sessionID, "stable candidate")
        yield* scope.observeTurn({ assistant: observed, clean: true })
        const part = observed.parts[0]
        if (!part || part.type !== "text") return yield* Effect.die("missing text part")
        part.text = "mutated after observation"
        yield* scope.finishContinuation()
        expect(selectedText(yield* scope.result(assistant(scope.sessionID, "wrong fallback")))).toBe("stable candidate")
        yield* scope.close()
      }),
    )
  })

  test("degradation preserves U and active until exact settlement and observer finalization", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        const marker = yield* markTerminal(scope, reservation)
        yield* scope.degrade()

        expect(scope.current()).toMatchObject({ failed: true, undelivered: 1 })
        const done = yield* Deferred.make<void>()
        const result = yield* scope
          .result(assistant(scope.sessionID, "best child output"))
          .pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
        yield* scope.settleTerminal(marker)
        expect(yield* Deferred.isDone(done)).toBe(false)
        yield* scope.finishContinuation()

        const value = yield* Fiber.join(result)
        expect(value).toMatchObject({ type: "evidence", degraded: true })
        expect(selectedText(value)).toBe("best child output")
        yield* scope.close()
      }),
    )
  })

  test("explicit cancellation clears J and U but waits for the observer to release active", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        yield* markTerminal(scope, reservation)

        yield* scope.claimCancellation("cancelled by fence")
        expect(scope.current()).toMatchObject({ attached: 0, undelivered: 0, cancelled: true })
        const done = yield* Deferred.make<void>()
        const result = yield* scope
          .result(assistant(scope.sessionID, "fallback"))
          .pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
        expect(yield* Deferred.isDone(done)).toBe(false)
        yield* scope.finishContinuation()
        expect(yield* Fiber.join(result)).toMatchObject({
          type: "cancelled",
          taskID: scope.sessionID,
          status: "cancelled by fence",
        })
        yield* scope.close()
      }),
    )
  })

  test("dirty turns remain observed evidence and an exhausted wake does not degrade", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        const marker = yield* markTerminal(scope, reservation)
        yield* scope.settleTerminal(marker)
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "dirty"), clean: false })
        expect(scope.current().candidate).toBe(false)
        expect(yield* scope.beginWake()).toBe(true)
        yield* scope.endWake()
        yield* scope.exhaustWake()
        yield* scope.finishContinuation()
        const result = yield* scope.result(assistant(scope.sessionID, "fallback"))
        expect(selectedText(result)).toBe("dirty")
        expect(result).toMatchObject({ type: "evidence", degraded: false })
        expect(scope.current().failed).toBe(false)
        yield* scope.close()
      }),
    )
  })

  test("an exhausted wake with no observed evidence preserves baseline degradation", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        const marker = yield* markTerminal(scope, reservation)
        yield* scope.settleTerminal(marker)
        expect(yield* scope.beginWake()).toBe(true)
        yield* scope.endWake()
        yield* scope.exhaustWake()
        yield* scope.finishContinuation()
        const result = yield* scope.result(assistant(scope.sessionID, "fallback"))
        expect(selectedText(result)).toBe("fallback")
        expect(result).toMatchObject({ type: "evidence", degraded: true })
        expect(scope.current().failed).toBe(true)
        yield* scope.close()
      }),
    )
  })

  test("a foreign reservation degrades only the receiving scope", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const first = yield* coordinator.open(SessionID.create())
        const second = yield* coordinator.open(SessionID.create())
        const reservation = yield* first.reserve(SessionID.create())

        expect(yield* second.claimObserver(reservation)).toEqual({ type: "unavailable", reason: "invalid" })
        expect(second.current().failed).toBe(true)
        expect(first.current().failed).toBe(false)
        yield* first.reject(reservation)
        yield* first.close()
        yield* second.close()
      }),
    )
  })

  test("captureFence and claimCancellationAtFence bind exact scope generations", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const old = yield* coordinator.open(sessionID)
        const oldRef = fenceRef()
        expect(yield* coordinator.captureFence(sessionID, oldRef)).toBe(true)
        yield* old.close()

        const replacement = yield* coordinator.open(sessionID)
        const freshRef = fenceRef()
        expect(yield* coordinator.captureFence(sessionID, freshRef)).toBe(true)
        expect(yield* coordinator.claimCancellationAtFence(sessionID, oldRef)).toBe(true)
        expect(old.current().cancelled).toBe(true)
        expect(replacement.current().cancelled).toBe(false)
        expect(yield* coordinator.claimCancellationAtFence(SessionID.create(), freshRef)).toBe(false)
        expect(yield* coordinator.claimCancellationAtFence(sessionID, freshRef)).toBe(true)
        expect(replacement.current().cancelled).toBe(true)
        yield* replacement.close()
      }),
    )
  })

  // CP-032 R-08. `resolve` drives a never-attached scope through `result()`'s immediate arm, which
  // publishes a resolution and sets `closed` WITHOUT unregistering — only `closeNow` unregisters.
  // That is the registered-but-unusable window, and once B-1 parks an owner run inside
  // `Scope.result()` it covers every concurrent supplemental sequence rather than a few fiber hops.
  const resolve = (scope: AttachmentCoordinator.Scope, sessionID: SessionID, text: string) =>
    scope.result(assistant(sessionID, text))

  test("R-08: a resolved scope stays discoverable, is not borrowable, and is atomically replaced", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const old = yield* coordinator.open(sessionID)
        yield* resolve(old, sessionID, "first")

        // RAW DISCOVERY IS PRESERVED, and this assertion is load-bearing rather than incidental.
        // Two of `locate`'s three production consumers need registry truth, not usability:
        // `tool/task.ts` reconciles the carried parent scope by object identity and fails the call
        // on disagreement, and `session/attachment/participant.ts` reports covered edges for closure
        // proof and must not narrow the proven set. A global resolved-filter inside `locate` would
        // regress both; this test fails if anyone reintroduces one.
        expect(yield* coordinator.locate(sessionID)).toBe(old)
        // ...but it is not borrowable.
        expect(yield* coordinator.locateBorrowable(sessionID)).toBeUndefined()

        const replacement = yield* coordinator.open(sessionID)
        expect(replacement.id).not.toBe(old.id)
        expect(yield* coordinator.locate(sessionID)).toBe(replacement)
        expect(yield* coordinator.locateBorrowable(sessionID)).toBe(replacement)
      }),
    )
  })

  test("R-08: borrowing a resolved scope replays the earlier answer; the successor files its own", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const old = yield* coordinator.open(sessionID)
        expect(selectedText(yield* resolve(old, sessionID, "first"))).toBe("first")

        // THE DEFECT, demonstrated rather than asserted against private state. A borrower of the
        // resolved scope gets the EARLIER resolution back: `own()` returns on the `closed` guard
        // without minting a typed refusal, and `result()` short-circuits on `state.resolution`. Its
        // own distinct answer never reaches selection, so it files a position the guard already
        // holds and disappears with no note and no error.
        expect(selectedText(yield* resolve(old, sessionID, "second"))).toBe("first")

        // THE REPAIR: the borrow lookup refuses it, so the supplement opens its own scope and its
        // distinct answer is the one selected.
        expect(yield* coordinator.locateBorrowable(sessionID)).toBeUndefined()
        const replacement = yield* coordinator.open(sessionID)
        expect(selectedText(yield* resolve(replacement, sessionID, "second"))).toBe("second")
      }),
    )
  })

  test("R-08: a degraded-but-unresolved scope stays borrowable and keeps refusing admission", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const scope = yield* coordinator.open(sessionID)
        // Degrading alone cannot resolve: the degraded gate needs candidate, observed, or fallback,
        // and a fresh scope has none. So this is registered, degraded, and UNRESOLVED.
        yield* scope.degrade()

        // Replacement is scoped to resolved scopes only. This one is still the incumbent, so the
        // exclusive open still loses and CP-031's recoverable admission failure is untouched:
        // R-23 preserves it, and only R-08's resolved case is carved out.
        expect(yield* coordinator.locateBorrowable(sessionID)).toBe(scope)
        expect(Exit.isFailure(yield* coordinator.open(sessionID).pipe(Effect.exit))).toBe(true)
        // `own()` still throws here — the typed `SessionScopeOwnRefused` that `promptAdmitted`
        // mints, which is what turns this case into a sanitized note instead of silent loss.
        expect(Exit.isFailure(yield* scope.own(MessageID.ascending()).pipe(Effect.exit))).toBe(true)
      }),
    )
  })

  test("R-08: a predecessor's finalizer cannot evict its successor, in either order", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make

        // Replace-then-close: the predecessor closes while the successor holds the registration.
        // `closeNow` deletes only while the registered scope id is still its own, and `scopeID` is a
        // fresh UUID per open, so the stale finalizer is a no-op against the registry.
        const replaceFirst = SessionID.create()
        const oldA = yield* coordinator.open(replaceFirst)
        yield* resolve(oldA, replaceFirst, "first")
        const successorA = yield* coordinator.open(replaceFirst)
        yield* oldA.close()
        expect(yield* coordinator.locate(replaceFirst)).toBe(successorA)
        expect(yield* coordinator.locateBorrowable(replaceFirst)).toBe(successorA)
        expect(successorA.current().cancelled).toBe(false)

        // Close-then-replace: the pre-existing ordering, still an ordinary unregister-then-open.
        const closeFirst = SessionID.create()
        const oldB = yield* coordinator.open(closeFirst)
        yield* resolve(oldB, closeFirst, "first")
        yield* oldB.close()
        expect(yield* coordinator.locate(closeFirst)).toBeUndefined()
        const successorB = yield* coordinator.open(closeFirst)
        expect(successorB.id).not.toBe(oldB.id)
        expect(yield* coordinator.locate(closeFirst)).toBe(successorB)
      }),
    )
  })

  test("R-08: two concurrent replacements of one resolved scope yield exactly one successor", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const old = yield* coordinator.open(sessionID)
        yield* resolve(old, sessionID, "first")

        // `open` yields before it registers, so these genuinely interleave. The check-and-swap is
        // one synchronous critical section: whichever lands first becomes the unresolved incumbent,
        // and the other must then lose the exclusive open rather than replace a live scope.
        const outcomes = yield* Effect.all(
          [coordinator.open(sessionID).pipe(Effect.exit), coordinator.open(sessionID).pipe(Effect.exit)],
          { concurrency: "unbounded" },
        )
        const winners = outcomes.filter(Exit.isSuccess)
        expect(winners).toHaveLength(1)
        expect(outcomes.filter(Exit.isFailure)).toHaveLength(1)

        const registered = yield* coordinator.locate(sessionID)
        expect(registered).toBe(winners[0]!.value)
        expect(registered).not.toBe(old)
      }),
    )
  })

  test("R-08: replacement before the predecessor closes preserves exact fence generations", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const old = yield* coordinator.open(sessionID)
        const oldRef = fenceRef()
        expect(yield* coordinator.captureFence(sessionID, oldRef)).toBe(true)

        // The new ordering R-08 introduces. The standing generation test replaces AFTER `close()`;
        // here the predecessor is resolved and swapped out while still unclosed, so its fence
        // snapshot is still reachable through the WeakMap when the successor takes over.
        yield* resolve(old, sessionID, "first")
        const replacement = yield* coordinator.open(sessionID)

        const freshRef = fenceRef()
        expect(yield* coordinator.captureFence(sessionID, freshRef)).toBe(true)

        // The predecessor's ref keeps authorizing the predecessor and nothing else. It is neither
        // deleted nor forwarded: a ref authorizes the exact generation it was captured on, and
        // replacement does not hand it jurisdiction over a generation it never named. The snapshot
        // has to survive the predecessor's close, because participant cancellation runs after the
        // physical signals closure core dispatches against exact Runner/BackgroundJob targets.
        expect(yield* coordinator.claimCancellationAtFence(sessionID, oldRef)).toBe(true)
        expect(old.current().cancelled).toBe(true)
        expect(replacement.current().cancelled).toBe(false)

        // A LATE predecessor finalizer, arriving after the swap, is a no-op against the registry:
        // `closeNow` deletes only while the registered scope id is still its own. The successor
        // stays registered, stays borrowable, and keeps its own fence binding.
        yield* old.close()
        expect(yield* coordinator.locate(sessionID)).toBe(replacement)
        expect(yield* coordinator.locateBorrowable(sessionID)).toBe(replacement)

        expect(yield* coordinator.claimCancellationAtFence(sessionID, freshRef)).toBe(true)
        expect(replacement.current().cancelled).toBe(true)
      }),
    )
  })

  test("R-08: a scope resolving between borrow discovery and ownership refuses instead of replaying", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const scope = yield* coordinator.open(sessionID)
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        const marker = yield* markTerminal(scope, reservation)
        yield* scope.observeTurn({ assistant: assistant(sessionID, "settled answer"), clean: true })

        // PHASE 1 — discovery. The scope is live and unresolved, so the borrow legitimately wins.
        // Atomic replacement cannot help here: there is nothing resolved to replace yet.
        expect(yield* coordinator.locateBorrowable(sessionID)).toBe(scope)

        // PHASE 2 — the capture-to-use window. In production this is where `promptAdmitted` runs
        // `revert.cleanup` and `createUserMessage`, durably persisting the supplement's User
        // message. The owner's outstanding work quiesces underneath it and the gate resolves.
        yield* scope.settleTerminal(marker)
        yield* scope.finishContinuation()

        // PHASE 3 — ownership, now against a scope that resolved mid-flight. It must REPORT the
        // refusal rather than silently drop the claim: a bare no-op here is what let the run
        // continue onto a dead scope and replay its earlier answer.
        const persisted = MessageID.ascending()
        expect(yield* scope.own(persisted)).toBe(false)
        expect(scope.owns(persisted)).toBe(false)

        // Both halves hold at once. The settled answer stays immutable — had ownership been taken,
        // `invalidate()` would have cleared the candidate and this would read "stale replay" — and
        // the caller still gets a signal it can act on. `promptAdmitted` turns that `false` into
        // `SessionScopeOwnRefused` before `onAdmitted` fires, so the supplement receives the
        // sanctioned pre-admission note instead of filing into the earlier position.
        expect(selectedText(yield* scope.result(assistant(sessionID, "stale replay")))).toBe("settled answer")
        expect(yield* coordinator.locateBorrowable(sessionID)).toBeUndefined()
      }),
    )
  })

  test("concurrent scope opens have exactly one winner", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const outcomes = yield* Effect.all(
          [coordinator.open(sessionID).pipe(Effect.exit), coordinator.open(sessionID).pipe(Effect.exit)],
          { concurrency: "unbounded" },
        )
        expect(outcomes.filter(Exit.isSuccess)).toHaveLength(1)
        expect(outcomes.filter(Exit.isFailure)).toHaveLength(1)
        for (const outcome of outcomes) {
          if (Exit.isSuccess(outcome)) yield* outcome.value.close()
        }
      }),
    )
  })

  test("same-ID claims linearize and duplicate scope opens fail until close", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const first = yield* coordinator.claim(sessionID)
        const follower = yield* coordinator.claim(sessionID)
        expect(first.owner).toBe(true)
        expect(follower.owner).toBe(false)
        yield* coordinator.settleClaim(first, true)
        expect(yield* coordinator.awaitClaim(follower)).toBe(true)

        const scope = yield* coordinator.open(sessionID)
        expect(Exit.isFailure(yield* coordinator.open(sessionID).pipe(Effect.exit))).toBe(true)
        yield* scope.close()
        const replacement = yield* coordinator.open(sessionID)
        expect(replacement.id).not.toBe(scope.id)
        yield* replacement.close()
      }),
    )
  })

  test("never-attached scopes carry populated slots instead of discarding them for fallback", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "candidate"), clean: true })
        expect(selectedText(yield* scope.result(assistant(scope.sessionID, "fallback")))).toBe("candidate")
        yield* scope.close()
      }),
    )
  })

  test("ownership arriving after the successful gate closes is a no-op", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        const reservation = yield* scope.reserve(SessionID.create())
        yield* owner(scope, reservation)
        const marker = yield* markTerminal(scope, reservation)
        yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "frozen return"), clean: true })
        yield* scope.settleTerminal(marker)
        yield* scope.finishContinuation()

        const late = MessageID.ascending()
        yield* scope.own(late)
        expect(scope.owns(late)).toBe(false)
        expect(selectedText(yield* scope.result(assistant(scope.sessionID, "wrong fallback")))).toBe("frozen return")
        yield* scope.close()
      }),
    )
  })
})
