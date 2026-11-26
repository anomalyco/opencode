import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// Electron draws what a page asks of `navigator.setAppBadge` on the app's taskbar button, Dock icon or launcher entry,
// where the app shows its own count, and Chromium has no switch for it. The profile's preload keeps a site off it
// (`profile/extension-api/app-badge.js`). This runs that preload in the pinned Electron: a page without it sets the
// app's count to 7, and then a page, a child frame and a service worker of the profile neither move nor clear it.
test(
  "a page, frame or service worker of the profile cannot set or clear the app's badge",
  async () => {
    const line = await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-app-badge.fixture.ts") })

    expect(JSON.parse(line)).toEqual({ unguarded: 7, page: 7, frame: 7, worker: 7, cleared: 7 })
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
