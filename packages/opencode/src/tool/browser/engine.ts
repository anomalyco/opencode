import * as Log from "@opencode-ai/core/util/log"

const log = Log.create({ service: "browser.engine" })

// Types
type TabState = { 
  page: any
  createdAt: number
  title?: string
 }

type SessionState = {
  browser: any
  context: any
  pages: Map<string, TabState>
  activePageID: string
}

export type BrowserState = {
  sessionId: string
  pageId: string
  url: string
  title: string
  tabs: Array<{ pageId: string; url: string; title: string; active: boolean }>
}

export type BrowserResponse = {
  success: boolean
  data: any
  error: string | null
  browserState: BrowserState
}

// Helpers
function defaultPageID(): string {
  return `page-${Date.now()}`
}

// BrowserEngine
export class BrowserEngine {
  private sessions = new Map<string, SessionState>()

  // -- session lifecycle ---------------------------------------------------

  /**
   * Get an existing page or create a new one for the session.
   * If `pageID` is omitted, returns the active (or first) page.
   */
  async ensurePage(sessionID: string, pageID?: string): Promise<any> {
    const state = this.sessions.get(sessionID)

    if (state) {
      // If caller wants a specific tab, return it
      if (pageID) {
        const tab = state.pages.get(pageID)
        if (tab) return tab.page
      }
      // Otherwise return the active page
      return state.pages.get(state.activePageID)?.page
    }

    // New session — bootstrap browser + context + first page
    // @ts-ignore - playwright is an optional peer dependency
    const { chromium } = await import("playwright")
    const browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } })
    const page = await context.newPage()

    const id = pageID ?? defaultPageID()
    const pages = new Map<string, TabState>([[id, { page, createdAt: Date.now() }]])
    const session: SessionState = { browser, context, pages, activePageID: id }
    this.sessions.set(sessionID, session)

    log.info("browser session started", { sessionID, pageID: id })
    return page
  }

  async close(sessionID: string): Promise<void> {
    const state = this.sessions.get(sessionID)
    if (!state) return

    for (const [, tab] of state.pages) {
      await tab.page.close().catch(() => { })
    }
    await state.context.close().catch(() => { })
    await state.browser.close().catch(() => { })
    this.sessions.delete(sessionID)

    log.info("browser session closed", { sessionID })
  }

  // -- tab operations 

  async closeTab(sessionID: string, pageID: string): Promise<void> {
    const state = this.sessions.get(sessionID)
    if (!state) return

    const tab = state.pages.get(pageID)
    if (!tab) return

    await tab.page.close().catch(() => { })
    state.pages.delete(pageID)

    // If the closed tab was active, pick another (or delete session if empty)
    if (state.activePageID === pageID) {
      const remaining = [...state.pages.keys()]
      state.activePageID = remaining[0] ?? ""
    }

    // If no tabs left, tear down the whole session
    if (state.pages.size === 0) {
      await this.close(sessionID)
    }

    log.info("browser tab closed", { sessionID, pageID })
  }

  listTabs(sessionID: string): Array<{ pageId: string; url: string; title: string; active: boolean }> {
    const state = this.sessions.get(sessionID)
    if (!state) return []

    const result: Array<{ pageId: string; url: string; title: string; active: boolean }> = []
    for (const [id, tab] of state.pages) {
      result.push({
        pageId: id,
        url: tab.page.url(),
        title: tab.page.title?.() ?? "",
        active: id === state.activePageID,
      })
    }
    return result
  }

  async switchTab(sessionID: string, pageID: string): Promise<any> {
    const state = this.sessions.get(sessionID)
    if (!state) throw new Error(`Session ${sessionID} not found`)

    const tab = state.pages.get(pageID)
    if (!tab) throw new Error(`Tab ${pageID} not found in session ${sessionID}`)

    state.activePageID = pageID
    log.info("browser tab switched", { sessionID, pageID })
    return tab.page
  }

  async openTab(sessionID: string, pageID?: string): Promise<any> {
    const state = this.sessions.get(sessionID)
    if (!state) throw new Error(`Session ${sessionID} not found`)

    const page = await state.context.newPage()
    const id = pageID ?? defaultPageID()
    state.pages.set(id, { page, createdAt: Date.now() })
    state.activePageID = id

    log.info("browser tab opened", { sessionID, pageID: id })
    return page
  }

  async getCurrentPage(sessionID: string): Promise<any> {
    const state = this.sessions.get(sessionID)
    if (!state) return undefined

    const tab = state.pages.get(state.activePageID)
    return tab?.page
  }

  // -- structured helpers --------------------------------------------------

  async getBrowserState(sessionID: string): Promise<BrowserState | null> {
    const state = this.sessions.get(sessionID)
    if (!state) return null

    const activeTab = state.pages.get(state.activePageID)
    const activePage = activeTab?.page

    return {
      sessionId: sessionID,
      pageId: state.activePageID,
      url: activePage?.url() ?? "",
      title: activePage?.title?.() ?? "",
      tabs: this.listTabs(sessionID),
    }
  }

  // -- list & dispose (existing API surface)

  list(): Array<{ id: string; url: string }> {
    const entries: Array<{ id: string; url: string }> = []
    for (const [id, state] of this.sessions.entries()) {
      const activeTab = state.pages.get(state.activePageID)
      entries.push({ id, url: activeTab?.page.url() ?? "" })
    }
    return entries
  }

  async dispose(): Promise<void> {
    for (const sessionID of [...this.sessions.keys()]) {
      await this.close(sessionID)
    }
  }
}

export const engine = new BrowserEngine()
