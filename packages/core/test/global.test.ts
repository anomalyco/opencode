import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/util/global"

describe("global paths", () => {
  test("tmp path is canonical and created on first access", async () => {
    const tmp = Global.Path.tmp
    expect(tmp).toBe(await fs.realpath(path.join(os.tmpdir(), "opencode")))
    expect(Global.make().tmp).toBe(tmp)
    expect((await fs.stat(tmp)).isDirectory()).toBe(true)
  })
})
