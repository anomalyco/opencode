import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"

// The pane takes a page's dialogs through Electron internals (`takeDialogs` in page-prompts.ts). This runs it in the
// pinned Electron, so an upgrade that changes them fails here rather than in a user's page.
test(
  "the pinned Electron hands the pane every dialog of a sandboxed page, which never hangs or shows a native box",
  async () => {
    const out = await mkdtemp(path.join(tmpdir(), "electron-dialogs-"))

    try {
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "electron-dialogs.fixture.ts")],
        outdir: out,
        target: "node",
        format: "cjs",
        naming: "[name].cjs",
        external: ["electron"],
      })

      if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")

      const child = Bun.spawn(
        [
          String(electron),
          `--user-data-dir=${path.join(out, "profile")}`,
          // CI's Linux runners have no display, and node_modules' chrome-sandbox is not set up as root.
          ...(process.platform === "linux" ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"] : []),
          path.join(out, "electron-dialogs.fixture.cjs"),
        ],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined }, stdout: "pipe", stderr: "pipe" },
      )

      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split("\n").find((text) => text.startsWith("{"))

      if (!line) throw new Error(`Electron printed no result (exit ${code}).\n${stderr}`)
      const result = JSON.parse(line)

      // Electron's own listener draws the native box; the pane's replaces it, and Electron's contract matched.
      expect(result.before).toBe(1)
      expect(result.after).toBe(1)
      expect(result.warnings).toEqual([])
      expect(result.opened).toEqual([
        { type: "alert", message: "a", origin: result.origin },
        { type: "confirm", message: "c", origin: result.origin },
        { type: "prompt", message: "p", origin: result.origin },
      ])
      // prompt() answers as Chromium's own does, under a CSP that allows no frame.
      expect(result.answers).toEqual([null, true, "typed"])
      expect(result.unanswered).toBe(false)
      expect(result.choosers).toEqual({ user: 0, picks: [1, 1, 1, 1], delayed: 1, returned: 0, intercepts: { backup: 7, product: 5 } })
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner; the takeover's own fallback waits 2 seconds.
  60_000,
)
