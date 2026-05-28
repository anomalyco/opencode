import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"

import { createSidecarEnv, sidecarDefaultCwd } from "./server-env"

describe("sidecar environment", () => {
  test("uses an app-private default workspace instead of the process cwd", () => {
    const userDataPath = "/tmp/opencode-user-data"

    expect(sidecarDefaultCwd(userDataPath)).toBe(join(resolve(userDataPath), "default-workspace"))
  })

  test("sets PWD to the sidecar cwd and removes debug-only inherited variables", () => {
    const env = createSidecarEnv({
      cwd: "/tmp/opencode-user-data/default-workspace",
      platform: "linux",
      env: {
        DEBUG: "1",
        LD_PRELOAD: "/tmp/hook.so",
        PATH: "/usr/bin",
        PWD: "/Users/example",
      },
    })

    expect(env.PWD).toBe("/tmp/opencode-user-data/default-workspace")
    expect(env.PATH).toBe("/usr/bin")
    expect(env.DEBUG).toBeUndefined()
    expect(env.LD_PRELOAD).toBeUndefined()
  })
})
