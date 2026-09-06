import { expect, test } from "bun:test"
import { spawnSync } from "child_process"
import { mkdtemp, rm } from "fs/promises"
import os from "os"
import path from "path"

test("generated config schema exposes root properties for JSON language servers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "opencode-schema-"))
  try {
    const configFile = path.join(dir, "config.json")
    const result = spawnSync("bun", ["./script/schema.ts", configFile], {
      cwd: path.join(__dirname, "../.."),
      encoding: "utf8",
    })

    expect(result.status).toBe(0)
    const schema = await Bun.file(configFile).json()
    expect(schema.$ref).toBeUndefined()
    expect(schema.allowComments).toBeUndefined()
    expect(schema.allowTrailingCommas).toBeUndefined()
    expect(schema.type).toBe("object")
    expect(schema.properties).toHaveProperty("provider")
    expect(schema.properties).toHaveProperty("model")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
