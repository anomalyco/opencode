import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import path from "node:path"
import { runElectronFixture } from "./electron-run"
import { madeUpFirefox } from "./profile/made-up-firefox.fixture"

// The import dialog's two boxes, "Sign-ins" and "Browsing history", are two real paths in main. This runs the plugin's
// main entry in the pinned Electron and imports through its Ipc, as the dialog does, from a made-up Firefox profile in
// a temporary home: five cookies of three sites, and three pages of two.
test(
  "an import brings what was ticked: sign-ins without opening the history, history without reading a cookie, or both",
  async () => {
    const made = await madeUpFirefox()

    try {
      const env = { ...made.env, BROWSER_FIXTURE_COOKIES: path.join(made.profile, "cookies.sqlite") }
      const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-import-choice.fixture.ts"), env }))
      const none = { type: "imported", imported: 0, skipped: 0, protected: 0, failed: 0 }
      const github = ["https://github.com/", "https://github.com/anomalyco/rune-desktop"]
      const bank = "https://www.bank.test/accounts"

      // Sign-ins only: every cookie, no count of pages, and the history store was never opened, so it has no file.
      expect(result.signins).toEqual({ result: { value: { ...none, imported: 5 } }, cookies: 5, store: false })
      // Both: every cookie and every page.
      expect(result.both).toEqual({ result: { value: { ...none, imported: 5, pages: 3 } }, cookies: 5, pages: [...github, bank] })
      // Chosen sites limit both kinds: the one site's cookie and its one page.
      expect(result.site).toEqual({ result: { value: { ...none, imported: 1, pages: 1 } }, cookies: 1, pages: [bank] })
      // History only: the pages come and no cookie does. The cookie database cannot be read by then, so an import that
      // read it would have failed, as the last one, which asks for the cookies, does.
      expect(result.historyOnly).toEqual({ result: { value: { ...none, pages: 3 } }, cookies: 0, pages: [...github, bank] })
      expect(result.historySite).toEqual({ result: { value: { ...none, pages: 1 } }, pages: [bank] })
      expect(result.read).toEqual({ value: { type: "failed", reason: "read" } })
    } finally {
      await rm(made.home, { recursive: true, force: true }).catch(() => undefined)
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
