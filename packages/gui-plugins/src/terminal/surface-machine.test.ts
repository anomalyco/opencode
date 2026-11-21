import { describe, expect, test } from "bun:test"
import {
  initialSurfaceState,
  surfaceAt,
  surfaceMounts,
  surfaceShown,
  transitionSurface,
  type SurfaceEvent,
  type SurfaceState,
  type SurfaceTransition,
} from "./surface-machine"

const NOWHERE: ReadonlySet<string> = new Set()

// The panel's sync for the side region showing ses_1's pty_1 under the first server connection.
const sync = (input: Partial<Omit<Extract<SurfaceEvent, { type: "sync" }>, "type">> = {}): SurfaceEvent => ({
  type: "sync",
  session: "ses_1",
  ready: true,
  connection: 1,
  opened: true,
  mobile: false,
  active: "pty_1",
  terminalIDs: ["pty_1", "pty_2"],
  elsewhere: NOWHERE,
  ...input,
})

// Folds the events in order and returns the last transition.
const replay = (events: readonly SurfaceEvent[], state: SurfaceState = initialSurfaceState) =>
  events.reduce<SurfaceTransition>((last, event) => transitionSurface(last.state, event), { state, effects: [] })

const surfaces = (state: SurfaceState) => surfaceMounts(state).map((mount) => surfaceAt(state, mount))

describe("terminal surface machine", () => {
  test("a server restart mounts the shown terminal whose socket ended again, once", () => {
    const failed = replay([sync(), { type: "surface.failed", mount: 1 }]).state

    // It stays mounted, under the same mount, to say why.
    expect(surfaces(failed)).toEqual([{ session: "ses_1", id: "pty_1", mount: 1, connection: 1, status: "failed" }])

    // Before, it stayed "Terminal disconnected" after the restarted server listed it again.
    const restarted = transitionSurface(failed, sync({ connection: 2 })).state

    expect(surfaces(restarted)).toEqual([{ session: "ses_1", id: "pty_1", mount: 2, connection: 2, status: "live" }])

    // A socket that ends again under the same connection stays failed rather than mounting in a loop.
    const again = replay([{ type: "surface.failed", mount: 2 }, sync({ connection: 2 })], restarted).state

    expect(surfaces(again)).toEqual([{ session: "ses_1", id: "pty_1", mount: 2, connection: 2, status: "failed" }])
  })

  test("a socket from before a restart that ends after the newer connection listed the session mounts again", () => {
    const relisted = replay([sync(), sync({ connection: 2 })]).state

    expect(surfaces(relisted)).toEqual([{ session: "ses_1", id: "pty_1", mount: 1, connection: 1, status: "live" }])

    const late = transitionSurface(relisted, { type: "surface.failed", mount: 1 }).state

    expect(surfaces(late)).toEqual([{ session: "ses_1", id: "pty_1", mount: 2, connection: 2, status: "live" }])
  })

  test("a failure from a mount that was replaced or already failed changes nothing", () => {
    const remounted = replay([sync(), { type: "surface.failed", mount: 1 }, sync({ connection: 2 })]).state

    expect(transitionSurface(remounted, { type: "surface.failed", mount: 1 }).state).toBe(remounted)

    const failed = transitionSurface(remounted, { type: "surface.failed", mount: 2 }).state

    expect(transitionSurface(failed, { type: "surface.failed", mount: 2 }).state).toBe(failed)
    expect(transitionSurface(initialSurfaceState, { type: "surface.failed", mount: 1 }).state).toBe(initialSurfaceState)
  })

  test("hidden terminals stay mounted until their socket ends, and a failed one leaves once it hides", () => {
    const both = replay([sync(), sync({ active: "pty_2" })]).state

    expect(surfaceMounts(both)).toEqual([1, 2])
    expect(surfaces(both).map((surface) => surface && surfaceShown(both, surface))).toEqual([false, true])

    // A hidden terminal whose socket ends leaves at once.
    const dropped = transitionSurface(both, { type: "surface.failed", mount: 1 }).state

    expect(surfaceMounts(dropped)).toEqual([2])

    // A failed one leaves once another tab shows, and mounts anew when it shows again.
    const failed = transitionSurface(dropped, { type: "surface.failed", mount: 2 }).state
    const away = transitionSurface(failed, sync({ active: "pty_1" })).state

    expect(surfaces(away)).toEqual([{ session: "ses_1", id: "pty_1", mount: 3, connection: 1, status: "live" }])
    expect(surfaceMounts(transitionSurface(away, sync({ active: "pty_2" })).state)).toEqual([3, 4])
  })

  test("a closed panel drops a failed terminal and mounts nothing new", () => {
    const failed = replay([sync(), { type: "surface.failed", mount: 1 }]).state

    expect(surfaceMounts(transitionSurface(failed, sync({ opened: false })).state)).toEqual([])

    // A live one stays mounted while the panel is closed.
    const live = replay([sync(), sync({ opened: false })]).state

    expect(surfaceMounts(live)).toEqual([1])
    expect(transitionSurface(live, { type: "surface.failed", mount: 1 }).state).toMatchObject({ surfaces: [] })
  })

  test("another session, an unlisted terminal or one moved to another pane leaves", () => {
    const both = replay([sync(), sync({ active: "pty_2" })]).state

    expect(surfaceMounts(transitionSurface(both, sync({ terminalIDs: ["pty_2"] })).state)).toEqual([2])
    expect(surfaceMounts(transitionSurface(both, sync({ elsewhere: new Set(["pty_1"]) })).state)).toEqual([2])

    const other = transitionSurface(both, sync({ session: "ses_2", active: "pty_9", terminalIDs: ["pty_9"] })).state

    expect(surfaces(other)).toEqual([{ session: "ses_2", id: "pty_9", mount: 3, connection: 1, status: "live" }])

    // A list that isn't known drops every mount; mount numbers keep counting.
    const unlisted = transitionSurface(other, sync({ ready: false })).state

    expect(surfaceMounts(unlisted)).toEqual([])
    expect(surfaceMounts(transitionSurface(unlisted, sync()).state)).toEqual([4])
  })

  test("an unchanged sync keeps the same state", () => {
    const ready = replay([sync()]).state

    expect(transitionSurface(ready, sync()).state).toBe(ready)
    expect(transitionSurface(ready, sync({ terminalIDs: ["pty_1", "pty_2"] })).state).toBe(ready)

    const idle = transitionSurface(initialSurfaceState, sync({ ready: false }))

    expect(idle.state).toBe(initialSurfaceState)
    expect(idle.effects).toEqual([])
  })

  test("the narrow-screen view creates the first terminal of each empty session it shows in a row, once", () => {
    const mobile = (input: Partial<Omit<Extract<SurfaceEvent, { type: "sync" }>, "type">> = {}) =>
      sync({ mobile: true, active: null, terminalIDs: [], ...input })

    // Nothing until the list is known.
    const loading = transitionSurface(initialSurfaceState, mobile({ ready: false }))

    expect(loading.effects).toEqual([])

    const first = transitionSurface(loading.state, mobile())

    expect(first.effects).toEqual([{ type: "create-terminal" }])

    // The created terminal shows; emptying the session again while it stays shown creates nothing.
    const shown = transitionSurface(first.state, mobile({ active: "pty_1", terminalIDs: ["pty_1"] }))
    const emptied = transitionSurface(shown.state, mobile())

    expect(shown.effects).toEqual([])
    expect(emptied.effects).toEqual([])

    // Another empty session gets its own, and so does the first again after it.
    const other = transitionSurface(emptied.state, mobile({ session: "ses_2" }))

    expect(other.effects).toEqual([{ type: "create-terminal" }])
    expect(transitionSurface(other.state, mobile()).effects).toEqual([{ type: "create-terminal" }])

    // Closing the view, or the side region, forgets the session.
    const closed = transitionSurface(other.state, mobile({ session: "ses_2", opened: false }))

    expect(closed.effects).toEqual([])
    expect(transitionSurface(closed.state, mobile({ session: "ses_2" })).effects).toEqual([{ type: "create-terminal" }])
    expect(transitionSurface(initialSurfaceState, sync({ terminalIDs: [], active: null })).effects).toEqual([])
    expect(transitionSurface(initialSurfaceState, mobile({ terminalIDs: ["pty_1"] })).effects).toEqual([])
  })
})
