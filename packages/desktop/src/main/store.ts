import Store from "electron-store"
import electron from "electron"
import { rmSync } from "node:fs"
import { join } from "node:path"

import { SETTINGS_STORE } from "./store-keys"
import { deleteStoreFileIfEmpty } from "./store-cleanup"

const DELETED = Symbol("deleted")
const WRITE_DELAY = 500

type StoreTarget = {
  get(key: string): unknown
  has(key: string): boolean
  store: Record<string, unknown>
}

export class BufferedStore {
  private pending = new Map<string, unknown>()
  private cleared = false
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private target: StoreTarget,
    private delay = WRITE_DELAY,
  ) {}

  get store() {
    const next = this.cleared ? {} : { ...this.target.store }
    for (const [key, value] of this.pending) {
      if (value === DELETED) delete next[key]
      else next[key] = value
    }
    return next
  }

  get(key: string) {
    if (this.pending.has(key)) {
      const value = this.pending.get(key)
      return value === DELETED ? undefined : value
    }
    if (this.cleared) return undefined
    return this.target.get(key)
  }

  has(key: string) {
    if (this.pending.has(key)) return this.pending.get(key) !== DELETED
    if (this.cleared) return false
    return this.target.has(key)
  }

  set(key: string, value: unknown) {
    this.pending.set(key, value)
    this.schedule()
  }

  delete(key: string) {
    this.pending.set(key, DELETED)
    this.schedule()
  }

  clear() {
    this.cleared = true
    this.pending.clear()
    this.schedule()
  }

  flush() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (!this.cleared && this.pending.size === 0) return

    this.target.store = this.store
    this.cleared = false
    this.pending.clear()
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), this.delay)
  }
}

const cache = new Map<string, BufferedStore>()

// We cannot instantiate the electron-store at module load time because
// module import hoisting causes this to run before app.setPath("userData", ...)
// in index.ts has executed, which would result in files being written to the default directory
// (e.g. bad: %APPDATA%\@opencode-ai\desktop\opencode.settings vs good: %APPDATA%\ai.opencode.desktop.dev\opencode.settings).
export function getStore(name = SETTINGS_STORE) {
  const cached = cache.get(name)
  if (cached) return cached
  const next = new BufferedStore(
    new Store({
      name,
      cwd: electron.app.getPath("userData"),
      fileExtension: "",
      accessPropertiesByDotNotation: false,
    }),
  )
  cache.set(name, next)
  return next
}

export function flushAllStores() {
  for (const store of cache.values()) store.flush()
}

export async function removeStoreFileIfEmpty(name: string) {
  const store = cache.get(name)
  store?.flush()
  if (!(await deleteStoreFileIfEmpty(electron.app.getPath("userData"), name))) return
  if (!store || Object.keys(store.store).length === 0) cache.delete(name)
}

export function removeStoreFile(name: string) {
  cache.get(name)?.flush()
  rmSync(join(electron.app.getPath("userData"), name), { force: true })
  cache.delete(name)
}
