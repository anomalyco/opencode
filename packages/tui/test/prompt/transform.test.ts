import { describe, expect, test } from "bun:test"
import { createPromptTransformCoordinator, type DeepReadonly } from "../../src/prompt/transform"
type Draft = { text: string; detail: { values: string[] }; self?: Draft }
type Context = { metadata: { label: string } }
const draft = (text = "source"): Draft => ({ text, detail: { values: ["value"] } })
const fingerprint = (value: DeepReadonly<Draft>) => JSON.stringify({ text: value.text, detail: value.detail })
function harness(text = "source", revision = 1, draftID = "draft-1") {
  const value = draft(text)
  const current = { revision, fingerprint: fingerprint(value) }
  const commits: Draft[] = []
  const request = {
    draftID,
    revision,
    draft: value,
    fingerprint: current.fingerprint,
    context: { metadata: { label: "original" } },
    current: () => current,
    commit: (next: Draft) => (commits.push(next), undefined),
  }
  return { current, commits, request }
}
function revise(run: ReturnType<typeof harness>, value: Draft, revision: number) {
  Object.assign(run.current, { revision, fingerprint: fingerprint(value) })
  return { ...run.request, revision, draft: value, fingerprint: run.current.fingerprint }
}
describe("prompt transform coordinator", () => {
  test("orders registrations and snapshots a mutable registration ID", async () => {
    const coordinator = createPromptTransformCoordinator<Draft, Context>(fingerprint)
    const calls: string[] = []
    let completedAborts = 0
    const transform = (id: string) => async (_: DeepReadonly<Draft>, context: { signal: AbortSignal }) => {
      calls.push(id)
      if (calls.length === 1) context.signal.addEventListener("abort", () => completedAborts++)
      return draft(id)
    }
    const input = { id: "first", transform: transform("first") }
    const dispose = coordinator.register(input)
    coordinator.register({ id: "second", transform: transform("second") })
    input.id = "changed"
    dispose()
    coordinator.register({ id: "first", transform: transform("first") })
    const run = harness()
    const first = coordinator.apply(run.request)
    let replay!: Promise<boolean>
    await first.then(() => {
      replay = coordinator.apply(run.request)
      coordinator.disposeDraft(run.request.draftID)
    })
    expect(calls).toEqual(["second", "first", "second"])
    expect(completedAborts).toBe(0)
  })
  test("freezes cyclic boundaries, rejects built-ins, and detaches commit input", async () => {
    const coordinator = createPromptTransformCoordinator<Draft, Context>(fingerprint)
    const run = harness()
    run.request.draft.self = run.request.draft
    let output!: Draft
    coordinator.register({
      id: "first",
      transform: async (value, context) => {
        expect(value.self).toBe(value)
        expect([value, value.detail, context, context.metadata, context.signal].every(Object.isFrozen)).toBe(true)
        return (output = draft(`${value.text}:first`))
      },
    })
    coordinator.register({
      id: "second",
      transform: async (value) => {
        expect(value).not.toBe(output)
        expect(Object.isFrozen(value)).toBe(true)
        return (output = draft(`${value.text}:second`))
      },
    })
    expect([await coordinator.apply(run.request), run.commits[0] === output]).toEqual([true, false])
    const invalid = { ...run.request.context, mutable: new Map() } as Context
    expect(() => coordinator.apply({ ...run.request, context: invalid })).toThrow("plain structured data")
  })
  test("snapshots and coalesces active and queued requests", async () => {
    const coordinator = createPromptTransformCoordinator<Draft, Context>(fingerprint)
    const gate = Promise.withResolvers<void>()
    coordinator.register({
      id: "controlled",
      async transform(value, context) {
        if (context.revision === 1) await gate.promise
        return draft(`${value.text}:${context.metadata.label}`)
      },
    })
    const run = harness()
    const active = coordinator.apply(run.request)
    expect(coordinator.apply(run.request)).toBe(active)
    run.current.revision = 2
    const queued = { ...run.request, revision: 2 }
    const next = coordinator.apply(queued)
    expect(coordinator.apply(queued)).toBe(next)
    queued.revision = 9
    queued.draftID = queued.fingerprint = "changed"
    queued.current = () => ({ revision: 9, fingerprint: "changed" })
    queued.commit = () => undefined
    queued.draft.text = "changed"
    queued.context.metadata.label = "changed"
    gate.resolve()
    expect(await Promise.all([active, next])).toEqual([false, true])
    expect(run.commits[0]?.text).toBe("source:original")
  })
  test("preserves reentrant work published by a superseding abort", async () => {
    const coordinator = createPromptTransformCoordinator<Draft, Context>(fingerprint)
    const gate = Promise.withResolvers<void>()
    const run = harness()
    let reentrant!: Promise<boolean>
    coordinator.register({
      id: "controlled",
      async transform(value, context) {
        if (context.revision === 1) {
          context.signal.addEventListener("abort", () => {
            run.current.revision = 3
            reentrant = coordinator.apply({ ...run.request, revision: 3 })
          })
          await gate.promise
        }
        return draft(`${value.text}:${context.revision}`)
      },
    })
    const active = coordinator.apply(run.request)
    run.current.revision = 2
    const superseded = coordinator.apply({ ...run.request, revision: 2 })
    gate.resolve()
    expect(await Promise.all([active, superseded, reentrant])).toEqual([false, false, true])
  })
  test("registration disposal publishes cancellation before abort listeners run", async () => {
    const coordinator = createPromptTransformCoordinator<Draft, Context>(fingerprint)
    const run = harness()
    let reentrant!: Promise<boolean>
    const dispose = coordinator.register({
      id: "removed",
      transform: (value, context) =>
        new Promise((resolve) => {
          context.signal.addEventListener("abort", () => {
            run.current.revision = 2
            reentrant = coordinator.apply({ ...run.request, revision: 2 })
            resolve(draft(`${value.text}:removed`))
          })
        }),
    })
    coordinator.register({ id: "survivor", transform: async (value) => draft(`${value.text}:survivor`) })
    const active = coordinator.apply(run.request)
    dispose()
    expect(await Promise.all([active, reentrant])).toEqual([false, true])
  })
  test("commit reentrancy wins, exceptions recover, and stale branches reject", async () => {
    const coordinator = createPromptTransformCoordinator<Draft, Context>(fingerprint)
    coordinator.register({ id: "edit", transform: async (value) => draft(`${value.text}:done`) })
    const committed = harness("commit", 1, "commit")
    let nested!: Promise<boolean>
    committed.request.commit = () => {
      committed.current.revision = 2
      nested = coordinator.apply({ ...committed.request, revision: 2, commit: () => undefined })
      coordinator.disposeDraft(committed.request.draftID)
      return undefined
    }
    expect(await coordinator.apply(committed.request)).toBe(true)
    expect(await nested).toBe(false)
    const run = harness("failure", 1, "failure")
    run.request.commit = () => {
      throw new Error("commit failed")
    }
    await expect(coordinator.apply(run.request)).rejects.toThrow("commit failed")
    const next = draft("next")
    expect(await coordinator.apply({ ...revise(run, next, 2), commit: () => undefined })).toBe(true)
    const stale = draft("stale")
    expect(await coordinator.apply(revise(run, stale, 1))).toBe(false)
    const conflict = draft("conflict")
    expect(await coordinator.apply(revise(run, conflict, 2))).toBe(false)
  })
})
