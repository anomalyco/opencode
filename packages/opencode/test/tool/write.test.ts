import { describe, expect, test } from "bun:test"
import path from "path"
import { WriteTool } from "../../src/tool/write"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const tool = await WriteTool.init()

const baseCtx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.write", () => {
  test("writes file within workspace", async () => {
    await using dir = await tmpdir()
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const target = path.join(dir.path, "note.txt")
        const result = await tool.execute(
          {
            filePath: target,
            content: "hello world",
          },
          baseCtx,
        )
        const written = await Bun.file(target).text()
        expect(written).toBe("hello world")
        expect(result.metadata["filepath"]).toBe(target)
        expect(result.metadata["exists"]).toBe(false)
      },
    })
  })

  test("rejects paths outside workspace", async () => {
    await using dir = await tmpdir()
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        const outside = path.join(dir.path, "..", "escape.txt")
        await expect(
          tool.execute(
            {
              filePath: outside,
              content: "nope",
            },
            baseCtx,
          ),
        ).rejects.toThrow("not in the current working directory")
      },
    })
  })
})
