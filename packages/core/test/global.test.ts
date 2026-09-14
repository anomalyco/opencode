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
})

describe("Global.configDirs", () => {
  // Regression coverage for #28658: OPENCODE_CONFIG_DIR replaced the global
  // config dir instead of adding to it.
  test("checks an override in addition to the real global default", () => {
    expect(Global.configDirs("/override")).toEqual(["/override", Global.Path.config])
  })

  test("prioritizes the override over the real global default", () => {
    expect(Global.configDirs("/override")[0]).toBe("/override")
  })

  test("does not duplicate the path when there is no override", () => {
    expect(Global.configDirs(Global.Path.config)).toEqual([Global.Path.config])
  })
})
