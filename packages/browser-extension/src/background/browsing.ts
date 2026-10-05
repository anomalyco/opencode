// Browsing data for agents: history, bookmarks, top sites, and recently closed tabs. Each session needs
// the user's permission once (asked in the side panel); the grant is remembered for that session.
import type { RelayCommand } from "../shared/relay-rpc"

const GRANTS_KEY = "browsingGrants"

type BrowsingCommand = Extract<RelayCommand, { action: "history" | "bookmarks" | "top_sites" | "recently_closed" }>

export async function granted(sessionID: string) {
  const grants = ((await chrome.storage.local.get(GRANTS_KEY))[GRANTS_KEY] ?? []) as string[]
  return grants.includes(sessionID)
}

export async function grant(sessionID: string) {
  const grants = ((await chrome.storage.local.get(GRANTS_KEY))[GRANTS_KEY] ?? []) as string[]
  if (grants.includes(sessionID)) return
  // Keep the list bounded; old sessions simply ask again.
  await chrome.storage.local.set({ [GRANTS_KEY]: [...grants, sessionID].slice(-500) })
}

export async function readBrowsing(command: BrowsingCommand) {
  switch (command.action) {
    case "history": {
      const days = Math.min(Math.max(command.days ?? 30, 1), 365)
      const items = await chrome.history.search({
        text: command.query ?? "",
        startTime: Date.now() - days * 24 * 60 * 60 * 1000,
        maxResults: Math.min(Math.max(command.limit ?? 50, 1), 500),
      })
      return {
        days,
        results: items.map((item) => ({
          title: item.title || undefined,
          url: item.url,
          lastVisit: item.lastVisitTime ? new Date(item.lastVisitTime).toISOString() : undefined,
          visits: item.visitCount,
        })),
      }
    }
    case "bookmarks": {
      const limit = Math.min(Math.max(command.limit ?? 50, 1), 500)
      const nodes = command.query ? await chrome.bookmarks.search(command.query) : await chrome.bookmarks.getRecent(limit)
      const folders = new Map<string, string>()
      const folder = async (id: string | undefined): Promise<string | undefined> => {
        if (!id) return undefined
        const known = folders.get(id)
        if (known !== undefined) return known
        const [node] = await chrome.bookmarks.get(id).catch(() => [])
        const path = node ? [await folder(node.parentId), node.title].filter(Boolean).join(" / ") : ""
        folders.set(id, path)
        return path
      }
      const bookmarks = await Promise.all(
        nodes
          .filter((node) => node.url)
          .slice(0, limit)
          .map(async (node) => ({
            title: node.title,
            url: node.url,
            folder: (await folder(node.parentId)) || undefined,
            added: node.dateAdded ? new Date(node.dateAdded).toISOString() : undefined,
          })),
      )
      return { results: bookmarks }
    }
    case "top_sites":
      return { results: (await chrome.topSites.get()).map((site) => ({ title: site.title, url: site.url })) }
    case "recently_closed": {
      const sessions = await chrome.sessions.getRecentlyClosed({
        maxResults: Math.min(Math.max(command.limit ?? 10, 1), 25),
      })
      return {
        results: sessions.map((session) =>
          session.tab
            ? { type: "tab", closed: iso(session.lastModified), title: session.tab.title, url: session.tab.url }
            : {
                type: "window",
                closed: iso(session.lastModified),
                tabs: (session.window?.tabs ?? []).map((tab) => ({ title: tab.title, url: tab.url })),
              },
        ),
      }
    }
  }
}

// chrome.sessions reports seconds, unlike the other APIs.
function iso(seconds: number) {
  return new Date(seconds * 1000).toISOString()
}
