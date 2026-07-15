import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/core/global"

describe("global paths", () => {
  test("tmp path is under the system temp directory as kancode", () => {
    expect(Global.Path.tmp).toBe(path.join(os.tmpdir(), "kancode"))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })

  test("data cache state paths use kancode without opencode fallback", () => {
    expect(path.basename(Global.Path.data)).toBe("kancode")
    expect(path.basename(Global.Path.cache)).toBe("kancode")
    expect(path.basename(Global.Path.state)).toBe("kancode")
    expect(path.basename(Global.Path.config)).toBe("kancode")
  })
})
