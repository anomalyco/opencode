import { describe, expect, test } from "bun:test"
import os from "os"
import path from "path"
import { Global } from "@opencode-ai/util/global"

const within = (directory: string, root: string) => {
  const relative = path.relative(root, directory)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

describe("Core test environment", () => {
  test("isolates global home and XDG roots", () => {
    const home = process.env.OPENCODE_TEST_HOME
    expect(home).toBeDefined()
    if (!home) return

    expect(os.homedir()).toBe(home)
    expect(Global.Path.home).toBe(home)
    expect(within(Global.Path.config, home)).toBeTrue()
    expect(within(Global.Path.data, home)).toBeTrue()
    expect(within(Global.Path.cache, home)).toBeTrue()
    expect(within(Global.Path.state, home)).toBeTrue()
    expect(within(os.tmpdir(), home)).toBeTrue()
    expect(process.env.OPENCODE_CONFIG_DIR).toBe(Global.Path.config)
    expect(process.env.OPENCODE_CONFIG).toBeUndefined()
    expect(process.env.OPENCODE_CONFIG_CONTENT).toBeUndefined()
    expect(process.env.AWS_REGION).toBeUndefined()
    expect(process.env.GOOGLE_VERTEX_PROJECT).toBeUndefined()
    expect(process.env.NPM_CONFIG_REGISTRY).toBeUndefined()
    expect(process.env.UIDOTSH_AUTHORIZATION).toBeUndefined()
    if (process.env.RECORD !== "true") expect(process.env.OPENAI_API_KEY).toBeUndefined()
  })
})
