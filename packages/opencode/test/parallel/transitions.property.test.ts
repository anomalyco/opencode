import { describe, expect, test } from "bun:test"
import fc from "fast-check"
import {
  VALID_PLAN_TRANSITIONS,
  VALID_WORKER_TRANSITIONS,
  canTransition,
  canTransitionWorker,
  validateTransition,
  validateWorkerTransition,
  isPlanTerminal,
  isWorkerTerminal,
  InvalidTransitionError,
} from "../../src/parallel/transitions"
import type { PlanStatus, WorkerStatus } from "../../src/parallel/schema"

const PLAN_STATUSES: PlanStatus[] = [
  "draft",
  "proposed",
  "approved",
  "spawning",
  "running",
  "merging",
  "integrating",
  "recovering",
  "integrated",
  "publishing",
  "partial_success",
  "cancelled",
  "done",
  "failed",
]

const WORKER_STATUSES: WorkerStatus[] = [
  "pending",
  "spawning",
  "running",
  "stopping",
  "done",
  "failed",
  "merged",
  "conflict",
]

const planStatusArb = fc.oneof(...PLAN_STATUSES.map((s) => fc.constant(s)))
const workerStatusArb = fc.oneof(...WORKER_STATUSES.map((s) => fc.constant(s)))

describe("Plan Transitions - Property Tests", () => {
  test("canTransition(from, to) === true implies transition is allowed", () => {
    fc.assert(
      fc.property(planStatusArb, planStatusArb, (from, to) => {
        const allowed = VALID_PLAN_TRANSITIONS[from].includes(to)
        expect(canTransition(from, to)).toBe(allowed)
      }),
      { numRuns: 1000 },
    )
  })

  test("validateTransition throws iff canTransition returns false", () => {
    fc.assert(
      fc.property(planStatusArb, planStatusArb, (from, to) => {
        const allowed = canTransition(from, to)
        if (allowed) {
          expect(() => validateTransition(from, to)).not.toThrow()
        } else {
          expect(() => validateTransition(from, to)).toThrow(InvalidTransitionError)
        }
      }),
      { numRuns: 1000 },
    )
  })

  test("terminal states have no valid outgoing transitions except failed -> draft", () => {
    const terminalStatuses: PlanStatus[] = ["done", "failed", "partial_success", "cancelled"]

    fc.assert(
      fc.property(fc.oneof(...terminalStatuses.map((s) => fc.constant(s))), planStatusArb, (from, to) => {
        const allowed = canTransition(from, to)
        if (from === "failed" && to === "draft") {
          expect(allowed).toBe(true)
        } else {
          expect(allowed).toBe(false)
        }
      }),
      { numRuns: 400 },
    )
  })

  test("non-terminal states have at least one valid outgoing transition", () => {
    const nonTerminalStatuses: PlanStatus[] = [
      "draft",
      "proposed",
      "approved",
      "spawning",
      "running",
      "merging",
      "integrating",
      "recovering",
      "integrated",
      "publishing",
    ]

    for (const status of nonTerminalStatuses) {
      const transitions = VALID_PLAN_TRANSITIONS[status]
      expect(transitions.length).toBeGreaterThan(0)
    }
  })

  test("all transitions in VALID_PLAN_TRANSITIONS are bidirectionally consistent", () => {
    for (const [from, targets] of Object.entries(VALID_PLAN_TRANSITIONS)) {
      for (const to of targets) {
        expect(canTransition(from as PlanStatus, to)).toBe(true)
      }
    }
  })

  test("isPlanTerminal correctly identifies terminal states", () => {
    fc.assert(
      fc.property(planStatusArb, (status) => {
        const terminal = isPlanTerminal(status)
        const hasOutgoing = VALID_PLAN_TRANSITIONS[status].length > 0
        const isActuallyTerminal = !hasOutgoing || (status === "failed" && VALID_PLAN_TRANSITIONS[status].length === 1)

        if (isActuallyTerminal && status !== "cancelled") {
          expect(terminal).toBe(true)
        }
      }),
      { numRuns: 500 },
    )
  })
})

describe("Worker Transitions - Property Tests", () => {
  test("canTransitionWorker(from, to) === true implies transition is allowed", () => {
    fc.assert(
      fc.property(workerStatusArb, workerStatusArb, (from, to) => {
        const allowed = VALID_WORKER_TRANSITIONS[from].includes(to)
        expect(canTransitionWorker(from, to)).toBe(allowed)
      }),
      { numRuns: 1000 },
    )
  })

  test("validateWorkerTransition throws iff canTransitionWorker returns false", () => {
    fc.assert(
      fc.property(workerStatusArb, workerStatusArb, (from, to) => {
        const allowed = canTransitionWorker(from, to)
        if (allowed) {
          expect(() => validateWorkerTransition(from, to)).not.toThrow()
        } else {
          expect(() => validateWorkerTransition(from, to)).toThrow(InvalidTransitionError)
        }
      }),
      { numRuns: 1000 },
    )
  })

  test("terminal worker states have no valid outgoing transitions except failed -> pending", () => {
    const terminalStatuses: WorkerStatus[] = ["merged", "conflict"]

    fc.assert(
      fc.property(fc.oneof(...terminalStatuses.map((s) => fc.constant(s))), workerStatusArb, (from, to) => {
        const allowed = canTransitionWorker(from, to)
        expect(allowed).toBe(false)
      }),
      { numRuns: 200 },
    )

    expect(canTransitionWorker("failed", "pending")).toBe(true)
  })

  test("non-terminal worker states have at least one valid outgoing transition", () => {
    const nonTerminalStatuses: WorkerStatus[] = ["pending", "spawning", "running", "stopping", "done", "failed"]

    for (const status of nonTerminalStatuses) {
      const transitions = VALID_WORKER_TRANSITIONS[status]
      expect(transitions.length).toBeGreaterThan(0)
    }
  })

  test("all transitions in VALID_WORKER_TRANSITIONS are bidirectionally consistent", () => {
    for (const [from, targets] of Object.entries(VALID_WORKER_TRANSITIONS)) {
      for (const to of targets) {
        expect(canTransitionWorker(from as WorkerStatus, to)).toBe(true)
      }
    }
  })

  test("isWorkerTerminal correctly identifies terminal states", () => {
    fc.assert(
      fc.property(workerStatusArb, (status) => {
        const terminal = isWorkerTerminal(status)
        const hasOutgoing = VALID_WORKER_TRANSITIONS[status].length > 0

        if (status === "merged" || status === "conflict") {
          expect(terminal).toBe(true)
          expect(hasOutgoing).toBe(false)
        } else if (status === "failed") {
          expect(terminal).toBe(true)
        }
      }),
      { numRuns: 500 },
    )
  })
})

describe("Transition Table Integrity", () => {
  test("VALID_PLAN_TRANSITIONS contains all plan statuses", () => {
    const definedStatuses = Object.keys(VALID_PLAN_TRANSITIONS)
    expect(definedStatuses.sort()).toEqual(PLAN_STATUSES.sort())
  })

  test("VALID_WORKER_TRANSITIONS contains all worker statuses", () => {
    const definedStatuses = Object.keys(VALID_WORKER_TRANSITIONS)
    expect(definedStatuses.sort()).toEqual(WORKER_STATUSES.sort())
  })

  test("no duplicate transitions in VALID_PLAN_TRANSITIONS", () => {
    for (const [from, targets] of Object.entries(VALID_PLAN_TRANSITIONS)) {
      const uniqueTargets = [...new Set(targets)]
      expect(targets).toEqual(uniqueTargets)
    }
  })

  test("no duplicate transitions in VALID_WORKER_TRANSITIONS", () => {
    for (const [from, targets] of Object.entries(VALID_WORKER_TRANSITIONS)) {
      const uniqueTargets = [...new Set(targets)]
      expect(targets).toEqual(uniqueTargets)
    }
  })
})
