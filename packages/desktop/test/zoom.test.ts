import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Uses real Electron windows and a fresh settings profile across two processes.
test.skipIf(!!process.env.CI)(
  "desktop restores zoom after relaunch and preserves it when pinch zoom is disabled",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-zoom-"))
    const output = await mkdtemp(path.resolve(import.meta.dir, "../node_modules/.zoom-test-"))
    try {
      const built = await Bun.build({
        entrypoints: [path.join(import.meta.dir, "zoom/native.ts")],
        outdir: output,
        naming: "native.mjs",
        target: "node",
        format: "esm",
        external: ["electron"],
      })
      if (!built.success) throw new AggregateError(built.logs)
      const electron: unknown = (await import("electron")).default
      if (typeof electron !== "string") throw new Error("Electron binary path is unavailable.")
      for (const restore of ["0", "1"]) {
        const child = Bun.spawn([electron, path.join(output, "native.mjs")], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ZOOM_TEST_ROOT: root, ZOOM_TEST_RESTORE: restore },
          stdout: "inherit",
          stderr: "inherit",
        })
        const timeout = setTimeout(() => child.kill(), 15_000)
        try {
          expect(await child.exited).toBe(0)
        } finally {
          clearTimeout(timeout)
          if (child.exitCode === null) child.kill()
        }
      }
    } finally {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(output, { recursive: true, force: true })])
    }
  },
  45_000,
)
