import { createStore } from "solid-js/store"
import { ServerConnection } from "./server"

export type SessionTab = {
  type: "session"
  server: ServerConnection.Key
  sessionId: string
}

export type DraftTab = {
  type: "draft"
  draftID: string
  server: ServerConnection.Key
  directory: string
}

export type Tab = SessionTab | DraftTab
export type TabInfo = { title?: string }

export function tabHref(tab: Tab) {
  return tab.type === "draft"
    ? `/new-session?draftId=${tab.draftID}`
    : `/session/${encodeURIComponent(tab.sessionId)}`
}

export function tabKey(tab: Tab) {
  return tab.type === "draft" ? `draft:${tab.draftID}` : `${tab.server}\n${tabHref(tab)}`
}

const serverKey = ServerConnection.Key.make("http://localhost:3000")

const initialTabs: Tab[] = [
  { type: "session", server: serverKey, sessionId: "sess-1" },
  { type: "session", server: serverKey, sessionId: "sess-2" },
  { type: "session", server: serverKey, sessionId: "sess-3" },
  { type: "session", server: serverKey, sessionId: "sess-4" },
  { type: "session", server: serverKey, sessionId: "sess-5" },
  { type: "session", server: serverKey, sessionId: "sess-6" },
  { type: "session", server: serverKey, sessionId: "sess-7" },
  { type: "session", server: serverKey, sessionId: "sess-8" },
]

const tabInfo: Record<string, TabInfo> = {
  [`sess-1`]: { title: "Fix login bug" },
  [`sess-2`]: { title: "Refactor auth module" },
  [`sess-3`]: { title: "Add dark mode support" },
  [`sess-4`]: { title: "Write API docs" },
  [`sess-5`]: { title: "Optimize database queries" },
  [`sess-6`]: { title: "Setup CI/CD pipeline" },
  [`sess-7`]: { title: "Migrate to TypeScript" },
  [`sess-8`]: { title: "Design system components" },
}

const [store] = createStore<Tab[]>(initialTabs)

export function useTabs() {
  return {
    store,
    info: tabInfo,
    ready: Object.assign(() => true, { promise: Promise.resolve(true) }),
    recentReady: Object.assign(() => true, { promise: Promise.resolve(true) }),
    select: () => {},
    remember: () => {},
    toggleHome: () => {},
    addSessionTab: (tab: Omit<SessionTab, "type">) => ({ type: "session" as const, ...tab }),
    reorder: () => {},
    closeTab: () => {},
    removeTab: () => {},
    reopenClosedTab: () => {},
    removeSessions: () => {},
    removeSessionTab: () => {},
    removeServer: () => {},
    draft: (draftID: string) => ({
      type: "draft" as const,
      draftID,
      server: serverKey,
      directory: "/home/user/project",
    }),
    newDraft: async () => ({
      type: "draft" as const,
      draftID: "d1",
      server: serverKey,
      directory: "/home/user/project",
    }),
    updateDraft: () => {},
    promoteDraft: () => {},
    rememberSessionInfo: () => {},
    state: () => undefined,
    stateValue: () => undefined,
  }
}
