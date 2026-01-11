import { describe, expect, test, afterEach } from "bun:test"
import { Editor } from "../../src/cli/cmd/tui/util/editor"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { rm, writeFile } from "node:fs/promises"

describe("util.editor", () => {
  const originalVisual = process.env["VISUAL"]
  const originalEditor = process.env["EDITOR"]

  afterEach(async () => {
    if (originalVisual !== undefined) {
      process.env["VISUAL"] = originalVisual
    } else {
      delete process.env["VISUAL"]
    }
    if (originalEditor !== undefined) {
      process.env["EDITOR"] = originalEditor
    } else {
      delete process.env["EDITOR"]
    }
  })

  test("should return undefined when no editor is set", async () => {
    delete process.env["VISUAL"]
    delete process.env["EDITOR"]

    const mockRenderer = createMockRenderer()
    const result = await Editor.open({ value: "test", renderer: mockRenderer })
    expect(result).toBeUndefined()
  })

  test("should handle simple editor command", async () => {
    if (process.platform === "win32") {
      return
    }

    const testScript = join(tmpdir(), `test-editor-${Date.now()}.sh`)
    await writeFile(testScript, `#!/bin/sh\necho "MODIFIED: $(cat "$1")" > "$1"\n`, { mode: 0o755 })

    try {
      process.env["VISUAL"] = testScript

      const mockRenderer = createMockRenderer()
      const result = await Editor.open({
        value: "original content",
        renderer: mockRenderer,
      })

      expect(result).toContain("MODIFIED:")
      expect(result).toContain("original content")
    } finally {
      await rm(testScript, { force: true })
    }
  })

  test("should handle editor with quoted arguments", async () => {
    if (process.platform === "win32") {
      return
    }

    const testScript = join(tmpdir(), `test-editor-quote-${Date.now()}.sh`)
    await writeFile(
      testScript,
      `#!/bin/sh
echo "ARG_COUNT: $#" > "$3"
echo "ARG1: $1" >> "$3"
echo "ARG2: $2" >> "$3"
echo "FILE: $3" >> "$3"
`,
      { mode: 0o755 },
    )

    try {
      process.env["VISUAL"] = `${testScript} --flag 'quoted arg'`

      const mockRenderer = createMockRenderer()
      const result = await Editor.open({
        value: "test",
        renderer: mockRenderer,
      })

      expect(result).toContain("ARG_COUNT: 3")
      expect(result).toContain("ARG1: --flag")
      expect(result).toContain("ARG2: quoted arg")
    } finally {
      await rm(testScript, { force: true })
    }
  })

  test("should handle filepath with special characters", async () => {
    if (process.platform === "win32") {
      return
    }

    const testScript = join(tmpdir(), `test-editor-${Date.now()}.sh`)
    await writeFile(testScript, `#!/bin/sh\necho "SUCCESS" > "$1"\n`, { mode: 0o755 })

    try {
      process.env["VISUAL"] = testScript

      const mockRenderer = createMockRenderer()
      const result = await Editor.open({
        value: "test",
        renderer: mockRenderer,
      })

      expect(result).toContain("SUCCESS")
    } finally {
      await rm(testScript, { force: true })
    }
  })

  test("should prefer VISUAL over EDITOR", async () => {
    if (process.platform === "win32") {
      return
    }

    const visualScript = join(tmpdir(), `test-visual-${Date.now()}.sh`)
    const editorScript = join(tmpdir(), `test-editor-${Date.now()}.sh`)

    await writeFile(visualScript, `#!/bin/sh\necho "VISUAL" > "$1"\n`, { mode: 0o755 })
    await writeFile(editorScript, `#!/bin/sh\necho "EDITOR" > "$1"\n`, { mode: 0o755 })

    try {
      process.env["VISUAL"] = visualScript
      process.env["EDITOR"] = editorScript

      const mockRenderer = createMockRenderer()
      const result = await Editor.open({ value: "test", renderer: mockRenderer })

      expect(result).toBe("VISUAL\n")
    } finally {
      await rm(visualScript, { force: true })
      await rm(editorScript, { force: true })
    }
  })

  test("should validate Windows filepath safety", async () => {
    if (process.platform !== "win32") {
      return
    }

    process.env["VISUAL"] = "notepad"

    const mockRenderer = createMockRenderer()

    const result = await Editor.open({ value: "test", renderer: mockRenderer })
    expect(result).toBeDefined()
  })
})

function createMockRenderer() {
  return {
    suspend: () => {},
    resume: () => {},
    requestRender: () => {},
    currentRenderBuffer: { clear: () => {} },
  } as any
}
