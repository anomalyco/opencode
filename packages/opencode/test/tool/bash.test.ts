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
      const result = await bash.execute(
        {
          command: "echo 'test'",
          description: "Echo test message",
        },
        ctx,
      )
      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.stdout).toContain("test")
    })
  })

  test("cd ../ should fail outside of project root", async () => {
    await App.provide({ cwd: projectRoot }, async () => {
      await expect(
        bash.execute(
          {
            command: "cd ../",
            description: "Try to cd to parent directory",
          },
          ctx,
        ),
      ).rejects.toThrow("This command references paths outside of")
    })
  })
})
