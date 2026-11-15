import { describe, expect, test } from "bun:test"
import type { Schema } from "effect"
import {
  initialEarlyWindowState,
  isEarlyWindowClosed,
  transitionEarlyWindow,
  type EarlyWindowCommand,
  type EarlyWindowEvent,
  type EarlyWindowState,
} from "./early-machine"
import { persistedWindowIDs } from "./registry"

type Entry = { readonly name: string }

const entry: Entry = { name: "early" }

const logged = (_url: string) => undefined

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly EarlyWindowEvent<Entry>[], from = initialEarlyWindowState<Entry>()) {
  return events.reduce<{ state: EarlyWindowState<Entry>; commands: (readonly EarlyWindowCommand<Entry>[])[] }>(
    (result, event) => {
      const next = transitionEarlyWindow(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

const created = (id: string): EarlyWindowEvent<Entry> => ({ type: "early.created", id, entry })

const restore = (ids: readonly string[], destroyed = false): EarlyWindowEvent<Entry> => ({
  type: "restore.requested",
  ids,
  fallbackId: "fallback",
  destroyed,
  openExternal: logged,
})

describe("early window", () => {
  // The early window and the registry read the same persisted value; a malformed first entry used to give the early
  // window an id the registry dropped, so restoring destroyed the visible window and opened a hidden one.
  test.each([
    [["", "win-2"], "win-2"],
    [[42, "win-2"], "win-2"],
    [[""], undefined],
    ["junk", undefined],
  ] satisfies [Schema.Json, string | undefined][])(
    "adopts the early window when the persisted list is %j",
    (stored, id) => {
      const ids = persistedWindowIDs(stored)
      const early = ids[0] ?? "generated"
      const result = replay([created(early), restore(ids)])

      expect(early).toBe(id ?? "generated")
      expect(result.state).toEqual({ status: "adopted", id: early, entry, openExternal: logged })
      expect(result.commands.at(-1)).toEqual([
        {
          type: "restore-windows",
          plan: [{ kind: "adopt", id: early, entry }, ...ids.slice(1).map((id) => ({ kind: "create", id }))],
        },
      ])
    },
  )

  test.each([
    ["closes", [created("a"), { type: "early.closed", entry }, restore(["a"])]],
    ["is destroyed", [created("a"), restore(["a"], true), restore(["a"])]],
  ] satisfies [string, EarlyWindowEvent<Entry>[]][])(
    "quits and restores no window when the early window %s before adoption",
    (_name, events) => {
      const result = replay(events)

      expect(isEarlyWindowClosed(result.state)).toBe(true)
      expect(result.commands.slice(1)).toEqual([[{ type: "quit" }], []])
    },
  )

  test("opens external links directly, then through the logged handler once adopted", () => {
    const pending = replay([created("a"), { type: "external.opened", entry, url: "https://a.test" }])

    const adopted = replay(
      [restore(["a"]), { type: "external.opened", entry, url: "https://b.test" }, { type: "early.closed", entry }],
      pending.state,
    )

    expect(pending.commands.at(-1)).toEqual([{ type: "open-external-early", url: "https://a.test" }])
    expect(adopted.commands.slice(1)).toEqual([
      [{ type: "open-external-adopted", url: "https://b.test", openExternal: logged }],
      [],
    ])
    expect(adopted.state.status).toBe("none")
  })

  test("discards the early window when its id is no longer persisted", () => {
    const result = replay([created("a"), restore(["other"])])

    expect(result.state.status).toBe("none")
    expect(result.commands.at(-1)).toEqual([
      { type: "destroy-early", entry },
      { type: "restore-windows", plan: [{ kind: "create", id: "other" }] },
    ])
  })

  test("creates every window when none is pending, as the macOS dock reopens them", () => {
    const adopted = replay([created("a"), restore(["a"])]).state

    expect(replay([restore([])]).commands).toEqual([
      [{ type: "restore-windows", plan: [{ kind: "create", id: "fallback" }] }],
    ])
    expect(replay([restore(["a", "b"])], adopted).commands).toEqual([
      [
        {
          type: "restore-windows",
          plan: [
            { kind: "create", id: "a" },
            { kind: "create", id: "b" },
          ],
        },
      ],
    ])
  })

  test("ignores events for another window or after the early window closed", () => {
    const pending = replay([created("a")]).state
    const other = { name: "other" }
    const closed = replay([{ type: "early.closed", entry }], pending).state

    expect(transitionEarlyWindow(pending, { type: "early.closed", entry: other }).state).toBe(pending)
    expect(transitionEarlyWindow(pending, created("b")).state).toBe(pending)
    expect(transitionEarlyWindow(closed, { type: "external.opened", entry, url: "https://a.test" })).toEqual({
      state: closed,
      commands: [],
    })
  })
})
