import { describe, expect, test } from "bun:test"
import path from "path"
import { ReadTool } from "../../src/tool/read"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.read env file blocking", () => {
  test.each([
    [".env", true],
    [".env.local", true],
    [".env.production", true],
    [".env.sample", false],
    [".env.example", false],
    [".envrc", false],
    ["environment.ts", false],
  ])("%s blocked=%s", async (filename, blocked) => {
    await using tmp = await tmpdir({
      init: (dir) => Bun.write(path.join(dir, filename), "content"),
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const read = await ReadTool.init()
        const promise = read.execute({ filePath: path.join(tmp.path, filename) }, ctx)
        if (blocked) {
          await expect(promise).rejects.toThrow("blocked")
        } else {
          expect((await promise).output).toContain("content")
        }
      },
    })
  })
})
