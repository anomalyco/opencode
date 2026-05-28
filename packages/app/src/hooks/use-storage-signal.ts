import { createEffect, createSignal, untrack, type Setter, type Signal } from "solid-js"

type Store = "local" | "session"

type Opts<T> = {
  storage?: Store
  parse?: (value: string) => T
  stringify?: (value: T) => string | undefined
}

function area(storage: Store) {
  if (typeof window === "undefined") return
  try {
    if (storage === "local") return window.localStorage
    return window.sessionStorage
  } catch {
    return
  }
}

function parse<T>(raw: string, init: T, opts?: Opts<T>) {
  if (opts?.parse) return opts.parse(raw)
  if (typeof init === "string") return raw as T
  try {
    return JSON.parse(raw) as T
  } catch {
    return init
  }
}

function stringify<T>(value: T, opts?: Opts<T>) {
  if (opts?.stringify) return opts.stringify(value)
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

function read<T>(storage: Store, key: string, init: T, opts?: Opts<T>) {
  const store = area(storage)
  if (!store) return init
  try {
    const raw = store.getItem(key)
    if (raw === null) return init
    return parse(raw, init, opts)
  } catch {
    return init
  }
}

function write<T>(storage: Store, key: string, value: T, opts?: Opts<T>) {
  const store = area(storage)
  if (!store) return
  try {
    const raw = stringify(value, opts)
    if (raw === undefined) {
      store.removeItem(key)
      return
    }
    store.setItem(key, raw)
  } catch {
    return
  }
}

/**
 * Create a Solid signal initialized from Web Storage and persisted back through its setter.
 * Defaults to sessionStorage; pass { storage: "local" } for localStorage.
 * Strings are stored directly; other values use JSON unless parse/stringify are provided.
 */
export function useStorageSignal<T>(key: string, init: T, opts?: Opts<T>): Signal<T> {
  const storage = opts?.storage ?? "session"
  const [value, put] = createSignal(read(storage, key, init, opts))

  // Persist the initial signal value after creation; untrack keeps later updates on the setter path.
  createEffect(() => write(storage, key, untrack(value), opts))

  const set = ((update: T | ((value: T) => T)) => {
    const next = typeof update === "function" ? (update as (value: T) => T)(untrack(value)) : update
    // Wrap the value so Solid never treats a stored function as a setter callback.
    put(() => next)
    write(storage, key, next, opts)
    return next
  }) as Setter<T>

  return [value, set] as const
}
