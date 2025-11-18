import { describe, expect, test, mock } from "bun:test"
import path from "path"
import { PatchTool } from "../../src/tool/patch"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Permission } from "../../src/permission"
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

const patchTool = await PatchTool.init()

describe("tool.patch", () => {
  test("should validate required parameters", async () => {
    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        expect(patchTool.execute({ patchText: "" }, ctx)).rejects.toThrow("patchText is required")
      },
    })
  })

  test("should validate patch format", async () => {
    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        expect(patchTool.execute({ patchText: "invalid patch" }, ctx)).rejects.toThrow("Failed to parse patch")
      },
    })
  })

  test("should handle empty patch", async () => {
    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        const emptyPatch = `*** Begin Patch
*** End Patch`

        expect(patchTool.execute({ patchText: emptyPatch }, ctx)).rejects.toThrow("No file changes found in patch")
      },
    })
  })

  test("should ask permission for files outside working directory (permission='ask', user denies)", async () => {
    // Mock Permission.ask to verify it gets called with correct parameters
    const permissionAskMock = mock(async (input: any) => {
      // Verify the permission request has the right properties
      expect(input.type).toBe("external_directory")
      expect(input.title).toContain("/etc/passwd")
      expect(input.sessionID).toBe(ctx.sessionID)
      // Throw to simulate user denying permission
      throw new Error("Permission denied by user")
    })

    const originalAsk = Permission.ask
    Permission.ask = permissionAskMock

    try {
      await Instance.provide({
        directory: "/tmp/opencode-test-" + Date.now(),
        fn: async () => {
          const patchTool = await PatchTool.init()
          const maliciousPatch = `*** Begin Patch
*** Add File: /etc/passwd
+malicious content
*** End Patch`

          // Should throw because permission was denied
          await expect(patchTool.execute({ patchText: maliciousPatch }, ctx)).rejects.toThrow(
            "Permission denied by user",
          )

          // Verify Permission.ask was called
          expect(permissionAskMock).toHaveBeenCalled()
        },
      })
    } finally {
      // Restore original Permission.ask
      Permission.ask = originalAsk
    }
  })

  test("should allow files outside working directory when permission='allow'", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with external_directory='allow'
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "allow" as const,
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
          const patchTool = await PatchTool.init()
          const externalPath = "/tmp/opencode-external-" + Date.now() + ".txt"
          const patch = `*** Begin Patch
*** Add File: ${externalPath}
+external content
*** End Patch`

          // Should succeed without asking
          const result = await patchTool.execute({ patchText: patch }, ctx)
          expect(result.output).toContain("Patch applied successfully")

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()

          // Clean up
          await fs.unlink(externalPath).catch(() => {})
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should deny files outside working directory when permission='deny'", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with external_directory='deny'
    Agent.get = mock(async () => ({
      permission: {
        edit: "allow" as const,
        bash: { "*": "allow" as const },
        webfetch: "allow" as const,
        external_directory: "deny" as const,
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
          const patchTool = await PatchTool.init()
          const externalPath = "/tmp/opencode-external-deny-test.txt"
          const patch = `*** Begin Patch
*** Add File: ${externalPath}
+external content
*** End Patch`

          // Should throw without asking
          await expect(patchTool.execute({ patchText: patch }, ctx)).rejects.toThrow(
            "Permission denied: Cannot patch file outside working directory",
          )

          // Verify Permission.ask was NOT called
          expect(permissionAskMock).not.toHaveBeenCalled()
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should ask and allow files outside working directory when permission='ask' and user approves", async () => {
    const { Agent } = await import("../../src/agent/agent")
    const originalGet = Agent.get

    // Mock Agent.get to return agent with external_directory='ask'
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
    const permissionAskMock = mock(async (input: any) => {
      expect(input.type).toBe("external_directory")
      // Resolve without throwing to simulate user approval
    })
    Permission.ask = permissionAskMock

    try {
      await using fixture = await tmpdir()
      await Instance.provide({
        directory: fixture.path,
        fn: async () => {
          const patchTool = await PatchTool.init()
          const externalPath = "/tmp/opencode-external-ask-" + Date.now() + ".txt"
          const patch = `*** Begin Patch
*** Add File: ${externalPath}
+external content
*** End Patch`

          // Should succeed after asking
          const result = await patchTool.execute({ patchText: patch }, ctx)
          expect(result.output).toContain("Patch applied successfully")

          // Verify Permission.ask WAS called
          expect(permissionAskMock).toHaveBeenCalled()

          // Clean up
          await fs.unlink(externalPath).catch(() => {})
        },
      })
    } finally {
      Agent.get = originalGet
      Permission.ask = originalAsk
    }
  })

  test("should handle simple add file operation", async () => {
    await using fixture = await tmpdir()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `*** Begin Patch
*** Add File: test-file.txt
+Hello World
+This is a test file
*** End Patch`

        const result = await patchTool.execute({ patchText }, ctx)

        expect(result.title).toContain("files changed")
        expect(result.metadata.diff).toBeDefined()
        expect(result.output).toContain("Patch applied successfully")

        // Verify file was created
        const filePath = path.join(fixture.path, "test-file.txt")
        const content = await fs.readFile(filePath, "utf-8")
        expect(content).toBe("Hello World\nThis is a test file")
      },
    })
  })

  test("should handle file with context update", async () => {
    await using fixture = await tmpdir()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `*** Begin Patch
*** Add File: config.js
+const API_KEY = "test-key"
+const DEBUG = false
+const VERSION = "1.0"
*** End Patch`

        const result = await patchTool.execute({ patchText }, ctx)

        expect(result.title).toContain("files changed")
        expect(result.metadata.diff).toBeDefined()
        expect(result.output).toContain("Patch applied successfully")

        // Verify file was created with correct content
        const filePath = path.join(fixture.path, "config.js")
        const content = await fs.readFile(filePath, "utf-8")
        expect(content).toBe('const API_KEY = "test-key"\nconst DEBUG = false\nconst VERSION = "1.0"')
      },
    })
  })

  test("should handle multiple file operations", async () => {
    await using fixture = await tmpdir()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `*** Begin Patch
*** Add File: file1.txt
+Content of file 1
*** Add File: file2.txt
+Content of file 2
*** Add File: file3.txt
+Content of file 3
*** End Patch`

        const result = await patchTool.execute({ patchText }, ctx)

        expect(result.title).toContain("3 files changed")
        expect(result.metadata.diff).toBeDefined()
        expect(result.output).toContain("Patch applied successfully")

        // Verify all files were created
        for (let i = 1; i <= 3; i++) {
          const filePath = path.join(fixture.path, `file${i}.txt`)
          const content = await fs.readFile(filePath, "utf-8")
          expect(content).toBe(`Content of file ${i}`)
        }
      },
    })
  })

  test("should create parent directories when adding nested files", async () => {
    await using fixture = await tmpdir()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `*** Begin Patch
*** Add File: deep/nested/file.txt
+Deep nested content
*** End Patch`

        const result = await patchTool.execute({ patchText }, ctx)

        expect(result.title).toContain("files changed")
        expect(result.output).toContain("Patch applied successfully")

        // Verify nested file was created
        const nestedPath = path.join(fixture.path, "deep", "nested", "file.txt")
        const exists = await fs
          .access(nestedPath)
          .then(() => true)
          .catch(() => false)
        expect(exists).toBe(true)

        const content = await fs.readFile(nestedPath, "utf-8")
        expect(content).toBe("Deep nested content")
      },
    })
  })

  test("should generate proper unified diff in metadata", async () => {
    await using fixture = await tmpdir()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        // First create a file with simple content
        const patchText1 = `*** Begin Patch
*** Add File: test.txt
+line 1
+line 2
+line 3
*** End Patch`

        await patchTool.execute({ patchText: patchText1 }, ctx)

        // Now create an update patch
        const patchText2 = `*** Begin Patch
*** Update File: test.txt
@@
 line 1
-line 2
+line 2 updated
 line 3
*** End Patch`

        const result = await patchTool.execute({ patchText: patchText2 }, ctx)

        expect(result.metadata.diff).toBeDefined()
        expect(result.metadata.diff).toContain("@@")
        expect(result.metadata.diff).toContain("-line 2")
        expect(result.metadata.diff).toContain("+line 2 updated")
      },
    })
  })

  test("should handle complex patch with multiple operations", async () => {
    await using fixture = await tmpdir()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `*** Begin Patch
*** Add File: new.txt
+This is a new file
+with multiple lines
*** Add File: existing.txt
+old content
+new line
+more content
*** Add File: config.json
+{
+  "version": "1.0",
+  "debug": true
+}
*** End Patch`

        const result = await patchTool.execute({ patchText }, ctx)

        expect(result.title).toContain("3 files changed")
        expect(result.metadata.diff).toBeDefined()
        expect(result.output).toContain("Patch applied successfully")

        // Verify all files were created
        const newPath = path.join(fixture.path, "new.txt")
        const newContent = await fs.readFile(newPath, "utf-8")
        expect(newContent).toBe("This is a new file\nwith multiple lines")

        const existingPath = path.join(fixture.path, "existing.txt")
        const existingContent = await fs.readFile(existingPath, "utf-8")
        expect(existingContent).toBe("old content\nnew line\nmore content")

        const configPath = path.join(fixture.path, "config.json")
        const configContent = await fs.readFile(configPath, "utf-8")
        expect(configContent).toBe('{\n  "version": "1.0",\n  "debug": true\n}')
      },
    })
  })
})
