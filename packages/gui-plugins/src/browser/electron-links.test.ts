import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

type Outcome = {
  /**
   * The tabs the page asked the pane for: behind the current tab or in front, and whose. One that stayed says where it
   * is, with what opener once it has a document, and its own notices; one that closed itself says only that.
   */
  readonly tabs: readonly {
    readonly background: boolean
    readonly owner: string
    readonly url?: string
    readonly opener?: string
    readonly notices?: readonly object[]
    readonly closed?: boolean
  }[]
  /** The notices of the pressed tab. */
  readonly notices: readonly object[]
  /** Whose the pressed tab is afterwards. */
  readonly owner: string
  /** Each download that started, how it ended, and whether its tab had closed before its last bytes came. */
  readonly downloads?: readonly { readonly url: string; readonly state: string; readonly tab: string }[]
}

const behind = (url: string): Outcome => ({ tabs: [{ background: true, owner: "user", url, opener: "none" }], notices: [], owner: "user" })

const front = (url: string): Outcome => ({ tabs: [{ background: false, owner: "user", url, opener: "none" }], notices: [], owner: "user" })

const blocked = (url: string, owner: string): Outcome => ({ tabs: [], notices: [{ reason: "popup", target: url, action: "tab" }], owner })

// Where a clicked link opens rests on Chromium: it decides the disposition from the click's button and modifiers,
// reports a user gesture only for `window.open` and `target="_blank"`, and routes a middle-click or a modified click to
// a new tab with no such report (`setWindowOpenHandler` in chromium.ts, window-open.ts). This presses links in the
// pinned Electron with Chromium's input events, so an upgrade that changes any of that fails here.
test(
  "the person's middle-click and modified clicks on a link open tabs as in Chrome, a tab left with nothing to show closes, and the agent's and a page's own stay blocked pop-ups, right after a press too",
  async () => {
    const result: Record<string, Outcome> & { agent: Outcome & { refusal?: string }; platform: string; afterPress: object[]; reports: string[] } = JSON.parse(
      await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-links.fixture.ts") }),
    )

    // A middle-click, and a Ctrl+click (Cmd+click on macOS): a new tab behind the current one, with no opener and no
    // notice. Enter on the focused link with the same modifier is the same.
    expect(result.middle).toEqual(behind("/target?plain"))
    // A slow page's tab, as the pane's machine reports it to the window from what the page publishes: listed at the
    // click, right after the pressed tab, with its new-tab label. It keeps that label while its load starts and its
    // document commits under Chromium's name for it (its address), and takes the page's title once, when the document
    // names itself. Nothing but `loading` changes after that.
    expect(result.slow).toEqual(behind("/slow"))
    expect(result.reports).toEqual([
      "new-tab label, untitled loaded about:blank after the pressed tab",
      "new-tab label, untitled loading about:blank",
      "new-tab label, /slow loading /slow",
      "page's title, Slow loading /slow",
      "page's title, Slow loaded /slow",
    ])
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

    // A new tab whose first navigation became a download has nothing to show: it closes itself, behind or in front,
    // and the download ends as it would have, after its tab has gone.
    const downloaded = [{ url: "/download", state: "completed", tab: "closed" }]
    expect(result.download).toEqual({ tabs: [{ background: true, owner: "user", closed: true }], notices: [], owner: "user", downloads: downloaded })
    expect(result.blankDownload).toEqual({ tabs: [{ background: false, owner: "user", closed: true }], notices: [], owner: "user", downloads: downloaded })
    // One that had shown a page stays when a download starts in it.
    expect(result.thenDownload).toEqual({
      tabs: [{ background: true, owner: "user", url: "/then-download", opener: "none" }],
      notices: [],
      owner: "user",
      downloads: [{ url: "/download", state: "completed", tab: "open" }],
    })
    // A link that redirects to a mail link leaves no empty tab: the pressed tab gets the offer a click on a mail link gets.
    expect(result.mailRedirect).toEqual({ tabs: [{ background: true, owner: "user", closed: true }], notices: result.mail.notices, owner: "user" })
    // One that redirects to an address the pane refuses keeps its tab, which says why in its own notice.
    expect(result.refusedRedirect).toEqual({
      tabs: [{ background: true, owner: "user", url: "about:blank", notices: [{ reason: "browser.address.credentials" }] }],
      notices: [],
      owner: "user",
    })

    // The agent's middle-click is not the person's: it stays a blocked pop-up, or on Linux is refused before it is
    // sent, as it can paste the system selection.
    if (result.platform === "linux") expect(result.agent).toEqual({ tabs: [], notices: [], owner: "agent", refusal: expect.stringContaining("Middle-click") })
    else expect(result.agent).toEqual(blocked("/target?plain", "agent"))
    // The agent's tab keeps its download, so it stays, as before.
    expect(result.agentDownload).toEqual({
      tabs: [{ background: false, owner: "agent", url: "about:blank" }],
      notices: [],
      owner: "agent",
      downloads: [{ url: "/download", state: "completed", tab: "open" }],
    })
    // The person's next middle-click takes the tab back and opens the link.
    expect(result.reclaimed).toEqual(behind("/target?plain"))

    // A Shift+click the page makes up, and a `window.open` on a timer, have nobody's press behind them.
    expect(result.synthetic).toEqual(blocked("/target?synthetic", "user"))
    expect(result.timer).toEqual(blocked("/target?timer", "user"))

    // A person's press stands only for the link it pressed. 50 ms, 500 ms and 2 s after a plain press elsewhere on the
    // page, a `window.open` from a frame the press gave no activation, and a Shift+click the page makes up on another
    // link, are each still a blocked pop-up. The same after a press on a link whose own navigation the page prevents.
    expect(result.afterPress).toEqual(
      ["elsewhere", "link"].flatMap((on) =>
        ["frame", "made-up"].flatMap((kind) =>
          [50, 500, 2000].map((delay) => ({ on, kind, delay, ...blocked(`/target?${kind}-${delay}`, "user") })),
        ),
      ),
    )
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
