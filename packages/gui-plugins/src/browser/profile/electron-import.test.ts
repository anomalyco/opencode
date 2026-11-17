import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import electron from "electron"
import { madeUpFirefox } from "./made-up-firefox.fixture"

// An import of chosen sites writes only those sites' cookies into Electron's cookie store, keeps domain and host-only
// cookies as they were, and a later import adds a site without removing the first. This runs the real read and the
// profile's writer in the pinned Electron, against a made-up Firefox profile in a temporary home.
test(
  "the pinned Electron receives only the chosen sites' cookies, and a second import adds to them",
  async () => {
    const out = await mkdtemp(path.join(tmpdir(), "electron-import-"))
    const made = await madeUpFirefox()

    try {
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "electron-import.fixture.ts")],
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
          path.join(out, "electron-import.fixture.js"),
        ],
        { env: { ...process.env, ...made.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: undefined }, stdout: "pipe", stderr: "pipe" },
      )

      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
      const line = stdout.split("\n").find((text) => text.startsWith("{"))

      if (!line) throw new Error(`Electron printed no result (exit ${code}).\n${stderr}`)

      const result = JSON.parse(line)

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
      await Promise.all([out, made.home].map((directory) => rm(directory, { recursive: true, force: true }).catch(() => undefined)))
    }
  },
  // Starting Electron takes seconds on a loaded runner.
  60_000,
)
