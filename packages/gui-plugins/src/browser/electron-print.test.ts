import { expect, test } from "bun:test"
import path from "node:path"
import { runElectronFixture } from "./electron-run"

// The print gate (print-gate.ts) must keep window.print() from opening the system dialog on a tab the agent drives, in
// the page and its frames, while a person's own tab keeps the browser's print(). Runs in the pinned Electron.
test(
  "the pinned Electron gives an agent-driven tab a print() that opens no dialog, and a person's tab the browser's own",
  async () => {
    const result = JSON.parse(await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-print.fixture.ts") }))

    // [page, frame]: true while print() is still the browser's own.
    expect(result.agent).toEqual([false, false])
    expect(result.agentReturned).toBe("returned")
    expect(result.personBefore).toEqual([true, true])
    // The agent taking a person's tab over replaces print() in the page already open, too.
    expect(result.takenOver).toEqual([false, false])
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
