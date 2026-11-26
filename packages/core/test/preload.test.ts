import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Global } from "@opencode/util/global"

describe("Core test environment", () => {
  test("disables public npm security audits", () => {
    expect(process.env.NPM_CONFIG_AUDIT).toBe("false")
  })

  test("isolates global home and XDG roots", () => {
    const home = process.env.OPENCODE_TEST_HOME
    expect(home).toBeDefined()
    if (!home) return

    expect(os.homedir()).toBe(home)
    expect(Global.Path.home).toBe(home)
    expect(Global.Path.config).toBe(path.join(home, ".config", "opencode"))
    expect(Global.Path.data).toBe(path.join(home, ".local", "share", "opencode"))
    expect(Global.Path.cache).toBe(path.join(home, ".cache", "opencode"))
    expect(Global.Path.state).toBe(path.join(home, ".local", "state", "opencode"))
    expect(os.tmpdir()).toBe(path.join(home, "tmp"))
    expect(process.env.OPENCODE_CONFIG_DIR).toBe(Global.Path.config)
    expect(process.env.OPENCODE_CONFIG).toBeUndefined()
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
    expect(process.env.GOOGLE_VERTEX_PROJECT).toBeUndefined()
    expect(process.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(process.env.UIDOTSH_AUTHORIZATION).toBeUndefined()
    if (process.env.RECORD !== "true") expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })

  test("preload isolates Global.Path when bun test runs without script/test.ts", async () => {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        "--preload",
        "./test/preload.ts",
        "-e",
        'import { Global } from "@opencode/util/global"; console.log(JSON.stringify({ home: Global.Path.home, config: Global.Path.config, data: Global.Path.data, envHome: process.env.OPENCODE_TEST_HOME }))',
      ],
      cwd: path.resolve(import.meta.dir, ".."),
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...(process.platform === "win32"
          ? { USERPROFILE: process.env.USERPROFILE, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP }
          : {}),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited])
    expect(exitCode).toBe(0)
    const result = JSON.parse(stdout.trim())
    expect(result.envHome).toBeDefined()
    expect(result.home).toBe(result.envHome)
    expect(result.config).toBe(path.join(result.envHome, ".config", "opencode"))
    expect(result.data).toBe(path.join(result.envHome, ".local", "share", "opencode"))
  })
})
