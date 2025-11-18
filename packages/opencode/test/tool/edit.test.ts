import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Permission } from "../../src/permission"
import { FileTime } from "../../src/file/time"
import * as fs from "fs/promises"
import { Log } from "../../src/util/log"

Log.init({ print: false })

const ctx = {
  sessionID: "test",
  messageID: "",
  toolCallID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

describe("tool.edit", () => {
  test("should allow edits when permission='allow'", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with edit='allow'
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async () => {})
    Permission.ask = permissionAskMock

    try {
      await using fixture = await tmpdir()
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const editTool = await EditTool.init()
          const testFile = path.join(fixture.path, "test.txt")
          await fs.writeFile(testFile, "original content")

          // Mark file as read (required by FileTime.assert)
          FileTime.read(ctx.sessionID, testFile)

          // Should succeed without asking
          await editTool.execute(
            {
              filePath: testFile,
              oldString: "original",
              newString: "modified",
            },
            ctx,
          )

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()

          // Verify file was edited
          const content = await fs.readFile(testFile, "utf-8")
          expect(content).toBe("modified content")
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should deny edits when permission='deny'", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with edit='deny'
    Agent.get = mock(async () => ({
      permission: {
        edit: "deny" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async () => {})
    Permission.ask = permissionAskMock

    try {
      await using fixture = await tmpdir()
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const editTool = await EditTool.init()
          const testFile = path.join(fixture.path, "test.txt")
          await fs.writeFile(testFile, "original content")

          // Mark file as read (required by FileTime.assert)
          FileTime.read(ctx.sessionID, testFile)

          // Should throw without asking
          await expect(
            editTool.execute(
              {
                filePath: testFile,
                oldString: "original",
                newString: "modified",
              },
              ctx,
            ),
          ).rejects.toThrow("Permission denied: Cannot edit file")

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()

          // Verify file was NOT edited
          const content = await fs.readFile(testFile, "utf-8")
          expect(content).toBe("original content")
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should ask and allow edits when permission='ask' and user approves", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with edit='ask'
    Agent.get = mock(async () => ({
      permission: {
        edit: "ask" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async (input: any) => {
      expect(input.type).toBe("edit")
      // Resolve without throwing to simulate user approval
    })
    Permission.ask = permissionAskMock

    try {
      await using fixture = await tmpdir()
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const editTool = await EditTool.init()
          const testFile = path.join(fixture.path, "test.txt")
          await fs.writeFile(testFile, "original content")

          // Mark file as read (required by FileTime.assert)
          FileTime.read(ctx.sessionID, testFile)

          // Should succeed after asking
          await editTool.execute(
            {
              filePath: testFile,
              oldString: "original",
              newString: "modified",
            },
            ctx,
          )

          // Verify Permission.ask WAS called
          expect(permissionAskMock).toHaveBeenCalled()

          // Verify file was edited
          const content = await fs.readFile(testFile, "utf-8")
          expect(content).toBe("modified content")
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should ask and deny edits when permission='ask' and user denies", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with edit='ask'
    Agent.get = mock(async () => ({
      permission: {
        edit: "ask" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "ask" as const,
        doom_loop: "ask" as const,
      },
    })) as any

    const originalAsk = Permission.ask
    const permissionAskMock = mock(async (input: any) => {
      expect(input.type).toBe("edit")
      // Throw to simulate user denial
      throw new Error("Permission denied by user")
    })
    Permission.ask = permissionAskMock

    try {
      await using fixture = await tmpdir()
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const editTool = await EditTool.init()
          const testFile = path.join(fixture.path, "test.txt")
          await fs.writeFile(testFile, "original content")

          // Mark file as read (required by FileTime.assert)
          FileTime.read(ctx.sessionID, testFile)

          // Should throw because permission was denied
          await expect(
            editTool.execute(
              {
                filePath: testFile,
                oldString: "original",
                newString: "modified",
              },
              ctx,
            ),
          ).rejects.toThrow("Permission denied by user")

          // Verify Permission.ask WAS called
          expect(permissionAskMock).toHaveBeenCalled()

          // Verify file was NOT edited
          const content = await fs.readFile(testFile, "utf-8")
          expect(content).toBe("original content")
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })
})
