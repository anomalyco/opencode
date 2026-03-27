import { ClientDatabase } from "@/storage/db"
import { ClientKVTable } from "@/storage/client-db.schema"
import { Global } from "@/global"
import { eq } from "drizzle-orm"
import { existsSync, readFileSync } from "fs"
import path from "path"
import { createSignal, type Setter } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"

function seed(file: string) {
  ClientDatabase.transaction((db) => {
    const row = db.select({ key: ClientKVTable.key }).from(ClientKVTable).limit(1).get()
    if (row) return
    if (!existsSync(file)) return

    const data = (() => {
      try {
        return JSON.parse(readFileSync(file, "utf-8"))
      } catch {
        return null
      }
    })()
    if (data === null || typeof data !== "object" || Array.isArray(data)) return

    const now = Date.now()
    const rows = Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => ({
        key,
        value,
        time_updated: now,
      }))

    if (rows.length === 0) return
    db.insert(ClientKVTable).values(rows).onConflictDoNothing().run()
  })
}

function list() {
  return Object.fromEntries(
    ClientDatabase.use((db) =>
      db.select({ key: ClientKVTable.key, value: ClientKVTable.value }).from(ClientKVTable).all(),
    ).map((row) => [row.key, row.value]),
  )
}

function write(key: string, value: unknown) {
  ClientDatabase.transaction((db) => {
    if (value === undefined) {
      db.delete(ClientKVTable).where(eq(ClientKVTable.key, key)).run()
      return
    }

    const now = Date.now()

    db.insert(ClientKVTable)
      .values({
        key,
        value,
        time_updated: now,
      })
      .onConflictDoUpdate({
        target: ClientKVTable.key,
        set: {
          value,
          time_updated: now,
        },
      })
      .run()
  })
}

export const { use: useKV, provider: KVProvider } = createSimpleContext({
  name: "KV",
  init: () => {
    const [ready, setReady] = createSignal(false)
    const [store, setStore] = createStore<Record<string, any>>()
    const file = path.join(Global.Path.state, "kv.json")

    seed(file)
    setStore(list())
    setReady(true)

    const result = {
      get ready() {
        return ready()
      },
      get store() {
        return store
      },
      signal<T>(name: string, defaultValue: T) {
        if (store[name] === undefined) setStore(name, defaultValue)
        return [
          function () {
            return result.get(name)
          },
          function setter(next: Setter<T>) {
            result.set(name, next)
          },
        ] as const
      },
      get(key: string, defaultValue?: any) {
        return store[key] ?? defaultValue
      },
      set(key: string, value: any) {
        setStore(key, value)
        write(key, store[key])
      },
    }
    return result
  },
})
