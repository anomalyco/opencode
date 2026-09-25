const RESERVED_CONTEXT_KEYS = ["draftID", "revision", "signal"] as const
type ReservedContextKey = (typeof RESERVED_CONTEXT_KEYS)[number]
export type DeepReadonly<Value> = Value extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
    : Value
export type PromptTransformCurrent = { revision: number; fingerprint: string }
export type PromptTransformCallerContext<Context extends object> = Omit<Context, ReservedContextKey> &
  Partial<Record<ReservedContextKey, never>>
export type PromptTransformContext<Context extends object> = DeepReadonly<Omit<Context, ReservedContextKey>> & {
  readonly draftID: string
  readonly revision: number
  readonly signal: AbortSignal
}
export type PromptTransformRegistration<Draft extends object, Context extends object> = {
  id: string
  transform: (draft: DeepReadonly<Draft>, context: PromptTransformContext<Context>) => Draft | Promise<Draft>
}
export type PromptTransformRequest<Draft extends object, Context extends object> = PromptTransformCurrent & {
  draftID: string
  draft: Draft
  context: PromptTransformCallerContext<Context>
  current: () => PromptTransformCurrent
  commit: (draft: Draft) => undefined
}
type Registration<Draft extends object, Context extends object> = PromptTransformRegistration<Draft, Context> & {
  jobs: Set<Job<Draft, Context>>
}
type Accepted<Draft extends object, Context extends object> = Omit<
  PromptTransformRequest<Draft, Context>,
  "draft" | "context"
> & {
  draft: DeepReadonly<Draft>
  context: DeepReadonly<PromptTransformCallerContext<Context>>
}
type Job<Draft extends object, Context extends object> = Accepted<Draft, Context> & {
  steps: Registration<Draft, Context>[]
  state: DraftState<Draft, Context>
  controller: AbortController
  settled: PromiseWithResolvers<boolean>
  dead: boolean
  commitStarted: boolean
}
type DraftState<Draft extends object, Context extends object> = {
  latest: PromptTransformCurrent
  active?: Job<Draft, Context>
  queued?: Job<Draft, Context>
}
export function createPromptTransformCoordinator<Draft extends object, Context extends object>(
  fingerprint: (draft: DeepReadonly<Draft>) => string,
) {
  const registrations = new Map<string, Registration<Draft, Context>>()
  const drafts = new Map<string, DraftState<Draft, Context>>()
  const disposedDrafts = new Set<string>()
  function register(input: PromptTransformRegistration<Draft, Context>) {
    const id = input.id
    if (registrations.has(id)) throw new Error(`Prompt transform "${id}" is already registered`)
    const registration: Registration<Draft, Context> = { ...input, id, jobs: new Set() }
    // Map insertion order is transform order; deleting and re-registering appends after survivors.
    registrations.set(id, registration)
    let disposed = false
    return () => {
      if (disposed) return
      disposed = true
      registrations.delete(id)
      cancel([...registration.jobs])
    }
  }
  function apply(request: PromptTransformRequest<Draft, Context>): Promise<boolean> {
    if (disposedDrafts.has(request.draftID)) return Promise.resolve(false)
    if (RESERVED_CONTEXT_KEYS.some((key) => key in request.context)) {
      throw new TypeError("Prompt transform context contains reserved metadata")
    }
    const accepted: Accepted<Draft, Context> = {
      ...request,
      draft: immutablePlain(request.draft),
      context: immutablePlain(request.context),
    }
    if (fingerprint(accepted.draft) !== accepted.fingerprint || !matches(snapshotCurrent(accepted.current), accepted)) {
      return Promise.resolve(false)
    }
    const state = drafts.get(accepted.draftID) ?? { latest: { revision: -1, fingerprint: "" } }
    drafts.set(accepted.draftID, state)
    if (accepted.revision < state.latest.revision) return Promise.resolve(false)
    if (accepted.revision === state.latest.revision && accepted.fingerprint !== state.latest.fingerprint) {
      return Promise.resolve(false)
    }
    if (state.active && live(state.latest, state.active) && matches(state.active, accepted))
      return state.active.settled.promise
    if (state.queued && !state.queued.controller.signal.aborted && matches(state.queued, accepted))
      return state.queued.settled.promise
    const replaced = [state.active, state.queued]
    const job = createJob(accepted, state)
    state.latest = accepted
    state.queued = job
    cancel(replaced)
    runNext(state)
    return job.settled.promise
  }
  function createJob(accepted: Accepted<Draft, Context>, state: DraftState<Draft, Context>) {
    const snapshot = [...registrations.values()]
    const job = accepted as Job<Draft, Context>
    job.steps = snapshot
    job.state = state
    job.controller = new AbortController()
    job.settled = Promise.withResolvers()
    job.dead = false
    job.commitStarted = false
    snapshot.forEach((registration) => registration.jobs.add(job))
    const cancel = () => {
      detach(job)
      if (!job.commitStarted && job.state.active !== job) job.settled.resolve(false)
    }
    job.controller.signal.addEventListener("abort", cancel, { once: true })
    return job
  }
  function runNext(state: DraftState<Draft, Context>) {
    if (state.active || !state.queued) return
    const job = state.queued
    state.queued = undefined
    if (job.dead || job.controller.signal.aborted || !matches(state.latest, job)) {
      job.controller.abort()
      runNext(state)
      return
    }
    state.active = job
    let committed = false
    const failures: unknown[] = []
    void compose(job)
      .then((draft) => {
        if (draft === undefined || !live(state.latest, job)) return
        const observed = snapshotCurrent(job.current)
        const resultFingerprint = fingerprint(draft)
        if (resultFingerprint === job.fingerprint || !live(state.latest, job) || !matches(observed, job)) return
        const next = structuredClone(draft) as Draft
        const confirmed = snapshotCurrent(job.current)
        if (!live(state.latest, job) || !matches(confirmed, job)) return
        job.commitStarted = true
        job.commit(next)
        committed = true
      })
      .catch((error) => {
        if (!job.commitStarted && job.controller.signal.aborted) return
        failures.push(error)
      })
      .finally(() => {
        detach(job)
        if (state.active === job) state.active = undefined
        runNext(state)
        if (failures.length) job.settled.reject(failures[0])
        else job.settled.resolve(committed)
      })
  }
  function detach(job: Job<Draft, Context>) {
    job.steps.forEach((registration) => registration.jobs.delete(job))
  }
  function cancel(items: Array<Job<Draft, Context> | undefined>) {
    items.forEach((job) => {
      if (!job) return
      if (job.state.queued === job) job.state.queued = undefined
      job.dead = true
    })
    items.forEach((job) => job?.controller.abort())
  }
  function disposeDraft(draftID: string) {
    if (disposedDrafts.has(draftID)) return
    disposedDrafts.add(draftID)
    const state = drafts.get(draftID)
    if (!state) return
    const affected = [state.active, state.queued]
    Object.assign(state, { active: undefined, queued: undefined })
    drafts.delete(draftID)
    cancel(affected)
  }
  return { register, apply, disposeDraft }
}
async function compose<Draft extends object, Context extends object>(job: Job<Draft, Context>) {
  let draft = job.draft
  for (const registration of job.steps) {
    if (job.controller.signal.aborted) return
    const context = immutableContext(job.context, job.draftID, job.revision, job.controller.signal)
    draft = immutablePlain(await registration.transform(draft, context))
  }
  return draft
}
function live<Draft extends object, Context extends object>(current: PromptTransformCurrent, job: Job<Draft, Context>) {
  return !job.dead && !job.controller.signal.aborted && matches(current, job)
}
function matches(current: PromptTransformCurrent, expected: PromptTransformCurrent) {
  return current.revision === expected.revision && current.fingerprint === expected.fingerprint
}
function snapshotCurrent(current: () => PromptTransformCurrent): PromptTransformCurrent {
  const value = current()
  return { revision: value.revision, fingerprint: value.fingerprint }
}
function immutableContext<Context extends object>(
  context: DeepReadonly<PromptTransformCallerContext<Context>>,
  draftID: string,
  revision: number,
  signal: AbortSignal,
) {
  const value = Object.assign(structuredClone(context), { draftID, revision, signal })
  return freeze(value) as PromptTransformContext<Context>
}
function immutablePlain<Value extends object>(value: Value): DeepReadonly<Value> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Prompt transform data must be a plain object")
  assertPlain(value, new Set())
  return freeze(structuredClone(value)) as DeepReadonly<Value>
}
function assertPlain(value: unknown, seen: Set<object>) {
  if (value === null || ["string", "number", "boolean", "bigint", "undefined"].includes(typeof value)) return
  if (typeof value !== "object") throw new TypeError("Prompt transform data must contain only plain structured data")
  if (seen.has(value)) return
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError("Prompt transform data must contain only plain structured data")
  }
  seen.add(value)
  Object.values(value).forEach((item) => assertPlain(item, seen))
}
function freeze(value: unknown, seen = new Set<object>()): unknown {
  if (!value || typeof value !== "object" || seen.has(value)) return value
  seen.add(value)
  Object.values(value).forEach((item) => freeze(item, seen))
  return Object.freeze(value)
}
