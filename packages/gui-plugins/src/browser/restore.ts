import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import type { BuiltinMainStorage, MainStoreFrom } from "@opencode/plugin/gui/builtin"

const Stored = Schema.Struct({
  // `agent`: the agent drove the tab, which keeps every agent-driven limit when it comes back.
  tabs: Schema.Array(Schema.Struct({ id: Browser.TabID, url: Browser.Tab.fields.url, agent: Schema.optional(Schema.Literal(true)) })),
  focusedTabID: Schema.NullOr(Browser.TabID),
})

type Stored = typeof Stored.Type

const empty: Stored = { tabs: [], focusedTabID: null }

/** Tab URLs and focus per `${server}\n${session}`, imported once from the desktop's own `opencode.browser.dat` rows. */
export function createBrowserRestoreStore(storage: BuiltinMainStorage) {
  const from = (key: string): MainStoreFrom => ({ state: ["opencode.browser.dat", key] })
  const open = (key: string) => storage.store(`restore:${key}`, { schema: Stored, initial: empty, from: from(key) })

  const stores = new Map<string, ReturnType<typeof open>>()

  const store = (key: string) => {
    const existing = stores.get(key)

    if (existing) return existing
    const created = open(key)
    stores.set(key, created)

    return created
  }

  return {
    load: (key: string) => store(key).value,
    save(key: string, state: Stored, agent: (tabID: Browser.TabID) => boolean) {
      const target = store(key)

      const value = {
        tabs: state.tabs.map((tab) => (agent(tab.id) ? { id: tab.id, url: tab.url, agent: true as const } : { id: tab.id, url: tab.url })),
        focusedTabID: state.focusedTabID,
      }

      if (JSON.stringify(target.value) !== JSON.stringify(value)) target.set(value)
    },
    // Also drops the unimported desktop row, as the pane's own close always did.
    remove(key: string) {
      storage.remove(`restore:${key}`, { from: from(key) })
      stores.delete(key)
    },
  }
}
