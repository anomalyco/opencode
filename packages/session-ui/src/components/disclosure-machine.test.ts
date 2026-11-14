import { describe, expect, test } from "bun:test"
import {
  createDisclosureState,
  transitionDisclosure,
  viewDisclosure,
  type DisclosureEvent,
  type DisclosureProps,
  type DisclosureState,
} from "./disclosure-machine"

const free = { locked: false, pending: false, allowOpenWhilePending: false }

const props = (value: Partial<DisclosureProps> = {}): DisclosureProps => ({
  open: undefined,
  defaultOpen: false,
  forceOpen: false,
  defer: false,
  ...value,
})

const sync = (value: Partial<DisclosureProps>): DisclosureEvent => ({ type: "props.sync", props: props(value) })

const toggle = (open: boolean, defer = false, capabilities = free): DisclosureEvent => ({
  type: "toggle.requested",
  open,
  defer,
  capabilities,
})

const open = (state: DisclosureState) => viewDisclosure(state, free).open

describe("disclosure", () => {
  test("asks a controlled owner to open once per rising forceOpen", () => {
    const initial = createDisclosureState(props({ open: false, forceOpen: true }), "frame")

    expect(initial.effects).toEqual([{ type: "notify", open: true }])
    const repeated = transitionDisclosure(initial.state, sync({ open: false, forceOpen: true }))

    expect(repeated.state).toBe(initial.state)
    expect(repeated.effects).toEqual([])
    const dropped = transitionDisclosure(repeated.state, sync({ open: false }))
    const raised = transitionDisclosure(dropped.state, sync({ open: false, forceOpen: true }))

    expect(dropped.effects).toEqual([])
    expect(raised.effects).toEqual([{ type: "notify", open: true }])
  })

  test("keeps an uncontrolled disclosure open after forceOpen drops", () => {
    const forced = transitionDisclosure(createDisclosureState(props(), "frame").state, sync({ forceOpen: true }))
    const kept = transitionDisclosure(forced.state, sync({}))

    expect(forced.effects).toEqual([{ type: "notify", open: true }])
    expect(open(kept.state)).toBe(true)
  })

  test("leaves a controlled state to its owner, and falls back to defaultOpen when the owner lets go", () => {
    const controlled = createDisclosureState(props({ open: false }), "frame").state
    const asked = transitionDisclosure(controlled, toggle(true))

    expect(asked.state).toBe(controlled)
    expect(asked.effects).toEqual([{ type: "notify", open: true }])
    const released = transitionDisclosure(asked.state, sync({ open: undefined, defaultOpen: false }))

    expect(released.state).toMatchObject({ status: "closed", control: "uncontrolled", touched: false })
  })

  test("toggles an uncontrolled disclosure and still tells the owner", () => {
    const opened = transitionDisclosure(createDisclosureState(props(), "frame").state, toggle(true))

    expect(opened.state).toMatchObject({ status: "open", touched: true })
    expect(opened.effects).toEqual([{ type: "notify", open: true }])
    expect(open(transitionDisclosure(opened.state, sync({ defaultOpen: false })).state)).toBe(true)
  })

  test("follows defaultOpen until the user toggles", () => {
    const initial = createDisclosureState(props(), "frame").state
    const followed = transitionDisclosure(initial, sync({ defaultOpen: true }))

    expect(open(followed.state)).toBe(true)
    expect(followed.effects).toEqual([])
  })

  test("never reports a closed body as mounted, and drops the frame of an earlier open", () => {
    const initial = createDisclosureState(props({ defaultOpen: true, defer: true }), "deferred")

    expect(initial.effects).toEqual([{ type: "schedule-mount", attempt: 1, queue: "deferred" }])
    expect(viewDisclosure(initial.state, free).mounted).toBe(false)
    const closed = transitionDisclosure(initial.state, toggle(false, true))

    expect(closed.effects).toEqual([
      { type: "cancel-mount", attempt: 1 },
      { type: "notify", open: false },
    ])
    expect(viewDisclosure(closed.state, free)).toMatchObject({ open: false, mounted: false })
    const reopened = transitionDisclosure(closed.state, toggle(true, true))

    expect(reopened.effects).toEqual([
      { type: "schedule-mount", attempt: 2, queue: "frame" },
      { type: "notify", open: true },
    ])
    expect(transitionDisclosure(reopened.state, { type: "mount.ready", attempt: 1 }).state).toBe(reopened.state)
    const mounted = transitionDisclosure(reopened.state, { type: "mount.ready", attempt: 2 })

    expect(viewDisclosure(mounted.state, free).mounted).toBe(true)
  })

  test("closes on a controlled prop without waiting for an effect", () => {
    const mounted = transitionDisclosure(createDisclosureState(props({ open: true, defer: true }), "frame").state, {
      type: "mount.ready",
      attempt: 1,
    })

    const closed = transitionDisclosure(mounted.state, sync({ open: false, defer: true }))

    expect(viewDisclosure(closed.state, free)).toMatchObject({ open: false, mounted: false })
  })

  test("ignores toggles while locked or pending", () => {
    const initial = createDisclosureState(props(), "frame").state
    const locked = transitionDisclosure(initial, toggle(true, false, { ...free, locked: true }))
    const pending = transitionDisclosure(initial, toggle(true, false, { ...free, pending: true }))

    const allowed = transitionDisclosure(
      initial,
      toggle(true, false, { ...free, pending: true, allowOpenWhilePending: true }),
    )

    expect(locked.state).toBe(initial)
    expect(pending.state).toBe(initial)
    expect(open(allowed.state)).toBe(true)
    expect(viewDisclosure(initial, { ...free, pending: true }).canToggle).toBe(false)
  })

  test("cancels a scheduled mount on dispose and ignores its frame", () => {
    const initial = createDisclosureState(props({ defaultOpen: true, defer: true }), "deferred")
    const disposed = transitionDisclosure(initial.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "cancel-mount", attempt: 1 }])
    expect(transitionDisclosure(disposed.state, { type: "mount.ready", attempt: 1 }).state).toBe(disposed.state)
  })
})
