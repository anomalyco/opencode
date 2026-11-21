import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { schemes } from "../schemes"
import { runElectronFixture } from "./electron-run"

// Attaching a pane to a remote server, while the user shares sign-ins with remote servers, waited for the whole first
// copy of the profile's cookies into the server's partition. A copy that outlasted the attachment's 15 seconds made
// the window register again: one more partition and one more copy, beside the first, which nothing could stop, and
// quitting waited for all of them. This runs the real pane in the pinned Electron against a stand-in for the remote
// server, with a copy that takes as long as the fixture holds it, and compares the order things happened in.
test(
  "a pane attaches while its sign-ins are still being copied; only its page waits for them, and a registration that ends takes its copy along",
  async () => {
    // The canonical name: the preview's file checks compare physical paths, and Windows temp paths can be 8.3 names.
    const root = realpathSync.native(await mkdtemp(path.join(tmpdir(), "electron-sign-in-copy-")))

    try {
      const result: { events: string[] } = JSON.parse(
        await runElectronFixture({ fixture: path.join(import.meta.dir, "electron-sign-in-copy.fixture.ts"), schemes, env: { ELECTRON_SIGN_IN_COPY_ROOT: root } }),
      )

      expect(result.events).toEqual([
        // The attachment goes ahead with the copy under way: the server is attached to once, and the window's
        // registration resolves.
        "log browser sign-in copy started",
        "attach",
        "mark registered=true",
        // The restored tab's page waits, with nothing copied yet, and loads signed in once the copy ended.
        "mark tab loading=true copied=0",
        "log browser sign-in copy finished toRemote=301",
        "page /account signed in",
        "mark page loaded=true title=Signed in copied=301",
        // Registering again while a copy is under way: one copy and one attachment each, and no more.
        "log browser sign-in copy started",
        "attach",
        "mark registered again",
        "log browser sign-in copy started",
        "attach",
        "mark registered a third time",
        // The registration left behind had its copy cancelled before it wrote a cookie.
        "log browser sign-in copy cancelled written=0",
        "mark abandoned partition holds=0",
        "log browser sign-in copy finished toRemote=301",
        "mark kept partition holds=301",
        // Quitting did not wait for the copy under way, which was cancelled.
        "log browser sign-in copy started",
        "attach",
        "mark registered before quitting",
        "mark disposed",
        "log browser sign-in copy cancelled written=0",
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
