import { describe, expect, test } from "bun:test"
import { createComponent, createRoot, createSignal, onCleanup, type Accessor } from "solid-js"
import { Schema } from "effect"
import {
  createKeyed,
  createLatest,
  createVisitState,
  ExtensionContext,
  Live,
  type Context,
  type Persisted,
  type SessionRef,
} from "@opencode/gui-extensions/sdk"
import type { Platform } from "@/runtime/platform/platform"
import { flushPersisted } from "@/runtime/persistence/persist"
import { Persist, persisted, removePersisted } from "@/runtime/persistence/storage"
import { createLocatedWrites } from "@/runtime/extension/located"
import { createSessionStore, globalStoreTarget, persistedHandle, whenLoaded } from "@/runtime/extension/stores"

const pending = { status: "pending" } as const

const restarting = { status: "inactive", reason: "restarting" } as const

const first = { status: "active", value: "first", generation: 1 } as const

const second = { status: "active", value: "second", generation: 2 } as const

const Items = Schema.Struct({ items: Schema.mutable(Schema.Array(Schema.String)) })

const Noted = Schema.Struct({
  items: Schema.mutable(Schema.Array(Schema.String)),
  note: Schema.optional(Schema.String),
})

/** A web window: storage is the page's localStorage. */
const web: Platform = {
  platform: "web",
  openExternal: () => undefined,
  restart: async () => undefined,
  notify: async () => undefined,
  openDirectoryPickerDialog: async () => null,
}

/** A session the store and layout code can key and locate; they read nothing else. */
function session(key: Accessor<string>, location: Accessor<{ directory: string } | undefined>) {
  const value = {
    get key() {
      return key()
    },
    get location() {
      return location()
    },
  }

  // SAFETY: the code under test reads only `key` and `location`, which this value provides.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
  return value as unknown as SessionRef
}

describe("extension primitives", () => {
  test.each([
    {
      name: "a Live source runs once per generation and otherwise between them",
      start: () => {
        const [read, write] = createSignal<Live<string>>(pending)

        return {
          source: Live.accessor(read),
          steps: [first, { ...first }, restarting, second, pending].map((step) => () => write(step)),
        }
      },
      expected: [
        "otherwise",
        "end otherwise",
        "run first",
        "end first",
        "otherwise",
        "end otherwise",
        "run second",
        "end second",
        "otherwise",
      ],
    },
    {
      name: "a plain accessor runs once per value identity and otherwise while it is empty",
      start: () => {
        const [read, write] = createSignal<string | undefined>(undefined)

        return {
          source: read,
          steps: ["first", "first", undefined, "second", "third"].map((step) => () => write(step)),
        }
      },
      expected: [
        "otherwise",
        "end otherwise",
        "run first",
        "end first",
        "otherwise",
        "end otherwise",
        "run second",
        "end second",
        "run third",
      ],
    },
  ])("createKeyed: $name", (row) => {
    const log: string[] = []
    const scenario = row.start()

    const dispose = createRoot((dispose) => {
      createKeyed(
        scenario.source,
        (value) => {
          log.push(`run ${value}`)
          onCleanup(() => log.push(`end ${value}`))
        },
        {
          otherwise: () => {
            log.push("otherwise")
            onCleanup(() => log.push("end otherwise"))
          },
        },
      )

      return dispose
    })

    scenario.steps.forEach((step) => step())
    expect(log).toEqual(row.expected)
    dispose()
  })

  test("createLatest aborts the previous request and drops its late reply", async () => {
    const [key, setKey] = createSignal<string | undefined>("a")
    const requests = new Map<string, { signal: AbortSignal; reply: PromiseWithResolvers<string> }>()

    const root = createRoot((dispose) => ({
      dispose,
      latest: createLatest(key, (value, signal) => {
        const reply = Promise.withResolvers<string>()

        requests.set(value, { signal, reply })

        return reply.promise
      }),
    }))

    expect(root.latest.loading).toBe(true)
    setKey("b")
    requests.get("b")?.reply.resolve("result b")
    requests.get("a")?.reply.resolve("result a")
    await Bun.sleep(0)
    expect({
      aborted: [requests.get("a")?.signal.aborted, requests.get("b")?.signal.aborted],
      latest: root.latest.latest,
      loading: root.latest.loading,
    }).toEqual({ aborted: [true, false], latest: "result b", loading: false })
    root.dispose()
    expect(requests.get("b")?.signal.aborted).toBe(true)
  })

  test("createVisitState returns to its initial value on every routing visit", () => {
    const [visit, setVisit] = createSignal<object>({})
    const fake = { sessions: { list: () => [], current: () => ({ visit: visit() }) } }
    // SAFETY: `createVisitState` reads only `sessions.current().visit`, which this fake provides.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- see SAFETY above
    const context = fake as unknown as Context
    const captured: ReturnType<typeof createVisitState<string>>[] = []

    const dispose = createRoot((dispose) => {
      createComponent(ExtensionContext.Provider, {
        value: context,
        get children() {
          captured.push(createVisitState("initial"))

          return null
        },
      })

      return dispose
    })

    const [value, set] = captured[0] ?? [() => "missing", () => undefined]

    const steps = [
      { action: () => set("chosen"), expected: "chosen" },
      { action: () => setVisit({}), expected: "initial" },
      { action: () => set("again"), expected: "again" },
      { action: () => setVisit({}), expected: "initial" },
    ]

    expect(steps.map((step) => (step.action(), value()))).toEqual(steps.map((step) => step.expected))
    dispose()
  })

  test.each([
    { name: "while the storage read is held", location: { directory: "/repo" } },
    { name: "while the session location is unknown", location: undefined },
  ])("store writes made $name apply in order over the stored value", async (row) => {
    const held = Promise.withResolvers<void>()
    const key = `extension-store-${crypto.randomUUID()}`

    const platform: Platform = {
      platform: "desktop",
      windowID: "extension-store-test",
      openExternal: () => undefined,
      restart: async () => undefined,
      notify: async () => undefined,
      openDirectoryPickerDialog: async () => null,
      storage: () => ({
        getItem: async () => {
          await held.promise

          return JSON.stringify({ items: ["stored"] })
        },
        setItem: async () => undefined,
        removeItem: async () => undefined,
      }),
    }

    const [location, setLocation] = createSignal<{ directory: string } | undefined>(row.location)
    const opened: Persisted<(typeof Items)["Type"]>[] = []

    const root = createRoot((dispose) => {
      const store = createSessionStore({
        open: () => {
          const pair = persisted(Persist.global(key), Items, { items: [] }, platform)
          const handle = persistedHandle({ store: pair[0], set: pair[1], init: pair[3].promise })

          opened.push(handle)

          return handle
        },
        owner: null,
      })

      return {
        dispose: () => {
          store.dispose()
          dispose()
        },
        handle: store.get(session(() => "server\nses_store", location)),
      }
    })

    root.handle.update((draft) => void draft.items.push("first"))
    root.handle.update((draft) => void draft.items.push("second"))

    const before = { value: root.handle.value, ready: root.handle.ready() }

    setLocation({ directory: "/repo" })
    held.resolve()
    await Promise.all(opened.map(whenLoaded))
    expect({ before, after: root.handle.value?.items, ready: root.handle.ready() }).toEqual({
      before: { value: undefined, ready: false },
      after: ["stored", "first", "second"],
      ready: true,
    })
    root.dispose()
  })

  test.each([
    {
      name: "an edit to the draft",
      mutation: (draft: (typeof Noted)["Type"]) => void draft.items.push("b"),
      expected: { items: ["a", "b"], note: "kept" },
    },
    { name: "a returned value", mutation: () => ({ items: ["b"] }), expected: { items: ["b"] } },
  ])("store update: $name becomes the whole stored value", (row) => {
    const key = `extension-update-${crypto.randomUUID()}`

    localStorage.setItem(`opencode.global.dat:${key}`, JSON.stringify({ items: ["a"], note: "kept" }))

    const root = createRoot((dispose) => {
      const pair = persisted(Persist.global(key), Noted, { items: [] }, web)

      return { dispose, handle: persistedHandle({ store: pair[0], set: pair[1], init: pair[3].promise }) }
    })

    root.handle.update(row.mutation)
    flushPersisted()
    expect({
      value: root.handle.value,
      stored: JSON.parse(localStorage.getItem(`opencode.global.dat:${key}`) ?? "null"),
    }).toEqual({ value: row.expected, stored: row.expected })
    root.dispose()
  })

  test.each([
    {
      name: "a store whose older key was never imported",
      older: "old",
      seed: { items: ["old"] },
      from: (older: string) => older,
      opened: false,
      kept: null,
    },
    {
      name: "a store that picked its value from a shared key",
      older: "shared",
      seed: { prefs: { items: ["old"] }, other: 1 },
      from: (older: string) => ({ key: older, pick: (value: { prefs?: unknown } | null) => value?.prefs }),
      opened: true,
      kept: { prefs: { items: ["old"] }, other: 1 },
    },
  ])("store remove: $name reads its initial value again and never imports its older key", (row) => {
    const extension = `remove-${crypto.randomUUID()}`
    const older = `${row.older}-${extension}`
    const from = row.from(older)

    localStorage.setItem(older, JSON.stringify(row.seed))

    const open = () =>
      createRoot((dispose) => {
        const value = persisted(globalStoreTarget(extension, "items", from), Items, { items: [] }, web)[0]
        const items = [...value.items]

        dispose()

        return items
      })

    const imported = row.opened ? open() : undefined

    removePersisted(globalStoreTarget(extension, "items", from), web)
    expect({ imported, reopened: open(), older: JSON.parse(localStorage.getItem(older) ?? "null") }).toEqual({
      imported: row.opened ? ["old"] : undefined,
      reopened: [],
      older: row.kept,
    })
  })

  test("a session store opened through each routed session's object reads that session, A to B (pending) to A", () => {
    const [routed, setRouted] = createSignal("a")
    const [located, setLocated] = createSignal<readonly string[]>(["a"])

    // `MountedSession`s: one object per routed session, whose location is that session's, never the route's.
    const views = new Map(
      ["a", "b"].map((id) => [
        id,
        session(
          () => `server\n${id}`,
          () => (located().includes(id) ? { directory: `/${id}` } : undefined),
        ),
      ]),
    )

    const view = () =>
      views.get(routed()) ??
      session(
        () => "",
        () => undefined,
      )

    const opened: string[] = []

    const root = createRoot((dispose) => ({
      dispose,
      store: createSessionStore({
        open: (target) => {
          const directory = target.location?.directory ?? ""
          opened.push(directory)

          return persistedHandle({ store: { directory }, set: () => undefined, init: undefined })
        },
        owner: null,
      }),
    }))

    const a = root.store.get(view())

    const read = (handles: readonly Persisted<{ directory: string }>[]) =>
      handles.map((handle) => handle.value?.directory)

    setRouted("b")
    const b = root.store.get(view())
    const pending = read([a, b])
    setLocated(["a", "b"])
    const known = read([a, b])
    setRouted("a")
    const again = root.store.get(view())
    const back = read([again, b])

    expect({ pending, known, back, same: again === a, opened }).toEqual({
      pending: ["/a", undefined],
      known: ["/a", "/b"],
      back: ["/a", "/b"],
      same: true,
      opened: ["/a", "/b"],
    })
    root.store.dispose()
    root.dispose()
  })

  test("a layout write held while the session location is unknown runs once, in order, when it is known", () => {
    const [location, setLocation] = createSignal<{ directory: string } | undefined>()
    const target = session(() => "server\nses_layout", location)
    const log: string[] = []
    const root = createRoot((dispose) => ({ dispose, writes: createLocatedWrites() }))

    root.writes.hold(target, () => log.push("open"))
    root.writes.hold(target, () => log.push("scroll"))

    const before = [...log]

    setLocation({ directory: "/repo" })
    setLocation({ directory: "/repo" })
    expect({ before, after: log }).toEqual({ before: [], after: ["open", "scroll"] })
    root.dispose()
  })
})
