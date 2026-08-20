import { Effect } from "effect"
import type { SessionPhysical } from "@/session/physical-interrupt"

/**
 * A recording `SessionPhysical` for `TaskPromptOps` literals.
 *
 * `physical` is a required member, so every fixture that builds a `TaskPromptOps` must state one.
 * That is deliberate: an absent physical interrupt degrades toward not interrupting, and a compile
 * error is a better failure than a delegated execution that quietly keeps running.
 *
 * This records rather than dies, unlike `unusedJobs` in `closure.ts`. That fake dies because an
 * unstubbed job call means the test is not exercising what it claims, and a benign answer would let
 * the fake decide admission. Neither applies here: `reportExact` is reached from `executeTask`'s
 * interrupt finalizer on ordinary teardown, so many tests cross this seam incidentally, and a no-op
 * cannot make a safety guard permissive because these fixtures have no real Runner for a physical
 * interrupt to miss.
 *
 * It answers `interrupted` rather than `in_progress` because that is the truthful reply when
 * nothing else holds the identity, which is the case in every fixture that uses this. A test that
 * needs the in-flight case should drive the real service, where the report/adopt split is the
 * behaviour under test rather than a stub's opinion.
 */
export type PhysicalLog = {
  readonly interrupted: SessionPhysical.Target[]
  readonly reported: SessionPhysical.Target[]
}

export const physicalLog = (): PhysicalLog => ({ interrupted: [], reported: [] })

export const recordingPhysical = (log: PhysicalLog = physicalLog()): SessionPhysical.Interface => ({
  interruptExact: (target) =>
    Effect.sync(() => {
      log.interrupted.push(target)
      return { type: "interrupted" as const }
    }),
  reportExact: (target) =>
    Effect.sync(() => {
      log.reported.push(target)
      return { type: "interrupted" as const }
    }),
})
