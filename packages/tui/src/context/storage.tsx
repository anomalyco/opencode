import { batch, createContext, onCleanup, useContext, type ParentProps } from "solid-js"
import { createStore, reconcile, type Store } from "solid-js/store"
import path from "path"
import { mkdirSync, readFileSync, watch } from "fs"
import { Flock } from "@opencode-ai/util/flock"
import { writeJsonAtomic } from "../util/persistence"
import { useTuiApp, useTuiPaths } from "./runtime"

type Options<Value extends object> = {
  readonly initial: Value
  /** Reconcile key for arrays inside the stored value, preserving item identity across updates. Defaults to "id". */
  readonly key?: string
}

type Entry<Value extends object> = readonly [Store<Value>, (mutation: (draft: Value) => void) => Promise<void>]

export interface Storage {
  store<Value extends object>(
    key: string,
    options: Options<Value>,
  ): readonly [Store<Value>, (mutation: (draft: Value) => void) => Promise<void>]
}

function clone<Value extends object>(value: Value) {
  const json = JSON.stringify(value)
  if (json === undefined) throw new TypeError("Storage values must be JSON-compatible objects")
  const result = JSON.parse(json) as Value
  if (typeof result !== "object" || result === null) throw new TypeError("Storage values must be objects")
  return result as Value
}

function segment(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value) || value === "." || value === "..")
    throw new TypeError(`Invalid storage segment: ${value}`)
  return value
}

function createStorage(root: string, channel: string) {
  const entries = new Map<string, { readonly value: Entry<object>; readonly reload: () => void }>()
  const directory = path.join(root, segment(channel), "tui")
  const locks = path.join(root, segment(channel), "locks")
  mkdirSync(directory, { recursive: true })

  const storage: Storage = {
    store<Value extends object>(key: string, options: Options<Value>) {
      const file = path.join(directory, segment(key) + ".json")
      const existing = entries.get(file)
      if (existing) return existing.value as Entry<Value>

      const load = () => {
        try {
          return clone(JSON.parse(readFileSync(file, "utf8")) as Value)
        } catch {
          return clone(options.initial)
        }
      }
      const [store, setStore] = createStore(load())
      const merge = (next: Value) => reconcile(next, { key: options.key })
      const reload = () => batch(() => setStore(merge(load())))
      const update = (mutation: (draft: Value) => void) =>
        Flock.withLock(
          file,
          async () => {
            const draft = load()
            mutation(draft)
            const next = clone(draft)
            await writeJsonAtomic(file, next)
            batch(() => setStore(merge(next)))
          },
          { dir: locks },
        )
      const entry = [store, update] as const
      entries.set(file, { value: entry as Entry<object>, reload })
      return entry
    },
  }

  const watcher = watch(directory, () => entries.forEach((entry) => entry.reload()))
  return {
    storage,
    close: () => watcher.close(),
  }
}

const Context = createContext<Storage>()

export function StorageProvider(props: ParentProps) {
  const result = createStorage(useTuiPaths().state, useTuiApp().channel)
  onCleanup(result.close)
  return <Context.Provider value={result.storage}>{props.children}</Context.Provider>
}

export function useStorage() {
  const storage = useContext(Context)
  if (!storage) throw new Error("StorageProvider is missing")
  return storage
}
