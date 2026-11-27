import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// The media gate (media-gate.ts) must hold a page's getUserMedia before Chromium's media stack runs, as that stack opens
// microphones to read their capabilities and makes macOS ask for them. This runs it in the pinned Electron with fake
// devices: the permission handler, the first step Chromium takes after that stack, is never reached before the gate's
// answer, and not at all after a refusal.
test(
  "the pinned Electron reaches nothing of the media stack before the pane answers a page's getUserMedia",
  async () => {
    const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-media.fixture.ts") }))

    // Refused by the pane: the page is told no and Chromium never sees the request.
    expect(result.blocked).toBe("NotAllowedError")
    expect(result.afterBlock).toEqual([`gate ${result.origin} true microphone`, "answered false"])
    // Let through: only then does Chromium ask the session (which refuses here, so nothing is ever granted).
    expect(result.released).toBe("NotAllowedError")
    expect(result.afterRelease.slice(0, 3)).toEqual([`gate ${result.origin} true microphone`, "answered true", "handler media"])
    // The legacy callback form goes through the same gate.
    expect(result.legacy).toBe("NotAllowedError")
  },
  // Starting Electron takes seconds on a loaded runner; each held call waits 300 ms for its answer.
  60_000,
)
