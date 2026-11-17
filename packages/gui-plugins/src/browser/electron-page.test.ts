import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"

// Who a page's activity belongs to rests on Chromium's own input events (`createBrowserPage` in chromium.ts). This runs
// one pane page in the pinned Electron, so an upgrade that changes which events a page or the agent raises fails here.
test(
  "page navigations are not the person's input, an agent's right-click opens no native menu, and another window's calls are refused",
  async () => {
    const out = await mkdtemp(path.join(tmpdir(), "electron-page-"))

    try {
      // ES modules in chunks: the page's dependencies use `import.meta`, and the fixture installs its failure handlers
      // before it loads them, so a fixture that cannot load ends quietly instead of opening Electron's error box.
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "electron-page.fixture.ts")],
        outdir: out,
        target: "node",
        format: "esm",
        splitting: true,
        naming: { entry: "[name].mjs", chunk: "[name]-[hash].mjs" },
        external: ["electron"],
      })

      if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")
      const log = path.join(out, "fixture.log")

      const child = Bun.spawn(
        [
          String(electron),
          `--user-data-dir=${path.join(out, "profile")}`,
          // CI's Linux runners have no display, and node_modules' chrome-sandbox is not set up as root.
          ...(process.platform === "linux" ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"] : []),
          path.join(out, "electron-page.fixture.mjs"),
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined, ELECTRON_PAGE_FIXTURE_LOG: log },
          stdout: "pipe",
          stderr: "pipe",
        },
      )

      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split("\n").find((text) => text.startsWith("{"))

      if (!line) {
        const failure = await Bun.file(log).text().catch(() => "")

        throw new Error(`Electron printed no result (exit ${code}).\n${failure}\n${stderr}`)
      }

      const result = JSON.parse(line)

      // History API writes, a client redirect and a frame load while the page boots are nobody's input, so a plugin's
      // right to close the tab it opened survives them.
      expect(result.booted).toEqual({ popups: 0, menus: 0, inputs: 0, owner: "user" })
      // The page saw the agent's right-click, the tab became the agent's, and no native menu opened.
      expect(result.agent).toEqual({ popups: 0, menus: 1, inputs: 0, owner: "agent" })
      // The person's own right-click opens the menu and takes the tab back.
      expect(result.person).toEqual({ popups: 1, menus: 2, inputs: 1, owner: "user" })
      // With the menu armed by the person, the agent's next right-click still opens none.
      expect(result.after).toEqual({ popups: 1, menus: 3, inputs: 1, owner: "agent" })
      // createTab, closeTab, command, openPage and load: the window that registered the binding gets each call's own
      // answer, and any other window is refused before the call does anything.
      const unready = "Browser network is not ready; no tab was opened."
      expect(result.windows.owner).toEqual([unready, "returned false", unready, "browser.pane.unavailable", "returned undefined"])
      expect(result.windows.other).toEqual(Array(5).fill("browser.pane.unavailable"))
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
