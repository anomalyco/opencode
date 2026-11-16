import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"

// The media gate (media-gate.ts) must hold a page's getUserMedia before Chromium's media stack runs, as that stack opens
// microphones to read their capabilities and makes macOS ask for them. This runs it in the pinned Electron with fake
// devices: the permission handler, the first step Chromium takes after that stack, is never reached before the gate's
// answer, and not at all after a refusal.
test(
  "the pinned Electron reaches nothing of the media stack before the pane answers a page's getUserMedia",
  async () => {
    const out = await mkdtemp(path.join(tmpdir(), "electron-media-"))

    try {
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "electron-media.fixture.ts")],
        outdir: out,
        target: "node",
        format: "cjs",
        external: ["electron"],
      })

      if (!built.success) throw new AggregateError(built.logs, "The Electron fixture did not build.")

      const child = Bun.spawn(
        [
          String(electron),
          // CI's Linux runners have no display, and node_modules' chrome-sandbox is not set up as root.
          ...(process.platform === "linux" ? ["--ozone-platform=headless", "--no-sandbox", "--disable-gpu"] : []),
          path.join(out, "electron-media.fixture.js"),
        ],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined }, stdout: "pipe", stderr: "pipe" },
      )

      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split("\n").find((text) => text.startsWith("{"))

      if (!line) throw new Error(`Electron printed no result (exit ${code}).\n${stderr}`)

      const result = JSON.parse(line)

      // Refused by the pane: the page is told no and Chromium never sees the request.
      expect(result.blocked).toBe("NotAllowedError")
      expect(result.afterBlock).toEqual([`gate ${result.origin} true microphone`, "answered false"])
      // Let through: only then does Chromium ask the session (which refuses here, so nothing is ever granted).
      expect(result.released).toBe("NotAllowedError")
      expect(result.afterRelease.slice(0, 3)).toEqual([`gate ${result.origin} true microphone`, "answered true", "handler media"])
      // The legacy callback form goes through the same gate.
      expect(result.legacy).toBe("NotAllowedError")
    } finally {
      await rm(out, { recursive: true, force: true })
    }
  },
  // Starting Electron takes seconds on a loaded runner; each held call waits 300 ms for its answer.
  60_000,
)
