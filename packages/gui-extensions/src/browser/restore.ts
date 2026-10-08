import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema, type Types } from "effect"
import type { MainStoreFrom, Storage } from "../sdk/main"

const Stored = Schema.Struct({
  tabs: Schema.Array(
    Schema.Struct({
      id: Browser.TabID,
      url: Browser.Tab.fields.url,
      // Added later: rows saved before keep the user's kind of tab.
      owner: Schema.optionalKey(Browser.Tab.fields.owner),
      key: Schema.optionalKey(Schema.String),
      viewport: Schema.optionalKey(Schema.Struct({ width: Schema.Int, height: Schema.Int })),
    }),
  ),
  focusedTabID: Schema.NullOr(Browser.TabID),
})

type Stored = typeof Stored.Type

const empty: Stored = { tabs: [], focusedTabID: null }

/** Tab URLs and focus per `${server}\n${session}`, imported once from the desktop's own `opencode.browser.dat` rows. */
export function createBrowserRestoreStore(storage: Storage) {
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
    save(key: string, state: Stored) {
      const target = store(key)

      const value = {
        tabs: state.tabs.map((tab) => {
          // Fields keep the schema's order: the comparison below is on the JSON text.
          const row: Types.Mutable<Stored["tabs"][number]> = { id: tab.id, url: tab.url }

          if (tab.owner) row.owner = tab.owner

          if (tab.key) row.key = tab.key

          if (tab.viewport) row.viewport = tab.viewport

          return row
        }),
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
