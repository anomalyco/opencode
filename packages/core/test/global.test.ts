import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "opencode"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test.skipIf(process.platform === "win32")("managed directories are private on module load", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-global-"))
    const tmp = path.join(root, "tmp")

    try {
      await fs.mkdir(path.join(root, "data", "opencode"), { recursive: true })
      await fs.chmod(path.join(root, "data", "opencode"), 0o755)
      await fs.mkdir(tmp, { recursive: true })

      const proc = Bun.spawn({
        cmd: [process.execPath, "-e", "await import('./src/global.ts')"],
        cwd: path.join(import.meta.dir, ".."),
        env: {
          ...process.env,
          XDG_DATA_HOME: path.join(root, "data"),
          XDG_CACHE_HOME: path.join(root, "cache"),
          XDG_CONFIG_HOME: path.join(root, "config"),
          XDG_STATE_HOME: path.join(root, "state"),
          TMPDIR: tmp,
        },
        stderr: "pipe",
      })

      if ((await proc.exited) !== 0) {
        throw new Error(await new Response(proc.stderr).text())
      }

      await Promise.all(
        [
          path.join(root, "data", "opencode"),
          path.join(root, "cache", "opencode"),
          path.join(root, "config", "opencode"),
          path.join(root, "state", "opencode"),
          path.join(root, "tmp", "opencode"),
          path.join(root, "data", "opencode", "log"),
          path.join(root, "cache", "opencode", "bin"),
          path.join(root, "data", "opencode", "repos"),
        ].map(async (dir) => {
          expect((await fs.stat(dir)).mode & 0o777).toBe(0o700)
        }),
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
