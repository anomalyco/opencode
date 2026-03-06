import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Pty } from "../../src/pty"
import { tmpdir } from "../fixture/fixture"

describe("pty shell args", () => {
  if (process.platform !== "win32") return

  const ps = Bun.which("pwsh") || Bun.which("powershell")
  if (ps) {
    test(
      "does not add login args to pwsh",
      async () => {
        await using dir = await tmpdir()
        await Instance.provide({
          directory: dir.path,
          fn: async () => {
            const info = await Pty.create({ command: ps, title: "pwsh" })
            try {
              expect(info.args).toEqual([])
            } finally {
              await Pty.remove(info.id)
            }
          },
        })
      },
      { timeout: 30000 },
    )
  }

  const bash = Bun.which("bash")
  if (bash) {
    test(
      "adds login args to bash",
      async () => {
        await using dir = await tmpdir()
        await Instance.provide({
          directory: dir.path,
          fn: async () => {
            const info = await Pty.create({ command: bash, title: "bash" })
            try {
              expect(info.args).toEqual(["-l"])
            } finally {
              await Pty.remove(info.id)
            }
          },
        })
      },
      { timeout: 30000 },
    )
  }
})
