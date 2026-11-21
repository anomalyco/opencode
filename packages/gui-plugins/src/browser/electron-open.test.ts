import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

type Tab = { readonly url: string; readonly loading: boolean; readonly failed: boolean }

// A tab closes only for the person, the agent's close tool or the page itself. This runs the real pane in the pinned
// Electron, attached to a stand-in for the session's server, and opens tabs as a link in the conversation does. A
// link's tab used to close by itself when its first load rejected: 15 seconds after it opened while its page, shown
// already, was still loading, or at once when the address did not answer, and the window was told nothing.
test(
  "a link's tab stays while its page still loads past the command's deadline, and when its address does not answer",
  async () => {
    const result: {
      origin: string
      refused: string
      commands: Record<string, string>
      before: string[]
      shown: boolean
      after: Tab[]
      logged: string[]
    } = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-open.fixture.ts") }))

    // The person's commands did not fail: the tab itself reports a load that is under way or that failed.
    expect(result.commands).toEqual({ first: "settled", second: "settled", still: "settled", failed: "settled" })
    expect(result.before).toEqual([`${result.origin}/first`, `${result.origin}/second`])
    // The page committed and showed before its command's deadline passed.
    expect(result.shown).toBe(true)
    // Every tab is still there, in the order it opened: the one still loading, and the one whose page says why it
    // could not load.
    expect(result.after).toEqual([
      { url: `${result.origin}/first`, loading: false, failed: false },
      { url: `${result.origin}/second`, loading: false, failed: false },
      { url: `${result.origin}/loading`, loading: true, failed: false },
      { url: `${result.refused}/`, loading: false, failed: true },
    ])
    // No open was undone.
    expect(result.logged).not.toContain("browser tab closed: its open failed")
  },
  // Starting Electron takes seconds on a loaded runner, and the still-loading page's command waits out its 15 s deadline.
  60_000,
)
