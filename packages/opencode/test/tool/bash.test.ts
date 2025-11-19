import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Instance } from "../../src/project/instance"
import { Permission } from "../../src/permission"

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

const bash = await BashTool.init()
const projectRoot = path.join(__dirname, "../..")

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await bash.execute(
          {
            command: "echo 'test'",
            description: "Echo test message",
          },
          ctx,
        )
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      },
    })
  })

  // TODO: better test
  // test("cd ../ should ask for permission for external directory", async () => {
  //   await Instance.provide({
  //     directory: projectRoot,
  //     fn: async () => {
  //       bash.execute(
  //         {
  //           command: "cd ../",
  //           description: "Try to cd to parent directory",
  //         },
  //         ctx,
  //       )
  //       // Give time for permission to be asked
  //       await new Promise((resolve) => setTimeout(resolve, 1000))
  //       expect(Permission.pending()[ctx.sessionID]).toBeDefined()
  //     },
  //   })
  // })
})
