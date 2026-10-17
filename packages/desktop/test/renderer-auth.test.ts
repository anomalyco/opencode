import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

// Spawns a real Electron window; CI runners have no display for it.
test.skipIf(!!process.env.CI)(
  "renderer authenticates to a non-loopback service without sharing its credential",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opencode-renderer-auth-"))
    const built = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "renderer-auth.ts")],
      outdir: root,
      naming: "renderer-auth.mjs",
      target: "node",
      format: "esm",
      external: ["electron"],
    })
    if (!built.success) throw new AggregateError(built.logs)
    const electron: unknown = (await import("electron")).default
    if (typeof electron !== "string") throw new Error("Electron binary path is unavailable.")
    const native = Bun.spawn(
      [electron, ...(process.platform === "linux" ? ["--no-sandbox"] : []), path.join(root, "renderer-auth.mjs")],
      {
        env: { ...process.env, SMOKE_ROOT: root, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_RENDERER_URL: undefined },
        stdout: "pipe",
        stderr: "pipe",
      },
    )
    try {
      const [code, stderr] = await Promise.all([native.exited, new Response(native.stderr).text()])
      expect(code, stderr).toBe(0)
    } finally {
      if (native.exitCode === null) {
        native.kill()
        await native.exited
      }
      await rm(root, { recursive: true, force: true })
    }
  },
)
