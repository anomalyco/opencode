import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { MainStoreFrom } from "@opencode/gui-extensions/sdk/main"
import { Schema } from "effect"
import { openDatabase, type Database } from "../storage/database"
import { createStateStore, type StateStore } from "../storage/state"
import { createSettingsStore, type SettingsStore } from "../storage/store"
import { createStorage, type SettingsFiles } from "./storage"

const roots: string[] = []

// Bun's node:sqlite shim pins the WAL files on Windows after close(); tolerate the leftover here only.
afterEach(() =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }).catch(() => undefined))),
)

const directory = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "opencode-extension-storage-"))
  roots.push(root)

  return root
}

/** The desktop's settings files in `root`, one store per file as the app keeps them. */
const settingsIn = (root: string): SettingsFiles => {
  const files = new Map<string, SettingsStore>()

  return (file = "opencode.settings") => {
    const existing = files.get(file)

    if (existing) return existing
    const created = createSettingsStore(path.join(root, file))
    files.set(file, created)

    return created
  }
}

const open = (db: Database, settings: SettingsFiles) => {
  const storage = createStorage(createStateStore(db), settings, "example")

  return {
    storage,
    store: storage.store("servers", { schema: Schema.Array(Schema.String), initial: [] }),
  }
}

/** Where the built-ins kept their main state before `from`: settings files, and pairing's state namespace row. */
type Seed = {
  readonly settings?: readonly { readonly file: string; readonly key: string; readonly value: object }[]
  readonly state?: string
}

describe("main extension storage", () => {
  // A crash right after saving keeps the value: another connection reads it without any flush.
  test.each([
    {
      name: "update",
      write: (opened: ReturnType<typeof open>) =>
        opened.store.update((draft) => {
          draft.push("a")
        }),
      expected: ["a"],
    },
    {
      // The open store holds what was stored, not the caller's list, which changes afterwards.
      name: "set copies a list",
      write: (opened: ReturnType<typeof open>) => {
        const list = ["a"]

        opened.store.set(list)
        list.push("b")
      },
      expected: ["a"],
    },
    {
      name: "remove",
      write: (opened: ReturnType<typeof open>) => {
        opened.store.set(["a"])
        opened.storage.remove("servers")
      },
      expected: [],
    },
    {
      // Every store opened on a key reads one value: this one read before another store on the key wrote.
      name: "an update through another store on the key",
      write: (opened: ReturnType<typeof open>) => {
        expect(opened.store.value).toEqual([])
        opened.storage.store("servers", { schema: Schema.Array(Schema.String), initial: [] }).set(["a"])
      },
      expected: ["a"],
    },
    {
      name: "update rejects a returned replacement",
      write: (opened: ReturnType<typeof open>) =>
        expect(() => {
          // @ts-expect-error JavaScript extensions can still return a replacement at runtime
          opened.store.update(() => ["wrong"])
        }).toThrow("Use set"),
      expected: [],
    },
    {
      name: "set and update retain call order",
      write: (opened: ReturnType<typeof open>) => {
        opened.store.update((draft) => {
          draft.push("before")
        })
        opened.store.set(["replaced"])
        opened.store.update((draft) => {
          draft.push("after")
        })
      },
      expected: ["replaced", "after"],
    },
  ])("$name reaches the database before it returns, and the open store reads it", async (row) => {
    const root = await directory()
    const file = path.join(root, "drafts.sqlite")
    const writer = openDatabase(file)
    const reader = openDatabase(file)
    const settings = settingsIn(root)
    const opened = open(writer.db, settings)
    row.write(opened)
    expect({
      stored: open(reader.db, settings).store.value,
      open: opened.store.value,
      ready: opened.store.ready(),
    }).toEqual({
      stored: row.expected,
      open: row.expected,
      ready: true,
    })
    writer.close()
    reader.close()
  })

  test.each([7, null])("set persists the primitive %p immediately", async (next) => {
    const root = await directory()
    const file = path.join(root, "state.sqlite")
    const writer = openDatabase(file)
    const reader = openDatabase(file)
    const settings = settingsIn(root)
    const options = { schema: Schema.NullOr(Schema.Finite), initial: 0 }
    const store = createStorage(createStateStore(writer.db), settings, "example").store("value", options)
    store.set(next)

    expect(createStorage(createStateStore(reader.db), settings, "example").store("value", options).value).toBe(next)
    writer.close()
    reader.close()
  })

  // The built-ins moved their main state into declared stores: each older home imports into the same row, byte for
  // byte (an unknown field included), and `remove` with the same `from` deletes every home it names.
  test.each<{ name: string; from: MainStoreFrom | readonly MainStoreFrom[]; seed: Seed; id: string; row: string }>([
    {
      name: "a key of the app's settings file",
      from: { settings: "ssh.servers" },
      seed: { settings: [{ file: "opencode.settings", key: "ssh.servers", value: [{ id: "a", kept: 1 }] }] },
      id: "a",
      row: '[{"id":"a","kept":1}]',
    },
    {
      name: "a key of another settings file",
      from: { settings: "ready", file: "opencode.updater" },
      seed: { settings: [{ file: "opencode.updater", key: "ready", value: [{ id: "u" }] }] },
      id: "u",
      row: '[{"id":"u"}]',
    },
    {
      name: "a key of another state namespace",
      from: { state: ["opencode.settings", "keepScreenActive"] },
      seed: { state: '[{"id":"s"}]' },
      id: "s",
      row: '[{"id":"s"}]',
    },
    {
      name: "the newest home of a list that holds a value",
      from: [{ state: ["opencode.settings", "keepScreenActive"] }, { settings: "ssh.servers" }],
      seed: { settings: [{ file: "opencode.settings", key: "ssh.servers", value: [{ id: "older" }] }] },
      id: "older",
      row: '[{"id":"older"}]',
    },
    {
      name: "the next home of a list when the first holds a value the schema rejects",
      from: [{ state: ["opencode.settings", "keepScreenActive"] }, { settings: "ssh.servers" }],
      seed: {
        state: '"off"',
        settings: [{ file: "opencode.settings", key: "ssh.servers", value: [{ id: "older" }] }],
      },
      id: "older",
      row: '[{"id":"older"}]',
    },
    {
      name: "the first home of a list when several hold a value",
      from: [{ state: ["opencode.settings", "keepScreenActive"] }, { settings: "ssh.servers" }],
      seed: {
        state: '[{"id":"newer"}]',
        settings: [{ file: "opencode.settings", key: "ssh.servers", value: [{ id: "older" }] }],
      },
      id: "newer",
      row: '[{"id":"newer"}]',
    },
  ])("imports $name once, and remove forgets every home", async (input) => {
    const root = await directory()
    const database = openDatabase(path.join(root, "state.sqlite"))
    const state = createStateStore(database.db)
    const settings = settingsIn(root)

    input.seed.settings?.forEach((item) => settings(item.file).set(item.key, item.value))

    if (input.seed.state) state.set("opencode.settings", "keepScreenActive", input.seed.state)

    const storage = createStorage(state, settings, "example")
    const schema = Schema.Array(Schema.Struct({ id: Schema.String }))
    const store = storage.store("servers", { schema, initial: [], from: input.from })
    const imported = { value: store.value.map((item) => item.id), row: state.get("extension.example", "servers") }

    storage.remove("servers", { from: input.from })

    expect({ ...imported, left: homes(state, settings) }).toEqual({ value: [input.id], row: input.row, left: [] })
    database.close()
  })
})

/** Every older home the table seeds that still holds a value. */
function homes(state: StateStore, settings: SettingsFiles) {
  return [
    state.get("opencode.settings", "keepScreenActive"),
    settings().get("ssh.servers"),
    settings("opencode.updater").get("ready"),
  ].filter((value) => value !== null && value !== undefined)
}
