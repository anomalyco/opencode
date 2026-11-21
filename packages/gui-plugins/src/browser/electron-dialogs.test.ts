import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// The pane takes a page's dialogs through Electron internals (`takeDialogs` in page-prompts.ts). This runs it in the
// pinned Electron, so an upgrade that changes them fails here rather than in a user's page.
test(
  "the pinned Electron hands the pane every dialog of a sandboxed page, which never hangs or shows a native box",
  async () => {
    const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-dialogs.fixture.ts") }))

    // Electron's own listener draws the native box; the pane's replaces it, and Electron's contract matched.
    expect(result.before).toBe(1)
    expect(result.after).toBe(1)
    expect(result.warnings).toEqual([])
    expect(result.opened).toEqual([
      { type: "alert", message: "a", origin: result.origin },
      { type: "confirm", message: "c", origin: result.origin },
      { type: "prompt", message: "p", origin: result.origin },
    ])
    // prompt() answers as Chromium's own does, under a CSP that allows no frame.
    expect(result.answers).toEqual([null, true, "typed"])
    expect(result.unanswered).toBe(false)
    expect(result.choosers).toEqual({ user: 0, picks: [1, 1, 1, 1], delayed: 1, returned: 0, intercepts: { backup: 7, product: 5 } })
  },
  // Starting Electron takes seconds on a loaded runner; the takeover's own fallback waits 2 seconds.
  60_000,
)
