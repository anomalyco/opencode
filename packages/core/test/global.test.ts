import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/util/global"

describe("global paths", () => {
  test("tmp path is the canonical system temp directory", async () => {
    expect(Global.Path.tmp).toBe(await fs.realpath(path.join(os.tmpdir(), "opencode")))
    expect(Global.make().tmp).toBe(Global.Path.tmp)
  })

  test("tmp path is created on module load", async () => {
    expect((await fs.stat(Global.Path.tmp)).isDirectory()).toBe(true)
  })
})
