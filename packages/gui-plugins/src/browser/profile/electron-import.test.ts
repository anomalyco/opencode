import { expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import path from "node:path"
import { runElectronFixture } from "../electron-run"
import { madeUpFirefox } from "./made-up-firefox.fixture"

// An import of chosen sites writes only those sites' cookies into Electron's cookie store, keeps domain and host-only
// cookies as they were, and a later import adds a site without removing the first. This runs the real read and the
// profile's writer in the pinned Electron, against a made-up Firefox profile in a temporary home.
test(
  "the pinned Electron receives only the chosen sites' cookies, and a second import adds to them",
  async () => {
    const made = await madeUpFirefox()

    try {
      const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-import.fixture.ts"), env: made.env }))

      // Partitioned and container cookies were never offered, so nothing is reported as left behind.
      expect(result.first).toEqual({ type: "imported", imported: 3, skipped: 0, protected: 0, failed: 0 })
      expect(result.afterFirst).toEqual([
        [".github.com", "user_session", "domain-secret", false],
        ["api.github.com", "token", "api-secret", true],
        ["github.com", "_gh_sess", "host-secret", true],
      ])
      expect(result.second).toMatchObject({ type: "imported", imported: 1 })
      expect(result.afterSecond).toEqual([...result.afterFirst, [".bank.test", "session", "bank-secret", false]].toSorted())
    } finally {
      await rm(made.home, { recursive: true, force: true }).catch(() => undefined)
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
