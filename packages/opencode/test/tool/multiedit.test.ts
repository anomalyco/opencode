import { describe, expect, test } from "bun:test"
import path from "path"
import { MultiEditTool } from "../../src/tool/multiedit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const multi = await MultiEditTool.init()
const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.multiedit", () => {
  test("rejects override path outside workspace", async () => {
    await using dir = await tmpdir()
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(
          multi.execute(
            {
              filePath: path.join(dir.path, "file.txt"),
              edits: [
                {
                  filePath: path.join(dir.path, "..", "escape.txt"),
                  oldString: "",
                  newString: "data",
                },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow("not in the current working directory")
      },
    })
  })
})
