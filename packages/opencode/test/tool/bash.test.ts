import { describe, expect, test } from "bun:test"
import path from "path"
import { BashTool } from "../../src/tool/bash"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"

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
Log.init({ print: false })

describe("tool.bash", () => {
  test("basic", async () => {
    await Instance.provide(projectRoot, async () => {
      const result = await bash.execute(
        {
          command: "echo 'test'",
          description: "Echo test message",
        },
        ctx,
      )
      expect(result.metadata.exit).toBe(0)
      expect(result.metadata.output).toContain("test")
      expect(result.output).not.toContain("<timeout>")
    })
  })

  test("cd ../ should fail outside of project root", async () => {
    await Instance.provide(projectRoot, async () => {
      expect(
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

  test("timeout error should be emitted for long running commands", async () => {
    await App.provide({ cwd: projectRoot }, async () => {
      const result = await bash.execute(
        {
          command: "sleep 1",
          description: "Sleep for 1 seconds",
          timeout: 500,
        },
        ctx,
      )
      expect(result.output).toContain("<timeout>")
    })
  })

  test("exit code should be captured for failing commands", async () => {
    await App.provide({ cwd: projectRoot }, async () => {
      const result = await bash.execute(
        {
          command: 'bun --eval "process.exit(42)"',
          description: "Exit with code 42",
        },
        ctx,
      )
      expect(result.metadata.exit).toBe(42)
      expect(result.output).toContain("<exitCode>42</exitCode>")
    })
  })
})
