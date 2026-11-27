import type { Browser } from "@opencode/plugin-browser/rpc"

/**
 * Which tabs of a binding refuse passkeys together. A tab and the pop-ups it opened, and theirs, can script each other
 * through `window.opener` and the windows they opened, so once the agent drives one of them every one refuses, in the
 * browser process, and so does a pop-up any of them opens later. Tabs a person opens on their own form their own group.
 */
export function createPasskeyGroups() {
  const groups = new Map<Browser.TabID, Browser.TabID>()
  const restricted = new Set<Browser.TabID>()

  return {
    /** Puts a tab in its opener's group, or in one of its own; a tab that is already in one keeps it. */
    join(tab: Browser.TabID, opener?: Browser.TabID) {
      const group = groups.get(tab) ?? (opener && groups.get(opener)) ?? opener ?? tab
      groups.set(tab, group)
    },
    /** Whether the tab's group refuses passkeys already, so a new page of it refuses from its first document. */
    restricted: (tab: Browser.TabID) => restricted.has(groups.get(tab) ?? tab),
    /** Makes the tab's group refuse; returns the other tabs of the group that start refusing now. */
    restrict(tab: Browser.TabID) {
      const group = groups.get(tab) ?? tab

      if (restricted.has(group)) return []
      restricted.add(group)

      return [...groups].flatMap(([other, of]) => (of === group && other !== tab ? [other] : []))
    },
    /** A closed tab leaves its group, which stays restricted for the tabs that remain. */
    remove(tab: Browser.TabID) {
      groups.delete(tab)
    },
  }
}
