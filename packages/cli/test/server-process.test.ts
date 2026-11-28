import { expect, test } from "bun:test"
import { stripLauncherEnv } from "../src/server-process"

test("service strips AppImage launcher variables from its environment", () => {
  const keys = ["ARGV0", "APPIMAGE", "APPDIR"] as const
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
  try {
    Object.assign(process.env, {
      ARGV0: "/home/user/AppImages/opencode.appimage",
      APPIMAGE: "/home/user/AppImages/opencode.appimage",
      APPDIR: "/tmp/.mount_opencodeXXXX",
      OPENCODE_SERVER_PROCESS_TEST: "kept",
    })

    stripLauncherEnv()

    for (const key of keys) expect(process.env[key]).toBeUndefined()
    expect(process.env.OPENCODE_SERVER_PROCESS_TEST).toBe("kept")
  } finally {
    delete process.env.OPENCODE_SERVER_PROCESS_TEST
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
