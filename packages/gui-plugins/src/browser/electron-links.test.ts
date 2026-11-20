import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

type Outcome = {
  /** The tabs the page asked the pane for: behind the current tab or in front, whose, where, and with what opener. */
  readonly tabs: readonly { readonly background: boolean; readonly owner: string; readonly url: string; readonly opener: string }[]
  readonly notices: readonly object[]
  /** Whose the pressed tab is afterwards. */
  readonly owner: string
}

const behind = (url: string): Outcome => ({ tabs: [{ background: true, owner: "user", url, opener: "none" }], notices: [], owner: "user" })

const front = (url: string): Outcome => ({ tabs: [{ background: false, owner: "user", url, opener: "none" }], notices: [], owner: "user" })

const blocked = (url: string, owner: string): Outcome => ({ tabs: [], notices: [{ reason: "popup", target: url, action: "tab" }], owner })

// Where a clicked link opens rests on Chromium: it decides the disposition from the click's button and modifiers,
// reports a user gesture only for `window.open` and `target="_blank"`, and routes a middle-click or a modified click to
// a new tab with no such report (`setWindowOpenHandler` in chromium.ts, window-open.ts). This presses links in the
// pinned Electron with Chromium's input events, so an upgrade that changes any of that fails here.
test(
  "the person's middle-click and modified clicks on a link open tabs as in Chrome, and the agent's and a page's own stay blocked pop-ups",
  async () => {
    const result: Record<string, Outcome> & { agent: Outcome & { refusal?: string }; platform: string } = JSON.parse(
      await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-links.fixture.ts") }),
    )

    // A middle-click, and a Ctrl+click (Cmd+click on macOS): a new tab behind the current one, with no opener and no
    // notice. Enter on the focused link with the same modifier is the same.
    expect(result.middle).toEqual(behind("/target?plain"))
    expect(result.modified).toEqual(behind("/target?plain"))
    expect(result.key).toEqual(behind("/target?plain"))
    // With Shift as well, the new tab opens in front.
    expect(result.modifiedShift).toEqual(front("/target?plain"))
    expect(result.middleShift).toEqual(front("/target?plain"))
    // Shift+click asks for a new window. The pane has none, so it is a tab in front.
    expect(result.shift).toEqual(front("/target?plain"))
    // A `target="_blank"` link opens in front on a click, and behind on a middle-click.
    expect(result.blank).toEqual(front("/target?blank"))
    expect(result.blankMiddle).toEqual(behind("/target?blank"))
    // No tab shows a mail link: a middle-click gets the offer a click gets, never "Pop-up blocked".
    expect(result.mail.notices).toEqual([{ reason: "external", target: "mailto:someone@example.test", source: "page", action: "open" }])
    expect(result.mailMiddle).toEqual(result.mail)
    // A middle-click on no link asks for nothing.
    expect(result.nothing).toEqual({ tabs: [], notices: [], owner: "user" })
    // A link that asks for an opener gets one on a click, as before. Chromium gives a middle-clicked link none.
    expect(result.opener).toEqual({ tabs: [{ background: false, owner: "user", url: "/target?opener", opener: "opener" }], notices: [], owner: "user" })
    expect(result.openerMiddle).toEqual(behind("/target?opener"))

    // The agent's middle-click is not the person's: it stays a blocked pop-up, or on Linux is refused before it is
    // sent, as it can paste the system selection.
    if (result.platform === "linux") expect(result.agent).toEqual({ tabs: [], notices: [], owner: "agent", refusal: expect.stringContaining("Middle-click") })
    else expect(result.agent).toEqual(blocked("/target?plain", "agent"))
    // The person's next middle-click takes the tab back and opens the link.
    expect(result.reclaimed).toEqual(behind("/target?plain"))

    // A Shift+click the page makes up, and a `window.open` on a timer, have nobody's press behind them.
    expect(result.synthetic).toEqual(blocked("/target?synthetic", "user"))
    expect(result.timer).toEqual(blocked("/target?timer", "user"))
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
