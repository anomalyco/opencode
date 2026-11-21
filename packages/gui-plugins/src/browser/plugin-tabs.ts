import type { Browser } from "@opencode/plugin-browser/rpc"
import { PluginTabHandle } from "./ipc"

/** Main keeps this authority beside the binding, not in the public inventory or in a plugin-supplied tab handle. */
export function pluginTabs() {
  const grants = new Map<Browser.TabID, { owner: string; id: string; ready: boolean }>()

  return {
    reserve(owner: string) {
      const id = PluginTabHandle.make(crypto.randomUUID())

      const grant = { owner, id, ready: false }

      return {
        id,
        created: (tab: Browser.TabID) => { grants.set(tab, grant) },
        // An input during load already removed the grant. Settling cannot give it back.
        settled: () => { grant.ready = true },
      }
    },
    resolve(owner: string, id: string) {
      return Array.from(grants).find(([, grant]) => grant.ready && grant.owner === owner && grant.id === id)?.[0]
    },
    forget: (tab: Browser.TabID) => grants.delete(tab),
  }
}
