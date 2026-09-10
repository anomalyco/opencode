import type { BackgroundJob } from "@/background/job"

/**
 * A synthetic execution admission for tests.
 *
 * `StartInput.admission` and `ExtendInput.admission` are REQUIRED, so a test cannot start or
 * extend a job without stating one. That is the point: omission is a compile error rather than a
 * silent unfenced pass, and it is why no permissive layer exists for this anywhere.
 *
 * This is a function rather than a layer, and that distinction is the whole safety argument. A
 * permissive LAYER is selectable by a production wiring site by accident, with no type error and
 * no runtime signal - the silent-composition shape this codebase has hit three times. A helper
 * under `test/lib` cannot be reached from `src/` at all, and every use is a visible call at the
 * site that needs it.
 *
 * The coordinates are deliberately not real: these tests run against a permissive or stubbed
 * binder, where the admission is relayed and granted rather than validated. A test that wants a
 * REAL admission decision must acquire a real lease from a real coordinator - see
 * `closure-job-bind.test.ts`'s `holdLease`, which is the opposite of this and should stay so.
 */
export const syntheticAdmission = (tag = "test"): BackgroundJob.Admission => ({
  lease: `lease_synthetic_${tag}`,
  epoch: 0n,
})

/**
 * A detected answer for tests that care about a job's answers.
 *
 * A run reports the position it answered at - in production the run's final assistant message id
 * and that message's creation time - plus an opaque payload the registry never inspects. Tests pass
 * the payload they want to assert on, and `position`/`at` only need to be unique and ordered
 * relative to each other within one lifetime.
 */
export const answered = (position: string, at: number, detected: unknown = position): BackgroundJob.Detected => ({
  position,
  at,
  detected,
})

/**
 * A run that completes without producing an answer.
 *
 * This is the right shape for the many lifecycle tests that exercise binding, cancellation or
 * discovery rather than delivery: they need a run that settles, not one that files something.
 */
export const noAnswer: BackgroundJob.SequenceOutcome = undefined
