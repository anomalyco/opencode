import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// Who a page's activity belongs to rests on Chromium's own input events (`createBrowserPage` in chromium.ts). This runs
// one pane page in the pinned Electron, so an upgrade that changes which events a page or the agent raises fails here.
test(
  "page navigations are not the person's input, an agent's right-click opens no native menu, the person's click during an agent wait is theirs, and another window's calls are refused",
  async () => {
    const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-page.fixture.ts") }))

    // History API writes, a client redirect and a frame load while the page boots are nobody's input, so a plugin's
    // right to close the tab it opened survives them.
    expect(result.booted).toEqual({ popups: 0, menus: 0, inputs: 0, owner: "user" })
    // The page saw the agent's right-click, the tab became the agent's, and no native menu opened.
    expect(result.agent).toEqual({ popups: 0, menus: 1, inputs: 0, owner: "agent" })
    // The person's own right-click opens the menu and takes the tab back.
    expect(result.person).toEqual({ popups: 1, menus: 2, inputs: 1, owner: "user" })
    // With the menu armed by the person, the agent's next right-click still opens none.
    expect(result.after).toEqual({ popups: 1, menus: 3, inputs: 1, owner: "agent" })
    // The agent's `wait` holds a command on the tab but sends the page nothing: the person's right-click during it
    // is their input, opens their menu and takes the tab back. Two of the person's clicks came since `after`.
    expect(result.waiting).toEqual({ popups: 3, menus: 5, inputs: 3, owner: "user", during: true })
    // createTab, closeTab, command, openPage and load: the window that registered the binding gets each call's own
    // answer, and any other window is refused before the call does anything.
    const unready = "Browser network is not ready; no tab was opened."
    expect(result.windows.owner).toEqual([unready, "returned false", unready, "browser.pane.unavailable", "returned undefined"])
    expect(result.windows.other).toEqual(Array(5).fill("browser.pane.unavailable"))
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
