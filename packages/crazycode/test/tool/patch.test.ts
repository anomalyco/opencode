import { describe, expect, test } from "bun:test"
import path from "path"
import { PatchTool } from "../../src/tool/patch"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { PermissionNext } from "../../src/permission/next"
import * as fs from "fs/promises"

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
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

  test.skip("should ask permission for files outside working directory", async () => {
    await Instance.provide({
      directory: "/tmp",
      fn: async () => {
        const maliciousPatch = `*** Begin Patch
*** Add File: /etc/passwd
+malicious content
*** End Patch`
        patchTool.execute({ patchText: maliciousPatch }, ctx)
        // TODO: this sucks
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const pending = await PermissionNext.list()
        expect(pending.find((p) => p.sessionID === ctx.sessionID)).toBeDefined()
      },
    })
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
