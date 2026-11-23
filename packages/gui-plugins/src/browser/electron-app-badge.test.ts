import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// Electron draws what a page asks of `navigator.setAppBadge` on the app's taskbar button or Dock icon, where the app
// shows its own count, and Chromium has no switch for it. The profile's preload keeps a site off it
// (`profile/extension-api/app-badge.js`). This runs that preload in the pinned Electron: a page without it sets the
// app's count to 7, and then a page, a child frame and a service worker of the profile neither move nor clear it.
test(
  "a page, frame or service worker of the profile cannot set or clear the app's badge",
  async () => {
    const line = await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-app-badge.fixture.ts") })
    // Electron keeps a badge count on Windows and macOS. On Linux it keeps none outside Unity, so there this shows only
    // that the profile's pages, frames and workers still run with the preload.
    const count = process.platform === "linux" ? 0 : 7

    expect(JSON.parse(line)).toEqual({ unguarded: count, page: count, frame: count, worker: count, cleared: count })
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
