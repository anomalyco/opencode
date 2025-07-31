import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/app"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Log } from "../../src/util/log"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const bash = await BashTool.init()
const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("tool.bash", () => {
  test("basic", async () => {
    await App.provide({ cwd: projectRoot }, async () => {
      await bash.execute(
        {
          command: "cd foo/bar && ls",
          description: "List files in foo/bar",
        },
        ctx,
      )
    })
  })

  test("cd ../ should fail", async () => {
    await App.provide({ cwd: projectRoot }, async () => {
      expect(
        bash.execute(
          {
            command: "cd ../",
            description: "Try to cd to parent directory",
          },
          ctx,
        ),
      ).rejects.toThrow()
    })
  })
})
