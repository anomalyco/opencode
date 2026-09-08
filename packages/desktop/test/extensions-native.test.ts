import { test, expect } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { pathToFileURL } from "node:url"

test.skipIf(!!process.env.CI)(
  "installed main extensions hot-load, reload, replace and dispose in Electron",
  async () => {
    const root = await mkdtemp(
      path.join(process.platform === "win32" ? "C:/tmp/opencode" : tmpdir(), "extension-native-"),
    )
    const output = await mkdtemp(path.resolve(import.meta.dir, "../node_modules/.extension-native-"))
    const built = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "extensions/native.ts")],
      outdir: output,
      naming: "native.cjs",
      target: "node",
      format: "cjs",
      external: ["electron"],
      define: {
        "import.meta": JSON.stringify({
          url: pathToFileURL(path.join(output, "native.cjs")).href,
          env: { OPENCODE_CHANNEL: "dev" },
        }),
      },
    })
    if (!built.success) throw new AggregateError(built.logs)
    await Bun.write(path.join(output, "entry.cjs"), Bun.file(path.join(import.meta.dir, "extensions/entry.cjs")))
    const electron: unknown = (await import("electron")).default
    if (typeof electron !== "string") throw new Error("Electron binary is unavailable")
    const child = Bun.spawn([electron, path.join(output, "entry.cjs")], {
      cwd: output,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, EXTENSION_TEST_HOME: root },
      stdout: "inherit",
      stderr: "inherit",
    })
    try {
      expect(await child.exited).toBe(0)
    } finally {
      if (child.exitCode === null) {
        child.kill()
        await child.exited
      }
      await Promise.all([rm(root, { recursive: true, force: true }), rm(output, { recursive: true, force: true })])
    }
  },
  30000,
)
