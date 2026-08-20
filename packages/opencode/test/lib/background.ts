import type { BackgroundJob } from "@/background/job"

/**
 * A synthetic execution admission for tests.
 *
 * `StartInput.admission` and `ExtendInput.admission` are optional: omitting one selects the
 * permissive binder, which is the behaviour of a caller that predates admission. This helper is for
 * the opposite case — a test that wants to state an admission explicitly and see it relayed.
 *
 * It is a function rather than a layer deliberately. A permissive layer is selectable by a
 * production wiring site by accident, with no type error and no runtime signal. A helper under
 * `test/lib` cannot be reached from `src/` at all, and every use is a visible call at the site that
 * needs it.
 *
 * The coordinates are not real: these tests run against a permissive or stubbed binder, where the
 * admission is relayed and granted rather than validated. A test that wants a real admission
 * decision must acquire a real lease from a real coordinator — see `closure-job-bind.test.ts`'s
 * `holdLease`, which is the opposite of this and should stay so.
 */
export const syntheticAdmission = (tag = "test"): BackgroundJob.Admission => ({
  lease: `lease_synthetic_${tag}`,
  epoch: 0n,
})
