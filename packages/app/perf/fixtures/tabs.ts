import { base64Encode } from "@opencode/util/encode"
import type { Page } from "@playwright/test"

/**
 * The window's open tabs, written on every page load so a reload restores them: `sessions` in order, then a new
 * session draft when given, all on `server`.
 */
export function installTabs(
  page: Page,
  input: { server: string; directory: string; sessions: string[]; draft?: string },
) {
  return page.addInitScript(
    ({ server, directory, dirBase64, sessions, draft }) => {
      const tabs: object[] = sessions.map((sessionId) => ({ type: "session", server, dirBase64, sessionId }))

      if (draft) tabs.push({ type: "draft", draftID: draft, server, directory })
      localStorage.setItem("opencode.window.browser.dat:tabs", JSON.stringify(tabs))
    },
    { ...input, dirBase64: base64Encode(input.directory) },
  )
}
