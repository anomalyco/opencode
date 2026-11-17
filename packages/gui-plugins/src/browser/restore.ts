import { Browser } from "@opencode/plugin-browser/rpc"
import { Schema } from "effect"
import type { BuiltinMainStorage, MainStoreFrom } from "@opencode/plugin/gui/builtin"
import type { TabActivity } from "./policy"

const Stored = Schema.Struct({
  tabs: Schema.Array(Schema.Struct({ id: Browser.TabID, url: Browser.Tab.fields.url, control: Schema.optionalKey(Schema.Literals(["agent", "reclaimed"])), agent: Schema.optionalKey(Schema.String) })),
  focusedTabID: Schema.NullOr(Browser.TabID),
})

type Stored = typeof Stored.Type

/** One saved tab while it is built; who drives it is written only when known. */
type SavedTab = { -readonly [Key in keyof Stored["tabs"][number]]: Stored["tabs"][number][Key] }

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
    save(key: string, state: Stored, activity: ReadonlyMap<Browser.TabID, TabActivity>) {
      const target = store(key)

      const tabs = state.tabs.map((tab) => {
        const provenance = activity.get(tab.id)
        const saved: SavedTab = { id: tab.id, url: tab.url }

        if (provenance?.control) saved.control = provenance.control

        if (provenance?.agent) saved.agent = provenance.agent

        return saved
      })

      const value = { tabs, focusedTabID: state.focusedTabID }

      if (JSON.stringify(target.value) !== JSON.stringify(value)) target.set(value)
    },
    // Also drops the unimported desktop row, as the pane's own close always did.
    remove(key: string) {
      storage.remove(`restore:${key}`, { from: from(key) })
      stores.delete(key)
    },
  }
}
