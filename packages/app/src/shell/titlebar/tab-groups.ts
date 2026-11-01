import { tabKey, type Tab } from "@/shell/tabs/tabs"

/** Sort tabs by the order their servers appear in the app, keeping each server's tabs in their existing order. */
export function orderTabsByServer(tabs: readonly Tab[], serverOrder: readonly string[]) {
  const rank = new Map(serverOrder.map((server, index) => [server, index]))

  return tabs.toSorted((a, b) => (rank.get(a.server) ?? rank.size) - (rank.get(b.server) ?? rank.size))
}

/** The first visible tab of each server carries its group header. */
export function serverGroupHeaders(
  tabs: readonly Tab[],
  isVisible: (tab: Tab) => boolean,
  labels: ReadonlyMap<string, string>,
) {
  const headers = new Map<string, string>()
  let previous: string | undefined

  for (const tab of tabs) {
    if (!isVisible(tab)) continue

    if (tab.server === previous) continue

    headers.set(tabKey(tab), labels.get(tab.server) ?? tab.server)
    previous = tab.server
  }

  return headers
}
