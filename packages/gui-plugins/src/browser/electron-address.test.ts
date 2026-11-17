import { expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { schemes } from "../schemes"
import { runElectronFixture } from "./electron-run"

// An address typed in the pane reaches the page as a user's `navigate` (`createBrowserPage` in chromium.ts). A file
// inside the session's workspace opens as a scoped preview through the real protocol handler and file checks, which no
// pure test reaches. This runs that path in the pinned Electron.
test(
  "a typed workspace file opens as a preview, one outside is refused in place, a web address loads, and Stop during the startup gate keeps the committed page",
  async () => {
    // The canonical name: the preview's file checks compare physical paths, and Windows temp paths can be 8.3 names.
    const base = realpathSync.native(await mkdtemp(path.join(tmpdir(), "electron-address-")))

    try {
      const root = path.join(base, "workspace")
      await mkdir(root)
      await writeFile(path.join(root, "inside.html"), '<!doctype html><title>Inside</title><iframe src="frame.html"></iframe>')
      await writeFile(path.join(root, "frame.html"), "<!doctype html><title>Frame</title>")
      await writeFile(path.join(base, "outside.html"), "<!doctype html><title>Outside</title>")

      const result = JSON.parse(
        await runElectronFixture({
          fixture: path.join(import.meta.dir, "electron-address.fixture.ts"),
          schemes,
          env: { ELECTRON_ADDRESS_ROOT: root, ELECTRON_ADDRESS_OUTSIDE: path.join(base, "outside.html") },
        }),
      )

      const preview = { url: result.inside, title: "Inside", preview: true }
      // The bar shows the file's own address; the document on screen is the scoped preview, never a native file origin.
      expect(result.file).toEqual({ outcome: "done", ...preview })
      // Outside the workspace: the window's refusal notice, and the previous page stays with its address.
      expect(result.notice).toBe("browser.address.workspace")
      expect(result.refused).toEqual({ outcome: "Only HTTP, HTTPS, about:blank, and file URLs inside the workspace are supported.", ...preview })
      expect(result.web).toEqual({ outcome: "done", url: `${result.origin}/web`, title: "Web", preview: false })
      // Typed while the gate holds web navigations, then Stop: nothing was requested and the bar shows the committed
      // document, not the address that never loaded.
      expect(result.stopped).toEqual({ outcome: "done", held: "done", ...preview, requests: 0 })
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
