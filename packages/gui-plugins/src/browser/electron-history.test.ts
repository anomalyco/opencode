import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import path from "node:path"
import { runElectronFixture } from "./electron-run"
import { madeUpFirefox } from "./profile/made-up-firefox.fixture"

// The history store is one more thing the browser keeps, and nothing the browser did before may depend on it. This
// runs the plugin's main entry in the pinned Electron and calls its Ipcs as a window does, with a real file in the
// store's place that cannot be opened, against a made-up Firefox profile in a temporary home.
test(
  "a history store that cannot open never weakens a sign-out or an import, and a damaged one is cleared by deleting it",
  async () => {
    const made = await madeUpFirefox()

    try {
      const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-history.fixture.ts"), env: made.env }))
      const cookies = { type: "imported", imported: 5, skipped: 0, protected: 0, failed: 0 }

      // The store's file is a directory. The import still brings every cookie, with no pages and no failure.
      expect(result.blocked.imported).toEqual({ value: { ...cookies, pages: 0 } })
      expect(result.blocked.cookies).toBe(5)
      // The address field's question is refused, which the window answers from its own list.
      expect(result.blocked.search).toEqual({ rejected: true })
      // The sign-out is whole: every cookie is gone. It says that the history is not, which is still on disk.
      expect(result.blocked.signOut).toEqual({ value: { history: false } })
      expect(result.blocked.cookiesAfter).toBe(0)
      // "Clear history" is refused too, so the window says so, rather than seem to have cleared it.
      expect(result.blocked.clearHistory).toEqual({ rejected: true })
      expect(result.blocked.kept).toEqual(["kept"])

      // The store's file is not a database. The import is as whole, and the sign-out clears the history by deleting
      // the file, which leaves nothing of it.
      expect(result.damaged.imported).toEqual({ value: { ...cookies, pages: 0 } })
      expect(result.damaged.cookies).toBe(5)
      expect(result.damaged.signOut).toEqual({ value: { history: true } })
      expect(result.damaged.cookiesAfter).toBe(0)
      expect(result.damaged.left).toBe(false)

      // The store that replaced it takes the profile's three pages, finds one, and a sign-out forgets them.
      expect(result.replaced.imported).toEqual({ value: { ...cookies, pages: 3 } })
      expect(result.replaced.search).toEqual({ value: ["https://github.com/anomalyco/rune-desktop"] })
      expect(result.replaced.signOut).toEqual({ value: { history: true } })
      expect(result.replaced.searchAfter).toEqual({ value: [] })
      // Each failure is in the desktop log.
      expect(result.logged).toContain("another browser's history was not imported")
      expect(result.logged).toContain("browser history could not be cleared")
    } finally {
      await rm(made.home, { recursive: true, force: true }).catch(() => undefined)
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
