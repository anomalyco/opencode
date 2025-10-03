import { describe, expect, test } from "bun:test"
import path from "path"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const edit = await EditTool.init()

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.edit", () => {
  test("rejects edits outside workspace", async () => {
    await using dir = await tmpdir()
    await Instance.provide({
      directory: dir.path,
      fn: async () => {
        await expect(
          edit.execute(
            {
              filePath: path.join(dir.path, "..", "escape.txt"),
              oldString: "foo",
              newString: "bar",
            },
            ctx,
          ),
        ).rejects.toThrow("not in the current working directory")
      },
    })
  })
})
