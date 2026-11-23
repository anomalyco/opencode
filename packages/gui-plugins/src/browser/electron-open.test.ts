import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { schemes } from "../schemes"
import { runElectronFixture } from "./electron-run"

type View = { readonly url: string; readonly loading: boolean; readonly failed: boolean }

type Handed = { readonly opened: string; readonly listed?: View; readonly closed?: boolean; readonly left: boolean }

type Asked = { readonly answer: string; readonly tabID?: string; readonly listed?: View; readonly shown: string[] }

// A tab closes only for the person, the agent's close tool or the page itself, and a tab that stays is an ordinary
// tab: its opener holds it, and it was shown as one that loaded would be. This runs the real pane in the pinned
// Electron, attached to a stand-in for the session's server. A tab used to close by itself when its first load
// rejected: 15 seconds after it opened while its page, shown already, was still loading, or at once when the load
// failed, and the window was told nothing. The fixture gives the pane a 300 ms deadline, so no run waits out the real
// one.
test(
  "a tab whose first load is still under way or failed stays, with its opener holding it and the pane showing it",
  async () => {
    // The canonical name: the preview's file checks compare physical paths, and Windows temp paths can be 8.3 names.
    const base = realpathSync.native(await mkdtemp(path.join(tmpdir(), "electron-open-")))

    try {
      const root = path.join(base, "workspace")
      await mkdir(root)
      // Shows, then keeps the page busy past the deadline before its load ends.
      await writeFile(path.join(root, "report.html"), "<!doctype html><title>Report</title><p>report</p><script>const end = Date.now() + 800; while (Date.now() < end) {}</script>")

      const result: {
        origin: string
        startup: { refused: number; listed: number }
        person: { commands: Record<string, string>; before: string[]; after: View[] }
        committed: boolean
        plugin: { loading: Handed; dropped: Handed; nothing: Handed }
        agent: { front: Asked; behind: Asked; preview: Asked }
        registered: { held: string[]; again: string[] }
        logged: string[]
      } = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-open.fixture.ts"), schemes, env: { ELECTRON_OPEN_ROOT: root } }))

      const origin = result.origin

      // The server had only just started the session's project, so its first answer was that it has no browser RPC.
      // The pane asked for the project's plugins until it listed them, the third time, and attached then. It used to
      // take that first answer for a server without a browser, and the browser could not open.
      expect(result.startup).toEqual({ refused: 1, listed: 3 })

      // A link in the conversation. The person's commands did not fail: the tab itself reports a load that is under
      // way or that failed. Every tab is still there, in the order it opened.
      expect(result.person.commands).toEqual({ first: "settled", second: "settled", still: "settled", failed: "settled" })
      expect(result.person.before).toEqual([`${origin}/first`, `${origin}/second`])
      expect(result.committed).toBe(true)
      expect(result.person.after).toEqual([
        { url: `${origin}/first`, loading: false, failed: false },
        { url: `${origin}/second`, loading: false, failed: false },
        { url: `${origin}/loading`, loading: true, failed: false },
        { url: `${origin}/dropped`, loading: false, failed: true },
      ])

      // A plugin's tab that stays is the plugin's: its call answers with the handle, which closes the tab. An address
      // that opened no page rejects, and leaves no tab.
      expect(result.plugin.loading).toEqual({ opened: "handle", listed: { url: `${origin}/loading?plugin`, loading: true, failed: false }, closed: true, left: false })
      expect(result.plugin.dropped).toEqual({ opened: "handle", listed: { url: `${origin}/dropped?plugin`, loading: false, failed: true }, closed: true, left: false })
      expect(result.plugin.nothing).toEqual({ opened: expect.stringContaining("No page committed"), left: false })

      // The agent's tab that stays was shown as one that loaded: in front, behind with `focus: false`, and a workspace
      // file takes the pane. The agent hears that the page did not finish, with the tab to go on with.
      const told = (asked: Asked, operation: string) =>
        `browser.${operation} failed. The browser page did not finish starting or navigating. Reload the tab and inspect it before retrying. The tab stays open as ${asked.tabID}: use that tabID with browser.wait, browser.reload or browser.tabs.close, and do not open the address again.`

      expect(result.agent.front).toEqual({ answer: told(result.agent.front, "tabs.open"), tabID: expect.stringMatching(/^tab_/), listed: { url: `${origin}/loading?agent`, loading: true, failed: false }, shown: ["tab"] })
      expect(result.agent.behind).toEqual({ answer: told(result.agent.behind, "tabs.open"), tabID: expect.stringMatching(/^tab_/), listed: { url: `${origin}/loading?behind`, loading: true, failed: false }, shown: ["none"] })
      expect(result.agent.preview.answer).toBe(told(result.agent.preview, "preview"))
      expect(result.agent.preview.tabID).toMatch(/^tab_/)
      expect(result.agent.preview.shown).toEqual(["tab"])
      // A registration is no close either. The window registers again with an inventory that has only its first two
      // tabs; the new binding lists every tab the pane held, in its order. It used to start from that inventory alone.
      expect(result.registered.held.slice(0, 2)).toEqual(result.person.before)
      expect(result.registered.held.length).toBeGreaterThan(2)
      expect(result.registered.again).toEqual(result.registered.held)
      // Only the address that opened no page was undone.
      expect(result.logged.filter((line) => line === "browser tab closed: its open failed")).toHaveLength(1)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
