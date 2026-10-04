import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import type { MainStorage } from "../sdk/main"

const Stored = Schema.Struct({
  tabs: Schema.Array(Schema.Struct({ id: Browser.TabID, url: Browser.Tab.fields.url })),
  focusedTabID: Schema.NullOr(Browser.TabID),
})
type Stored = typeof Stored.Type
const empty: Stored = { tabs: [], focusedTabID: null }

/** Tab URLs and focus per `${server}\n${session}`, imported once from the desktop's own `opencode.browser.dat` rows. */
export function createBrowserRestoreStore(storage: MainStorage) {
  const open = (key: string) =>
    storage.store(`restore:${key}`, { schema: Stored, initial: empty, from: `state:opencode.browser.dat/${key}` })
  const stores = new Map<string, ReturnType<typeof open>>()
  const store = (key: string) => {
    const existing = stores.get(key)
    if (existing) return existing
    const created = open(key)
    stores.set(key, created)
    return created
  }
  return {
    load: (key: string) => store(key).get(),
    save(key: string, state: Stored) {
      const target = store(key)
      const value = { tabs: state.tabs.map((tab) => ({ id: tab.id, url: tab.url })), focusedTabID: state.focusedTabID }
      if (JSON.stringify(target.get()) !== JSON.stringify(value)) target.set(value)
    },
    // Also drops the unimported desktop row, as the pane's own close always did.
    remove(key: string) {
      store(key).remove()
      stores.delete(key)
    },
  }
}
