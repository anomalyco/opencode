import type { Browser } from "@opencode/plugin-browser/rpc"

/** Main keeps this authority beside the binding, not in the public inventory or in a plugin-supplied tab handle. */
export function pluginTabs() {
  const grants = new Map<Browser.TabID, { owner: string; id: string }>()

  return {
    grant(owner: string, tab: Browser.TabID) {
      const id = crypto.randomUUID()
      grants.set(tab, { owner, id })

      return id
    },
    resolve(owner: string, id: string) {
      for (const [tab, grant] of grants) {
        if (grant.owner === owner && grant.id === id) return tab
      }
    },
    forget: (tab: Browser.TabID) => grants.delete(tab),
  }
}
