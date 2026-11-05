import { describe, expect, test } from "bun:test"
import {
  createOptimisticSettingState,
  selectSettingMeta,
  selectSettingValue,
  transitionOptimisticSetting,
  type OptimisticSettingEffect,
  type OptimisticSettingEvent,
  type OptimisticSettingState,
} from "./machine"

type Event = OptimisticSettingEvent<string, string[], string>
type State = OptimisticSettingState<string, string[], string>

function replay(events: Event[], state: State = createOptimisticSettingState("", [])) {
  return events.reduce<{ state: State; effects: readonly OptimisticSettingEffect<string, string>[] }>(
    (step, event) => transitionOptimisticSetting(step.state, event),
    { state, effects: [] },
  )
}

// A server whose saved shell is zsh.
const loaded: Event[] = [
  { type: "source.synced", source: "server-a" },
  { type: "load.succeeded", attempt: 1, value: "/bin/zsh", meta: ["zsh", "bash", "fish"] },
]

describe("optimistic setting machine", () => {
  test("a failed first write does not roll back over the newer choice, which goes next", () => {
    const queued = replay([
      ...loaded,
      { type: "write.requested", value: "bash" },
      { type: "write.requested", value: "fish" },
    ])
    expect(selectSettingValue(queued.state)).toBe("fish")
    expect(queued.effects).toEqual([])

    const failed = replay([{ type: "write.failed", attempt: 2, error: new Error("boom") }], queued.state)
    expect(selectSettingValue(failed.state)).toBe("fish")
    expect(failed.effects).toEqual([
      { type: "write", attempt: 3, source: "server-a", value: "fish", timeoutMs: 15_000 },
    ])

    const saved = replay([{ type: "write.succeeded", attempt: 3 }], failed.state)
    expect(saved.state).toMatchObject({ status: "idle", value: "fish" })
    expect(saved.effects).toEqual([])
  })

  test("a queued write that fails rolls back to what the server saved, not to the value before both", () => {
    const failed = replay([
      ...loaded,
      { type: "write.requested", value: "bash" },
      { type: "write.requested", value: "fish" },
      { type: "write.succeeded", attempt: 2 },
      { type: "write.failed", attempt: 3, error: new Error("boom") },
    ])

    expect(failed.state).toMatchObject({ status: "idle", value: "bash" })
    expect(failed.effects).toEqual([{ type: "notify.error", failure: { kind: "failed", error: new Error("boom") } }])
  })

  test("a slow failure of an older toggle cannot flip the switch after newer toggles saved", () => {
    const toggled = replay(
      [
        { type: "source.synced", source: "desktop" },
        { type: "load.succeeded", attempt: 1, value: "off", meta: [] },
        { type: "write.requested", value: "on" },
        { type: "write.requested", value: "off" },
        { type: "write.requested", value: "on" },
      ],
      createOptimisticSettingState("off", []),
    )
    // Choosing the value on the wire again drops the queued revert.
    expect(toggled.state).toMatchObject({ status: "writing", active: "on", queued: undefined })

    const saved = replay([{ type: "write.succeeded", attempt: 2 }], toggled.state)
    expect(saved.state).toMatchObject({ status: "idle", value: "on" })

    const reverted = replay([{ type: "write.requested", value: "off" }], toggled.state)
    expect(reverted.state).toMatchObject({ active: "on", queued: { value: "off" } })
    // The revert matches what the source kept, so a failure needs neither a write nor a toast.
    const rolledBack = replay([{ type: "write.failed", attempt: 2, error: undefined }], reverted.state)
    expect(rolledBack.state).toMatchObject({ status: "idle", value: "off" })
    expect(rolledBack.effects).toEqual([])
  })

  test("a late first read keeps the choice made meanwhile and only moves the rollback target", () => {
    const writing = replay([
      { type: "source.synced", source: "server-a" },
      { type: "write.requested", value: "bash" },
      { type: "load.succeeded", attempt: 1, value: "/bin/zsh", meta: ["zsh", "bash"] },
    ])
    expect(selectSettingValue(writing.state)).toBe("bash")
    expect(selectSettingMeta(writing.state)).toEqual(["zsh", "bash"])
    expect(writing.state).toMatchObject({ confirmed: "/bin/zsh" })

    const failed = replay([{ type: "write.failed", attempt: 2, error: undefined }], writing.state)
    expect(selectSettingValue(failed.state)).toBe("/bin/zsh")
  })

  test("a read that answers after the write saved fills the shell list without undoing the choice", () => {
    const state = replay([
      { type: "source.synced", source: "server-a" },
      { type: "write.requested", value: "bash" },
      { type: "write.succeeded", attempt: 2 },
      { type: "load.succeeded", attempt: 1, value: "/bin/zsh", meta: ["zsh", "bash"] },
    ]).state

    expect(selectSettingValue(state)).toBe("bash")
    expect(selectSettingMeta(state)).toEqual(["zsh", "bash"])
  })

  test("new credentials read again and ignore the previous server's write result", () => {
    const writing = replay([...loaded, { type: "write.requested", value: "bash" }])
    const switched = replay([{ type: "source.synced", source: "server-b" }], writing.state)
    expect(switched.effects).toEqual([{ type: "load", attempt: 3, source: "server-b" }])

    const stale = transitionOptimisticSetting(switched.state, { type: "write.failed", attempt: 2, error: undefined })
    expect(stale.state).toBe(switched.state)
    expect(stale.effects).toEqual([])
    expect(transitionOptimisticSetting(switched.state, { type: "load.succeeded", attempt: 1, value: "x", meta: [] }).state).toBe(
      switched.state,
    )

    const read = replay([{ type: "load.succeeded", attempt: 3, value: "fish", meta: [] }], switched.state)
    expect(selectSettingValue(read.state)).toBe("fish")
  })

  test("a write that times out rolls back, reports it and reads the source again", () => {
    const timedOut = replay([
      ...loaded,
      { type: "write.requested", value: "bash" },
      { type: "write.timed-out", attempt: 2 },
    ])

    expect(timedOut.state).toMatchObject({ status: "idle", value: "/bin/zsh" })
    expect(timedOut.effects).toEqual([
      { type: "notify.error", failure: { kind: "timeout" } },
      { type: "load", attempt: 3, source: "server-a" },
    ])
    expect(transitionOptimisticSetting(timedOut.state, { type: "write.succeeded", attempt: 2 }).state).toBe(
      timedOut.state,
    )
  })

  test("without a source the setting keeps its value and takes no writes", () => {
    const disabled = replay([...loaded, { type: "source.synced", source: undefined }])
    expect(disabled.state).toMatchObject({ status: "disabled", value: "/bin/zsh" })

    const ignored = transitionOptimisticSetting(disabled.state, { type: "write.requested", value: "bash" })
    expect(ignored.state).toBe(disabled.state)
    expect(ignored.effects).toEqual([])
  })
})
