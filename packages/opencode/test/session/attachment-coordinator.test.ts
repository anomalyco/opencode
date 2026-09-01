import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber } from "effect"
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

/**
 * Reads a settled selection the way CP-032 v0.12 requires.
 *
 * `Scope.result` is an ELIGIBILITY operation, not a settled-state reader: a foreign Assistant
 * arriving after publication is the fresh-answer case Admission Freshness exists to preserve, so it
 * returns that Assistant rather than the settled selection. A test that wants to inspect the
 * selection must therefore be a genuine pre-publication entrant.
 *
 * This forks `result()` BEFORE the publishing step, so the probe enrols as an unresolved entrant,
 * latches as first fallback, and parks on the one-shot Deferred. Its text is deliberately
 * distinguishable: a selection bug that returned the caller's own Assistant surfaces as that text
 * instead of silently matching the expected value, which is the confusable negative the original
 * post-publication `"wrong fallback"` probes provided.
 *
 * The `yieldNow` is load-bearing. `forkChild` only SCHEDULES the fiber, so without it the probe has
 * not entered `result()` yet, the park is never established, and the call would actually arrive
 * post-publication -- passing for the wrong reason. Asserting `isDone === false` after the yield
 * makes the helper fail loudly if it is used where `result()` resolves immediately.
 *
 * Returns a thunk to await after the publishing step. Calls the real `Scope.result()` and touches no
 * product state or surface.
 */
const parkedRead = (scope: AttachmentCoordinator.Scope, probeText: string) =>
  Effect.gen(function* () {
    const settled = yield* Deferred.make<void>()
    const answer: { value: TaskSelectedReturn | undefined } = { value: undefined }
    yield* scope.result(assistant(scope.sessionID, probeText)).pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          answer.value = value
        }),
      ),
      Effect.ensuring(Deferred.succeed(settled, undefined)),
      Effect.forkChild,
    )
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(settled)).toBe(false)
    return Effect.gen(function* () {
      yield* Deferred.await(settled)
      if (!answer.value) return yield* Effect.die("the parked result never resolved")
      return answer.value
    })
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
        // Let the forked call actually REACH `result()` before asserting it is parked. Without this
        // the fiber has merely been scheduled, so `isDone` is false because nothing ran -- and the
        // call would then enter after `finishContinuation` published, which is a different path than
        // this row is about. Reaching `result()` while unresolved is also what enrols this Assistant.
        yield* Effect.yieldNow
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
        // Reach `result()` while U and active still block the gate, so the park is real and this
        // Assistant is enrolled before any publication.
        yield* Effect.yieldNow
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
        // Reach `result()` while still unresolved, so the park below is real and this Assistant is
        // enrolled. Without it the fiber is only scheduled and would instead arrive after publication.
        yield* Effect.yieldNow
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
        // Reach `result()` while the wake still blocks the gate, so the park is real and this
        // Assistant is enrolled before any publication.
        yield* Effect.yieldNow
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
        // Enter `result()` before the continuation finishes, so this probe is a genuine unresolved
        // entrant. Its distinguishable text is the confusable negative: falling back would return
        // "wrong fallback" rather than the empty candidate.
        const settled = yield* parkedRead(scope, "wrong fallback")
        yield* scope.finishContinuation()
        expect(selectedText(yield* settled)).toBe("")
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
        // Three-way discrimination is preserved: "stable candidate" proves the snapshot, "mutated
        // after observation" would prove aliasing, "wrong fallback" would prove selection fell back.
        const settled = yield* parkedRead(scope, "wrong fallback")
        yield* scope.finishContinuation()
        expect(selectedText(yield* settled)).toBe("stable candidate")
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
        const settled = yield* parkedRead(scope, "fallback")
        yield* scope.finishContinuation()
        const result = yield* settled
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

  test("R-08: a resolved scope is not borrowable and the successor files its own answer", async () => {
    await runAttached(
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const sessionID = SessionID.create()
        const old = yield* coordinator.open(sessionID)
        expect(selectedText(yield* resolve(old, sessionID, "first"))).toBe("first")

        // RETIRED (CP-032 v0.12): this row previously asserted that a second caller on the resolved
        // scope got "first" back -- the replay that made R-08's borrow refusal load-bearing. That
        // replay is now gone at the coordinator itself: "second" is absent from the frozen membership
        // of the published resolution, so Admission Freshness returns it as its own fresh evidence,
        // without mutating the retained fallback, history, or resolution. It can no longer be keyed
        // to the earlier position and swallowed by the filing guard. The foreign-ID behaviour is
        // owned by the nonmember-fresh arm of the Admission Freshness matrix and asserted here too,
        // because this is the exact scope that used to swallow it.
        expect(selectedText(yield* resolve(old, sessionID, "second"))).toBe("second")

        // UNCHANGED and still load-bearing: R-08's borrow lookup refuses a resolved scope, so a
        // supplement opens its own rather than joining one that has already spoken. Freshness makes
        // the failure mode benign; it does not make the refusal unnecessary, because a borrower would
        // otherwise attach to a scope that can never gate its descendants.
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

  test("R-08: a scope resolving between borrow discovery and ownership refuses the late claim", async () => {
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
        // A genuine pre-publication entrant, so the settled selection is observable without asking
        // `result()` to behave as a reader after the fact.
        const settled = yield* parkedRead(scope, "stale replay")
        yield* scope.settleTerminal(marker)
        yield* scope.finishContinuation()
        expect(selectedText(yield* settled)).toBe("settled answer")

        // PHASE 3 - ownership, now against a scope that resolved mid-flight. It must REPORT the
        // refusal rather than silently drop the claim: a bare no-op here is what let the run
        // continue onto a dead scope and file into the earlier position.
        const before = scope.current()
        const persisted = MessageID.ascending()
        expect(yield* scope.own(persisted)).toBe(false)
        expect(scope.owns(persisted)).toBe(false)

        // Both halves hold at once. The refused claim is reported rather than dropped, and
        // the caller gets a signal it can act on:
        // `promptAdmitted` turns that `false` into
        // `SessionScopeOwnRefused` after durable persistence of the User message and its Parts but
        // before Task's `onAdmitted` flag, so the supplement receives the sanctioned B-7 note
        // instead of filing into the earlier position.
        //
        // RETIRED (CP-032 v0.12): this row previously re-called `result()` with a "stale replay"
        // Assistant and asserted it returned "settled answer". That was reader-idempotence, which
        // v0.12 removes -- a nonmember arriving after publication now legitimately gets its own
        // evidence back. The property that assertion protected is that the REFUSED claim left the
        // settled state alone, asserted here directly and more strongly: had ownership been taken,
        // `invalidate()` would have cleared the candidate and moved this snapshot.
        expect(scope.current()).toEqual(before)
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
        // A genuine pre-publication entrant, so the settled selection is observable without asking
        // `result()` to behave as a reader.
        const settled = yield* parkedRead(scope, "wrong fallback")
        yield* scope.finishContinuation()
        expect(selectedText(yield* settled)).toBe("frozen return")

        // RETIRED (CP-032 v0.12): this row previously re-called `result()` with a foreign Assistant
        // and asserted it returned "frozen return". That assertion WAS reader-idempotence, which
        // v0.12 deliberately removes -- a foreign Assistant arriving after publication is the
        // fresh-answer case Admission Freshness exists to preserve. The foreign-ID behaviour now
        // belongs to the nonmember-fresh matrix; what this row still owns is that a late claim is
        // inert, asserted directly below.
        const before = scope.current()
        const late = MessageID.ascending()
        yield* scope.own(late)
        expect(scope.owns(late)).toBe(false)
        // Strictly stronger than the retired read-back: the late claim moved NOTHING observable,
        // rather than merely leaving one selection text unchanged. An `invalidate()` on this path
        // would clear the candidate and fail here.
        expect(scope.current()).toEqual(before)
        yield* scope.close()
      }),
    )
  })

  // T-032-3 — the K14 oracle, and the reason CP-032 forbids landing B-1 without B-3.
  //
  // `Scope.result` latches its FIRST caller's message as the retained fallback and keeps it: every
  // later scoped admission invalidates candidate and observed, but never the fallback. So a child
  // that answered once, then took more work, is holding that earlier answer when it is cancelled.
  //
  // Which of the two gates that fallback reaches is decided entirely by the Exit its owner scope is
  // finalized with — which is exactly what B-3 changed. The pair below drives the same fixture down
  // both, and they produce opposite answers.
  //
  // Neither arm asserts private state. The fallback identity is established BY CONSTRUCTION (one
  // `result` call precedes, so the retained fallback can only be that message), and candidate and
  // observed absence is a PRECONDITION that holds in both arms rather than the thing under test.
  const stale = "earlier distinctive answer"

  // Deliberately not `Effect.fn`: that widens the requirements channel to `unknown`, and
  // `runAttached` accepts exactly `Scope`. A plain generator lets R infer from `AttachmentCoordinator.make`.
  const parkedOnEarlierAnswer = () =>
    Effect.gen(function* () {
      const coordinator = yield* AttachmentCoordinator.make
      const scope = yield* coordinator.open(SessionID.create())
      // A registered job with NO elected observer. Registration blocks the never-attached immediate
      // resolution so `result` genuinely parks, while leaving `active` and `wakes` at zero — both
      // gates park while either is positive, so without this the arms would hang rather than
      // discriminate (CP-032 §9.3 step 3).
      yield* scope.reserve(SessionID.create())
      // A `Deferred<void>` signal plus a holder, rather than `Deferred<TaskSelectedReturn>`:
      // `Deferred.succeed` is invariant in its value type, so the typed Deferred cannot be passed
      // where the combinator expects `Deferred<unknown>`.
      const settled = yield* Deferred.make<void>()
      const answer: { value: TaskSelectedReturn | undefined } = { value: undefined }
      yield* scope.result(assistant(scope.sessionID, stale)).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            answer.value = value
          }),
        ),
        Effect.ensuring(Deferred.succeed(settled, undefined)),
        Effect.forkChild,
      )
      // Let the waiter reach its park before anything else runs, or a mutant that never parks would
      // survive this fixture.
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(settled)).toBe(false)
      // A later scoped admission: invalidates candidate and observed, and leaves the fallback.
      yield* scope.own(MessageID.ascending())
      return { scope, settled, answer }
    })

  test("T-032-3: a cancelled owner scope returns cancellation, never the retained earlier answer", async () => {
    await runAttached(
      Effect.gen(function* () {
        const { scope, settled, answer } = yield* parkedOnEarlierAnswer()

        // What B-3 now supplies for a `cancelled` terminal. `finalizeScope` reads the interrupt and
        // claims cancellation, so the cancellation-first gate resolves with no evidence fields and
        // `complete` returns it WITHOUT reattaching the fallback.
        yield* AttachmentCoordinator.finalizeScope(scope, Exit.failCause(Cause.interrupt()))

        yield* Deferred.await(settled)
        const resolved = answer.value
        if (!resolved) throw new Error("the parked result never resolved")
        expect(resolved.type).toBe("cancelled")
        expect(selectedText(resolved)).toBeUndefined()
        // The earlier answer is absent from the whole resolution, not merely unselected.
        expect(JSON.stringify(resolved)).not.toContain(stale)
      }),
    )
  })

  test("T-032-3 control: finalizing a cancelled owner as success replays the earlier answer", async () => {
    await runAttached(
      Effect.gen(function* () {
        const { scope, settled, answer } = yield* parkedOnEarlierAnswer()

        // THE DEFECT, held as a passing negative control. This is precisely what the lifetime waiter
        // did before B-3: every terminal, cancellation included, finalized as `Exit.void`. That is
        // not neutral — it claims nothing and degrades nothing, so `closeNow` marks the unresolved
        // scope degraded, the DEGRADED gate resolves with candidate and observed absent, `complete`
        // reattaches the retained fallback, and `select` falls through to it.
        yield* AttachmentCoordinator.finalizeScope(scope, Exit.void)

        yield* Deferred.await(settled)
        const resolved = answer.value
        if (!resolved) throw new Error("the parked result never resolved")
        // A cancelled task answering "completed" with text from before its cancellation.
        expect(resolved.type).toBe("evidence")
        if (resolved.type !== "evidence") return
        expect(resolved.degraded).toBe(true)
        expect(selectedText(resolved)).toBe(stale)
      }),
    )
  })

  // CP-032 §3.3.2 — the Admission Freshness matrix.
  //
  // Every arm drives the ONE atomic `Scope.result()` transition and differs only in what the scope
  // had already published when that transition BEGAN. That is the discriminator the design turns on:
  // a resolution published during this call was computed for this turn, while one that predates the
  // call was computed for another.
  describe("Admission Freshness (CP-032 §3.3.2)", () => {
    // Publishes a DEGRADED resolution with a known frozen cohort, then hands back its members.
    const publishedDegraded = (input: { candidate?: string; observed?: string }) =>
      Effect.gen(function* () {
        const coordinator = yield* AttachmentCoordinator.make
        const scope = yield* coordinator.open(SessionID.create())
        // A registered job blocks the never-attached immediate path so `result` genuinely parks and
        // latches the first fallback. The degraded gate does not require an empty job set, and both
        // gate branches park while `active` or `wakes` is positive -- neither is touched here.
        yield* scope.reserve(SessionID.create())
        const first = assistant(scope.sessionID, "frozen first fallback")
        const parked = yield* Deferred.make<void>()
        const held: { value: TaskSelectedReturn | undefined } = { value: undefined }
        yield* scope.result(first).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              held.value = value
            }),
          ),
          Effect.ensuring(Deferred.succeed(parked, undefined)),
          Effect.forkChild,
        )
        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(parked)).toBe(false)
        const candidate = input.candidate ? assistant(scope.sessionID, input.candidate) : undefined
        if (candidate) yield* scope.observeTurn({ assistant: candidate, clean: true })
        const observed = input.observed ? assistant(scope.sessionID, input.observed) : undefined
        if (observed) yield* scope.observeTurn({ assistant: observed, clean: false })
        yield* scope.degrade()
        yield* Deferred.await(parked)
        return { scope, first, candidate, observed, held }
      })

    test("consumes a pre-published CLEAN resolution when the incoming Assistant is a frozen member", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          yield* owner(scope, reservation)
          yield* scope.settleTerminal(yield* markTerminal(scope, reservation))
          // Enrolled by `observeTurn` before the gate runs (invariant 1), so this Assistant is inside
          // the membership frozen into the clean resolution published below.
          const observed = assistant(scope.sessionID, "current run answer")
          yield* scope.observeTurn({ assistant: observed, clean: true })
          yield* scope.finishContinuation()

          // A MEMBER arriving after publication consumes the settled structural selection instead of
          // being handed its own Assistant back. This is the positive half of invariant 5; the
          // nonmember half is owned by the DISTINCT-admitted arm below. A degraded-only
          // implementation fails here by treating a clean resolution as unconditionally consumable
          // without checking membership, and an always-fresh implementation fails by returning the
          // caller's Assistant.
          const selected = yield* scope.result(observed)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          expect(selected.degraded).toBe(false)
          expect(selectedText(selected)).toBe("current run answer")
          // Text alone cannot discriminate here: an always-fresh implementation would hand back this
          // same Assistant as its own fallback and read identically. The STRUCTURAL evidence is what
          // separates them -- a consumed resolution carries the published candidate, while a fresh
          // one carries only the caller's fallback.
          expect(selected.candidate).toBeDefined()
        }),
      )
    })

    test("consumes a pre-published CANCELLATION and yields no controlling Assistant", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          yield* scope.claimCancellation("cancelled")
          const late = assistant(scope.sessionID, "answer after cancellation")
          const selected = yield* scope.result(late)
          // No controlling Assistant means Task files nothing. An always-fresh implementation fails
          // here by manufacturing completed evidence for a cancelled scope.
          expect(selected.type).toBe("cancelled")
          expect(selectedText(selected)).toBeUndefined()
          expect(JSON.stringify(selected)).not.toContain("answer after cancellation")
        }),
      )
    })

    test("returns a DISTINCT admitted Assistant as fresh non-degraded evidence", async () => {
      await runAttached(
        Effect.gen(function* () {
          const { scope } = yield* publishedDegraded({})
          const r2 = assistant(scope.sessionID, "distinct admitted R2")
          const selected = yield* scope.result(r2)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          // R2 matches no frozen cohort member, so it speaks for itself instead of disappearing
          // behind R1's already-filed position. Unconditional consumption fails here.
          expect(selected.degraded).toBe(false)
          expect(selectedText(selected)).toBe("distinct admitted R2")
        }),
      )
    })

    test("consumes the degraded result when the incoming Assistant is the frozen FALLBACK", async () => {
      await runAttached(
        Effect.gen(function* () {
          const { scope, first } = yield* publishedDegraded({})
          const selected = yield* scope.result(first)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          expect(selected.degraded).toBe(true)
          expect(selectedText(selected)).toBe("frozen first fallback")
        }),
      )
    })

    test("consumes the degraded result when the incoming Assistant is the frozen CANDIDATE", async () => {
      await runAttached(
        Effect.gen(function* () {
          const { scope, candidate } = yield* publishedDegraded({ candidate: "frozen candidate" })
          if (!candidate) throw new Error("fixture did not build a candidate")
          const selected = yield* scope.result(candidate)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          expect(selected.degraded).toBe(true)
          expect(selectedText(selected)).toBe("frozen candidate")
        }),
      )
    })

    test("consumes the degraded result when the incoming Assistant is the frozen OBSERVED", async () => {
      await runAttached(
        Effect.gen(function* () {
          const { scope, observed } = yield* publishedDegraded({ observed: "frozen observed" })
          if (!observed) throw new Error("fixture did not build an observed turn")
          const selected = yield* scope.result(observed)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          expect(selected.degraded).toBe(true)
          expect(selectedText(selected)).toBe("frozen observed")
        }),
      )
    })

    test("shared waiters entering while UNRESOLVED consume one first-latched resolution", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          yield* scope.reserve(SessionID.create())
          const park = (value: SessionV1.WithParts) =>
            Effect.gen(function* () {
              const done = yield* Deferred.make<void>()
              const held: { value: TaskSelectedReturn | undefined } = { value: undefined }
              yield* scope.result(value).pipe(
                Effect.tap((selected) =>
                  Effect.sync(() => {
                    held.value = selected
                  }),
                ),
                Effect.ensuring(Deferred.succeed(done, undefined)),
                Effect.forkChild,
              )
              return { done, held }
            })

          const w1 = yield* park(assistant(scope.sessionID, "first waiter"))
          const w2 = yield* park(assistant(scope.sessionID, "second waiter"))
          yield* Effect.yieldNow
          expect(yield* Deferred.isDone(w1.done)).toBe(false)
          expect(yield* Deferred.isDone(w2.done)).toBe(false)

          yield* scope.degrade()
          yield* Deferred.await(w1.done)
          yield* Deferred.await(w2.done)

          // Both entered unresolved, so both take the first-latch/park path and consume ONE
          // resolution. The identity check must not fire merely because the later waiter passed a
          // different Assistant -- that would manufacture a second answer from one run.
          expect(selectedText(w1.held.value!)).toBe("first waiter")
          expect(selectedText(w2.held.value!)).toBe("first waiter")
        }),
      )
    })

    // Invariant 5, no-retained half. Nothing entered `result()` unresolved before this publication,
    // so the resolution carries NO retained fallback. v0.12 removed the exception that let such a
    // resolution be consumed by anyone; membership still governs, so a distinct first consumer is
    // fresh. The no-retained-exception mutant fails here by handing back the published selection.
    test("a DISTINCT first consumer of a no-retained resolution is fresh", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          yield* owner(scope, reservation)
          yield* scope.settleTerminal(yield* markTerminal(scope, reservation))
          yield* scope.observeTurn({ assistant: assistant(scope.sessionID, "clean answer"), clean: true })
          yield* scope.finishContinuation()

          const distinct = assistant(scope.sessionID, "distinct first consumer")
          const selected = yield* scope.result(distinct)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          expect(selected.degraded).toBe(false)
          expect(selectedText(selected)).toBe("distinct first consumer")
        }),
      )
    })

    // Invariant 7. A fresh post-publication result must NOT enrol its own Assistant, or the second
    // arrival of the same run would start consuming a resolution computed for a different turn. The
    // repeat is the oracle: it must be fresh BOTH times.
    test("a fresh post-publication result does not self-enrol, so a repeat stays fresh", async () => {
      await runAttached(
        Effect.gen(function* () {
          const { scope } = yield* publishedDegraded({})
          const distinct = assistant(scope.sessionID, "never a member")

          const first = yield* scope.result(distinct)
          expect(first.type).toBe("evidence")
          if (first.type !== "evidence") return
          expect(first.degraded).toBe(false)
          expect(selectedText(first)).toBe("never a member")

          const again = yield* scope.result(distinct)
          expect(again.type).toBe("evidence")
          if (again.type !== "evidence") return
          // Self-enrolment would make this consume the frozen degraded result instead.
          expect(again.degraded).toBe(false)
          expect(selectedText(again)).toBe("never a member")
        }),
      )
    })

    // Invariant 3, the displaced-observed case. A1 is observed, then a later scoped admission calls
    // `own()`, whose `invalidate()` clears candidate and observed. Membership is HISTORY, not current
    // evidence, so A1 must remain a member: when A2's turn publishes, A1 arriving consumes A2's
    // selection rather than being revived as a fresh answer of its own. This is the row that kills
    // the clear-on-invalidate mutant, and the reason a frozen {fallback, candidate, observed} trio
    // was insufficient -- those slots are replaceable, and A1 no longer occupies one.
    test("an OBSERVED Assistant displaced by a later admission stays a member and consumes the new selection", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          yield* owner(scope, reservation)
          // Take the terminal marker BEFORE the displacement: `own()` invalidates, which moves the
          // epoch, and a marker taken afterwards would no longer settle -- leaving an undelivered
          // entry that the clean gate waits on forever.
          const marker = yield* markTerminal(scope, reservation)

          const a1 = assistant(scope.sessionID, "displaced observed")
          yield* scope.observeTurn({ assistant: a1, clean: true })
          expect(scope.current().candidate).toBe(true)

          // A later scoped admission displaces A1 as current evidence.
          yield* scope.own(MessageID.ascending())
          expect(scope.current().candidate).toBe(false)

          const a2 = assistant(scope.sessionID, "later clean answer")
          yield* scope.observeTurn({ assistant: a2, clean: true })
          yield* scope.settleTerminal(marker)
          yield* scope.finishContinuation()

          const selected = yield* scope.result(a1)
          expect(selected.type).toBe("evidence")
          if (selected.type !== "evidence") return
          expect(selected.degraded).toBe(false)
          // A2's selection, not A1 handed back as its own fresh answer.
          expect(selectedText(selected)).toBe("later clean answer")
        }),
      )
    })

    // Invariant 8. Closing clears the scope's mutable membership, but must not reach into the frozen
    // snapshot a delayed fiber is still holding, and a later scope for the same session is a new
    // generation with its own membership rather than inheriting the old one (ABA).
    test("exact close leaves a consumed snapshot intact and grants the successor no membership", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const sessionID = SessionID.create()
          const scope = yield* coordinator.open(sessionID)
          yield* scope.reserve(SessionID.create())

          const parked = yield* parkedRead(scope, "first latched")
          yield* scope.degrade()
          const consumed = yield* parked
          expect(selectedText(consumed)).toBe("first latched")

          yield* scope.close()
          // The value a delayed fiber already consumed is unchanged by the close.
          expect(selectedText(consumed)).toBe("first latched")

          // Same session id, new generation: the predecessor's members carry no authority here, so
          // this scope resolves on its own evidence rather than inheriting anything.
          const successor = yield* coordinator.open(sessionID)
          expect(successor).not.toBe(scope)
          expect(selectedText(yield* resolve(successor, sessionID, "successor answer"))).toBe("successor answer")
        }),
      )
    })

    /**
     * THE RELEASE POINT — E1..E6.
     *
     * `publishResolution` copies `members` into `publishedMembers` and then clears `members`, at
     * publication. These six arms pin the two halves of that one statement: the copy must not alias,
     * and the clear must not run before the copy exists. Both failure modes are silent — they empty
     * the frozen snapshot, every covered Assistant reads as uncovered, and the coordinator answers
     * "fresh" to everyone. Nothing throws and no text changes; only the STRUCTURAL evidence differs.
     *
     * So every arm here pairs a covered ID against a distinct one and asserts on structure
     * (`candidate` / `observed` / `degraded`), never on selected text alone. An always-fresh
     * coordinator hands back the caller's own Assistant, whose text is frequently identical to the
     * one the resolution would have selected; text equality is satisfied by the bug.
     */
    // E1. Close is not a release point, and must leave the frozen snapshot readable. `close()` runs
    // AFTER publication here, so it has nothing left to clear -- publication already released the
    // mutable set. The arm that would catch an ALIASING copy is any covered-member arm at all, since
    // the clear now empties an aliased snapshot immediately; this one adds the close.
    test("E1: a closed scope still consumes its frozen member and keeps a distinct ID fresh", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          yield* owner(scope, reservation)
          yield* scope.settleTerminal(yield* markTerminal(scope, reservation))
          const a1 = assistant(scope.sessionID, "covered clean answer")
          yield* scope.observeTurn({ assistant: a1, clean: true })
          yield* scope.finishContinuation()
          // Published while open, then closed. Nothing about the close may reach the snapshot.
          yield* scope.close()

          const covered = yield* scope.result(a1)
          expect(covered.type).toBe("evidence")
          if (covered.type !== "evidence") return
          expect(covered.degraded).toBe(false)
          // THE ORACLE. Text cannot separate the two outcomes -- a fresh return hands back this same
          // Assistant as its own fallback and reads identically. A CONSUMED resolution carries the
          // published candidate; a fresh one carries only the caller's fallback.
          expect(covered.candidate).toBeDefined()
          expect(covered.candidate?.assistant.info.id).toBe(a1.info.id)

          const distinct = assistant(scope.sessionID, "never a member")
          const fresh = yield* scope.result(distinct)
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          expect(fresh.candidate).toBeUndefined()
          expect(selectedText(fresh)).toBe("never a member")
        }),
      )
    })

    // E2. THE ORDERING ARM. `close()` lands BEFORE any publication and cannot be the release point:
    // the owner's live continuation keeps the degraded gate parked, so `closeNow` degrades and
    // returns while the snapshot still does not exist. Only `finishContinuation()` -- one `apply`
    // later -- publishes. A release performed unconditionally inside `closeNow` would therefore
    // freeze an EMPTY membership here, and the covered Assistant below would come back fresh.
    test("E2: a close-triggered degraded publication freezes the membership close could not see", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          // Owner claim, deliberately left in flight: `active === 1` parks both gates, so nothing can
          // publish until this test says so.
          yield* owner(scope, reservation)
          const a1 = assistant(scope.sessionID, "observed before close")
          yield* scope.observeTurn({ assistant: a1, clean: true })

          yield* scope.close()
          // The precondition the arm rests on: closed, degraded, and STILL UNRESOLVED. Without this
          // the test would silently degenerate into E1's publish-then-close ordering.
          expect(scope.current().failed).toBe(true)
          expect(yield* coordinator.locate(scope.sessionID)).toBeUndefined()
          const probeSettled = yield* Deferred.make<void>()
          yield* scope
            .result(assistant(scope.sessionID, "probe while unresolved"))
            .pipe(Effect.ensuring(Deferred.succeed(probeSettled, undefined)), Effect.forkChild)
          yield* Effect.yieldNow
          // Still PARKED, which is the precondition stated as an assertion: no resolution exists yet,
          // so the close that already ran had no snapshot to release and must have released nothing.
          expect(yield* Deferred.isDone(probeSettled)).toBe(false)

          // One `apply` later, the degraded gate resolves and the snapshot is taken.
          yield* scope.finishContinuation()
          yield* Deferred.await(probeSettled)

          const covered = yield* scope.result(a1)
          expect(covered.type).toBe("evidence")
          if (covered.type !== "evidence") return
          expect(covered.degraded).toBe(true)
          expect(covered.candidate).toBeDefined()
          expect(covered.candidate?.assistant.info.id).toBe(a1.info.id)

          const fresh = yield* scope.result(assistant(scope.sessionID, "arrived after publication"))
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          // Fresh evidence is non-degraded and structure-free; a consumed degraded one is neither.
          expect(fresh.degraded).toBe(false)
          expect(fresh.candidate).toBeUndefined()
        }),
      )
    })

    // E3. EVERY unresolved entrant enrols, not just the one whose fallback latches. W2 shares W1's
    // resolution through the Deferred without needing membership, so the shared-waiter arm above
    // cannot see whether W2 was enrolled. Presenting W2's Assistant AGAIN, after publication, is
    // what reads the frozen snapshot directly.
    test("E3: a later waiter's Assistant is enrolled even though the first fallback latched", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          // Blocks the never-attached immediate mint so both callers genuinely park.
          yield* scope.reserve(SessionID.create())
          const park = (value: SessionV1.WithParts) =>
            Effect.gen(function* () {
              const done = yield* Deferred.make<void>()
              yield* scope.result(value).pipe(Effect.ensuring(Deferred.succeed(done, undefined)), Effect.forkChild)
              return done
            })

          const w1 = assistant(scope.sessionID, "first waiter")
          const w2 = assistant(scope.sessionID, "second waiter")
          const first = yield* park(w1)
          const second = yield* park(w2)
          yield* Effect.yieldNow
          expect(yield* Deferred.isDone(first)).toBe(false)
          expect(yield* Deferred.isDone(second)).toBe(false)

          yield* scope.degrade()
          yield* Deferred.await(first)
          yield* Deferred.await(second)

          // W2 latched nothing: the retained fallback is W1's. If enrolment rode the latch, W2 would
          // be absent from the snapshot and this would hand W2 its own Assistant back as fresh.
          const covered = yield* scope.result(w2)
          expect(covered.type).toBe("evidence")
          if (covered.type !== "evidence") return
          expect(covered.degraded).toBe(true)
          expect(selectedText(covered)).toBe("first waiter")

          const fresh = yield* scope.result(assistant(scope.sessionID, "third, never parked"))
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          expect(fresh.degraded).toBe(false)
          expect(selectedText(fresh)).toBe("third, never parked")
        }),
      )
    })

    // E4. The `observeTurn` refusal guard, held as a standing assertion. Every publication sets
    // `closed`, so an observation arriving afterwards is refused outright -- it enrols nothing and,
    // equally, leaves the scope's visible evidence alone. The freshness half below is a CONTROL
    // (membership already governs it); the state half is the oracle, and it fails the moment the
    // guard is removed and a post-publication turn starts writing candidate evidence into a scope
    // whose answer is already frozen.
    test("E4: an observation arriving after publication neither enrols nor changes the scope", async () => {
      await runAttached(
        Effect.gen(function* () {
          const { scope, first } = yield* publishedDegraded({})
          const before = scope.current()
          expect(before.candidate).toBe(false)

          const late = assistant(scope.sessionID, "observed after publication")
          yield* scope.observeTurn({ assistant: late, clean: true })
          expect(scope.current()).toEqual(before)

          const fresh = yield* scope.result(late)
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          expect(fresh.degraded).toBe(false)
          expect(fresh.candidate).toBeUndefined()
          expect(selectedText(fresh)).toBe("observed after publication")

          // Control: the frozen cohort still governs, so a real member still consumes.
          const covered = yield* scope.result(first)
          expect(covered.type).toBe("evidence")
          if (covered.type !== "evidence") return
          expect(covered.degraded).toBe(true)
          expect(selectedText(covered)).toBe("frozen first fallback")
        }),
      )
    })

    // E5a. CP-032 §9.2 row 1, OBSERVED-SELECTED half. The candidate-selected half is the CLEAN arm
    // near the top of this block; this one publishes a clean resolution whose selection is a
    // non-clean observed turn released by a wake. `observed` rather than `candidate` is the
    // structure that separates consumption from freshness here -- the texts are identical.
    test("E5a: a wake-released OBSERVED selection is consumed by its own frozen member", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          yield* owner(scope, reservation)
          yield* scope.settleTerminal(yield* markTerminal(scope, reservation))
          const dirty = assistant(scope.sessionID, "observed non-clean turn")
          yield* scope.observeTurn({ assistant: dirty, clean: false })
          expect(scope.current().candidate).toBe(false)
          expect(yield* scope.beginWake()).toBe(true)
          yield* scope.endWake()
          yield* scope.exhaustWake()
          yield* scope.finishContinuation()

          const covered = yield* scope.result(dirty)
          expect(covered.type).toBe("evidence")
          if (covered.type !== "evidence") return
          // A clean resolution, selected through `observed`, and NOT degraded by the exhausted wake.
          expect(covered.degraded).toBe(false)
          expect(covered.observed).toBeDefined()
          expect(covered.observed?.assistant.info.id).toBe(dirty.info.id)
          expect(selectedText(covered)).toBe("observed non-clean turn")

          const fresh = yield* scope.result(assistant(scope.sessionID, "distinct after publication"))
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          expect(fresh.observed).toBeUndefined()
          expect(fresh.candidate).toBeUndefined()
        }),
      )
    })

    // E5b. CP-032 §9.2 row 4, DEGRADED half. The clean half is the displaced-observed arm above.
    // Membership is history, so an Assistant displaced out of the candidate slot by a later `own()`
    // must still consume the resolution that eventually publishes -- whether that resolution is
    // clean or degraded. Trio-matching and clear-on-invalidate both revive A1 as fresh here.
    test("E5b: a displaced Assistant consumes a DEGRADED later selection rather than filing itself", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const reservation = yield* scope.reserve(SessionID.create())
          yield* owner(scope, reservation)
          // Taken before the displacement, for the reason the clean sibling records: `own()` moves
          // the epoch and a later marker would never settle.
          const marker = yield* markTerminal(scope, reservation)

          const a1 = assistant(scope.sessionID, "displaced yield")
          yield* scope.observeTurn({ assistant: a1, clean: true })
          expect(scope.current().candidate).toBe(true)
          yield* scope.own(MessageID.ascending())
          expect(scope.current().candidate).toBe(false)

          const a2 = assistant(scope.sessionID, "later degraded answer")
          yield* scope.observeTurn({ assistant: a2, clean: true })
          yield* scope.settleTerminal(marker)
          yield* scope.degrade()
          yield* scope.finishContinuation()

          const covered = yield* scope.result(a1)
          expect(covered.type).toBe("evidence")
          if (covered.type !== "evidence") return
          expect(covered.degraded).toBe(true)
          expect(covered.candidate?.assistant.info.id).toBe(a2.info.id)
          // A1's own text is the stale progress this must never file.
          expect(selectedText(covered)).toBe("later degraded answer")

          const fresh = yield* scope.result(assistant(scope.sessionID, "still producing"))
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          expect(fresh.degraded).toBe(false)
          expect(fresh.candidate).toBeUndefined()
        }),
      )
    })

    // E6. THE IMMEDIATE-MINT SITE. `result()`'s never-attached arm publishes inline, so it is the one
    // publication point where the caller's own Assistant is both the enrolling entrant and the
    // arriving comparand -- and therefore the one place a copy/clear ORDER SWAP is invisible to
    // every other arm. The observation before the mint is what makes the oracle discriminating: it
    // gives the published resolution a `candidate`, so a consumed second arrival is structurally
    // distinct from a fresh one even though both carry the same text.
    test("E6: an immediate never-attached mint covers its own caller, and only its own caller", async () => {
      await runAttached(
        Effect.gen(function* () {
          const coordinator = yield* AttachmentCoordinator.make
          const scope = yield* coordinator.open(SessionID.create())
          const a = assistant(scope.sessionID, "immediate answer")
          // Never attached, so this cannot publish yet; it only enrols and fills the candidate slot.
          yield* scope.observeTurn({ assistant: a, clean: true })

          const minted = yield* scope.result(a)
          expect(minted.type).toBe("evidence")
          if (minted.type !== "evidence") return
          expect(minted.degraded).toBe(false)
          expect(minted.candidate?.assistant.info.id).toBe(a.info.id)

          // Same ID again, now post-publication. Copy-then-clear makes this a member; clear-then-copy
          // freezes an empty set and hands back bare fresh evidence with the SAME text.
          const again = yield* scope.result(a)
          expect(again.type).toBe("evidence")
          if (again.type !== "evidence") return
          expect(again.degraded).toBe(false)
          expect(again.candidate).toBeDefined()
          expect(again.candidate?.assistant.info.id).toBe(a.info.id)

          const fresh = yield* scope.result(assistant(scope.sessionID, "distinct arrival"))
          expect(fresh.type).toBe("evidence")
          if (fresh.type !== "evidence") return
          expect(fresh.candidate).toBeUndefined()
          expect(selectedText(fresh)).toBe("distinct arrival")
        }),
      )
    })
  })
})
