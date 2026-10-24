import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"

test("uninstall preview excludes settings while retaining config-suffixed service channels", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-uninstall-config-"))
  const state = path.join(root, "shared", "opencode")
  const registration = { id: "preview", version: "1.0.0", url: "http://127.0.0.1:41234", pid: 123, password: "runtime" }
  try {
    await fs.mkdir(state, { recursive: true })
    await Bun.write(path.join(state, "service.json"), JSON.stringify(registration))
    await Bun.write(path.join(state, "service-work-config.json"), JSON.stringify(registration))
    await Bun.write(path.join(state, "service-local-config.json"), JSON.stringify({ port: 41234, password: "saved" }))
    const child = Bun.spawn([process.execPath, "src/index.ts", "uninstall", "--dry-run"], {
      cwd: path.join(import.meta.dir, ".."),
      env: isolatedEnv(root, {
        XDG_CONFIG_HOME: path.join(root, "shared"),
        XDG_STATE_HOME: path.join(root, "shared"),
        OPENCODE_CONFIG_DIR: state,
      }),
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ exit, stderr }).toEqual({ exit: 0, stderr: "" })
    expect(stdout).toContain(path.join(state, "service.json"))
    expect(stdout).toContain(path.join(state, "service-work-config.json"))
    expect(stdout).not.toContain(path.join(state, "service-local-config.json"))
    expect(await Bun.file(path.join(state, "service-work-config.json")).json()).toEqual(registration)
    expect(await Bun.file(path.join(state, "service-local-config.json")).json()).toEqual({
      port: 41234,
      password: "saved",
    })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
