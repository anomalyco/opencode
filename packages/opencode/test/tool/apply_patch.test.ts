import { describe, expect, test } from "bun:test"
import path from "path"
import * as fs from "fs/promises"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: {
    diff: string
    filepath: string
    files: Array<{
      filePath: string
      relativePath: string
      type: "add" | "update" | "delete" | "move"
      diff: string
      before: string
      after: string
      additions: number
      deletions: number
      movePath?: string
    }>
  }
}

type ToolCtx = typeof baseCtx & {
  ask: (input: AskInput) => Promise<void>
}

const execute = async (params: { patchText: string }, ctx: ToolCtx) => {
  const tool = await ApplyPatchTool.init()
  return tool.execute(params, ctx)
}

const makeCtx = () => {
  const calls: AskInput[] = []
  const ctx: ToolCtx = {
    ...baseCtx,
    ask: async (input) => {
      calls.push(input)
    },
  }

  return { ctx, calls }
}

describe("tool.apply_patch freeform", () => {
  test("requires patchText", async () => {
    const { ctx } = makeCtx()
    await expect(execute({ patchText: "" }, ctx)).rejects.toThrow("patchText is required")
  })

  test("rejects invalid patch format", async () => {
    const { ctx } = makeCtx()
    await expect(execute({ patchText: "invalid patch" }, ctx)).rejects.toThrow("apply_patch verification failed")
  })

  test("rejects empty patch", async () => {
    const { ctx } = makeCtx()
    const emptyPatch = "*** Begin Patch\n*** End Patch"
    await expect(execute({ patchText: emptyPatch }, ctx)).rejects.toThrow("patch rejected: empty patch")
  })

  test("applies add/update/delete in one patch", async () => {
    await using fixture = await tmpdir({ git: true })
    const { ctx, calls } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const modifyPath = path.join(fixture.path, "modify.txt")
        const deletePath = path.join(fixture.path, "delete.txt")
        await fs.writeFile(modifyPath, "line1\nline2\n", "utf-8")
        await fs.writeFile(deletePath, "obsolete\n", "utf-8")

        const patchText =
          "*** Begin Patch\n*** Add File: nested/new.txt\n+created\n*** Delete File: delete.txt\n*** Update File: modify.txt\n@@\n-line2\n+changed\n*** End Patch"

        const result = await execute({ patchText }, ctx)

        expect(result.title).toContain("Success. Updated the following files")
        expect(result.output).toContain("Success. Updated the following files")
        expect(result.metadata.diff).toContain("Index:")
        expect(calls.length).toBe(1)

        // Verify permission metadata includes files array for UI rendering
        const permissionCall = calls[0]
        expect(permissionCall.metadata.files).toHaveLength(3)
        expect(permissionCall.metadata.files.map((f) => f.type).sort()).toEqual(["add", "delete", "update"])

        const addFile = permissionCall.metadata.files.find((f) => f.type === "add")
        expect(addFile).toBeDefined()
        expect(addFile!.relativePath).toBe("nested/new.txt")
        expect(addFile!.after).toBe("created\n")

        const updateFile = permissionCall.metadata.files.find((f) => f.type === "update")
        expect(updateFile).toBeDefined()
        expect(updateFile!.before).toContain("line2")
        expect(updateFile!.after).toContain("changed")

        const added = await fs.readFile(path.join(fixture.path, "nested", "new.txt"), "utf-8")
        expect(added).toBe("created\n")
        expect(await fs.readFile(modifyPath, "utf-8")).toBe("line1\nchanged\n")
        await expect(fs.readFile(deletePath, "utf-8")).rejects.toThrow()
      },
    })
  })

  test("permission metadata includes move file info", async () => {
    await using fixture = await tmpdir({ git: true })
    const { ctx, calls } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const original = path.join(fixture.path, "old", "name.txt")
        await fs.mkdir(path.dirname(original), { recursive: true })
        await fs.writeFile(original, "old content\n", "utf-8")

        const patchText =
          "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-old content\n+new content\n*** End Patch"

        await execute({ patchText }, ctx)

        expect(calls.length).toBe(1)
        const permissionCall = calls[0]
        expect(permissionCall.metadata.files).toHaveLength(1)

        const moveFile = permissionCall.metadata.files[0]
        expect(moveFile.type).toBe("move")
        expect(moveFile.relativePath).toBe("renamed/dir/name.txt")
        expect(moveFile.movePath).toBe(path.join(fixture.path, "renamed/dir/name.txt"))
        expect(moveFile.before).toBe("old content\n")
        expect(moveFile.after).toBe("new content\n")
      },
    })
  })

  test("applies multiple hunks to one file", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "multi.txt")
        await fs.writeFile(target, "line1\nline2\nline3\nline4\n", "utf-8")

        const patchText =
          "*** Begin Patch\n*** Update File: multi.txt\n@@\n-line2\n+changed2\n@@\n-line4\n+changed4\n*** End Patch"

        await execute({ patchText }, ctx)

        expect(await fs.readFile(target, "utf-8")).toBe("line1\nchanged2\nline3\nchanged4\n")
      },
    })
  })

  test("inserts lines with insert-only hunk", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "insert_only.txt")
        await fs.writeFile(target, "alpha\nomega\n", "utf-8")

        const patchText = "*** Begin Patch\n*** Update File: insert_only.txt\n@@\n alpha\n+beta\n omega\n*** End Patch"

        await execute({ patchText }, ctx)

        expect(await fs.readFile(target, "utf-8")).toBe("alpha\nbeta\nomega\n")
      },
    })
  })

  test("appends trailing newline on update", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "no_newline.txt")
        await fs.writeFile(target, "no newline at end", "utf-8")

        const patchText =
          "*** Begin Patch\n*** Update File: no_newline.txt\n@@\n-no newline at end\n+first line\n+second line\n*** End Patch"

        await execute({ patchText }, ctx)

        const contents = await fs.readFile(target, "utf-8")
        expect(contents.endsWith("\n")).toBe(true)
        expect(contents).toBe("first line\nsecond line\n")
      },
    })
  })

  test("moves file to a new directory", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const original = path.join(fixture.path, "old", "name.txt")
        await fs.mkdir(path.dirname(original), { recursive: true })
        await fs.writeFile(original, "old content\n", "utf-8")

        const patchText =
          "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-old content\n+new content\n*** End Patch"

        await execute({ patchText }, ctx)

        const moved = path.join(fixture.path, "renamed", "dir", "name.txt")
        await expect(fs.readFile(original, "utf-8")).rejects.toThrow()
        expect(await fs.readFile(moved, "utf-8")).toBe("new content\n")
      },
    })
  })

  test("moves file overwriting existing destination", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const original = path.join(fixture.path, "old", "name.txt")
        const destination = path.join(fixture.path, "renamed", "dir", "name.txt")
        await fs.mkdir(path.dirname(original), { recursive: true })
        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.writeFile(original, "from\n", "utf-8")
        await fs.writeFile(destination, "existing\n", "utf-8")

        const patchText =
          "*** Begin Patch\n*** Update File: old/name.txt\n*** Move to: renamed/dir/name.txt\n@@\n-from\n+new\n*** End Patch"

        await execute({ patchText }, ctx)

        await expect(fs.readFile(original, "utf-8")).rejects.toThrow()
        expect(await fs.readFile(destination, "utf-8")).toBe("new\n")
      },
    })
  })

  test("adds file overwriting existing file", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "duplicate.txt")
        await fs.writeFile(target, "old content\n", "utf-8")

        const patchText = "*** Begin Patch\n*** Add File: duplicate.txt\n+new content\n*** End Patch"

        await execute({ patchText }, ctx)
        expect(await fs.readFile(target, "utf-8")).toBe("new content\n")
      },
    })
  })

  test("rejects update when target file is missing", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = "*** Begin Patch\n*** Update File: missing.txt\n@@\n-nope\n+better\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow(
          "apply_patch verification failed: Failed to read file to update",
        )
      },
    })
  })

  test("rejects delete when file is missing", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = "*** Begin Patch\n*** Delete File: missing.txt\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow()
      },
    })
  })

  test("rejects delete when target is a directory", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const dirPath = path.join(fixture.path, "dir")
        await fs.mkdir(dirPath)

        const patchText = "*** Begin Patch\n*** Delete File: dir\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow()
      },
    })
  })

  test("rejects invalid hunk header", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = "*** Begin Patch\n*** Frobnicate File: foo\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow("apply_patch verification failed")
      },
    })
  })

  test("rejects update with missing context", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "modify.txt")
        await fs.writeFile(target, "line1\nline2\n", "utf-8")

        const patchText = "*** Begin Patch\n*** Update File: modify.txt\n@@\n-missing\n+changed\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow("apply_patch verification failed")
        expect(await fs.readFile(target, "utf-8")).toBe("line1\nline2\n")
      },
    })
  })

  test("verification failure leaves no side effects", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText =
          "*** Begin Patch\n*** Add File: created.txt\n+hello\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow()

        const createdPath = path.join(fixture.path, "created.txt")
        await expect(fs.readFile(createdPath, "utf-8")).rejects.toThrow()
      },
    })
  })

  test("supports end of file anchor", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "tail.txt")
        await fs.writeFile(target, "alpha\nlast\n", "utf-8")

        const patchText = "*** Begin Patch\n*** Update File: tail.txt\n@@\n-last\n+end\n*** End of File\n*** End Patch"

        await execute({ patchText }, ctx)
        expect(await fs.readFile(target, "utf-8")).toBe("alpha\nend\n")
      },
    })
  })

  test("rejects missing second chunk context", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "two_chunks.txt")
        await fs.writeFile(target, "a\nb\nc\nd\n", "utf-8")

        const patchText = "*** Begin Patch\n*** Update File: two_chunks.txt\n@@\n-b\n+B\n\n-d\n+D\n*** End Patch"

        await expect(execute({ patchText }, ctx)).rejects.toThrow()
        expect(await fs.readFile(target, "utf-8")).toBe("a\nb\nc\nd\n")
      },
    })
  })

  test("disambiguates change context with @@ header", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "multi_ctx.txt")
        await fs.writeFile(target, "fn a\nx=10\ny=2\nfn b\nx=10\ny=20\n", "utf-8")

        const patchText = "*** Begin Patch\n*** Update File: multi_ctx.txt\n@@ fn b\n-x=10\n+x=11\n*** End Patch"

        await execute({ patchText }, ctx)
        expect(await fs.readFile(target, "utf-8")).toBe("fn a\nx=10\ny=2\nfn b\nx=11\ny=20\n")
      },
    })
  })

  test("EOF anchor matches from end of file first", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "eof_anchor.txt")
        // File has duplicate "marker" lines - one in middle, one at end
        await fs.writeFile(target, "start\nmarker\nmiddle\nmarker\nend\n", "utf-8")

        // With EOF anchor, should match the LAST "marker" line, not the first
        const patchText =
          "*** Begin Patch\n*** Update File: eof_anchor.txt\n@@\n-marker\n-end\n+marker-changed\n+end\n*** End of File\n*** End Patch"

        await execute({ patchText }, ctx)
        // First marker unchanged, second marker changed
        expect(await fs.readFile(target, "utf-8")).toBe("start\nmarker\nmiddle\nmarker-changed\nend\n")
      },
    })
  })

  test("parses heredoc-wrapped patch", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `cat <<'EOF'
*** Begin Patch
*** Add File: heredoc_test.txt
+heredoc content
*** End Patch
EOF`

        await execute({ patchText }, ctx)
        const content = await fs.readFile(path.join(fixture.path, "heredoc_test.txt"), "utf-8")
        expect(content).toBe("heredoc content\n")
      },
    })
  })

  test("parses heredoc-wrapped patch without cat", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const patchText = `<<EOF
*** Begin Patch
*** Add File: heredoc_no_cat.txt
+no cat prefix
*** End Patch
EOF`

        await execute({ patchText }, ctx)
        const content = await fs.readFile(path.join(fixture.path, "heredoc_no_cat.txt"), "utf-8")
        expect(content).toBe("no cat prefix\n")
      },
    })
  })

  test("matches with trailing whitespace differences", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "trailing_ws.txt")
        // File has trailing spaces on some lines
        await fs.writeFile(target, "line1  \nline2\nline3   \n", "utf-8")

        // Patch doesn't have trailing spaces - should still match via rstrip pass
        const patchText = "*** Begin Patch\n*** Update File: trailing_ws.txt\n@@\n-line2\n+changed\n*** End Patch"

        await execute({ patchText }, ctx)
        expect(await fs.readFile(target, "utf-8")).toBe("line1  \nchanged\nline3   \n")
      },
    })
  })

  test("matches with leading whitespace differences", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "leading_ws.txt")
        // File has leading spaces
        await fs.writeFile(target, "  line1\nline2\n  line3\n", "utf-8")

        // Patch without leading spaces - should match via trim pass
        const patchText = "*** Begin Patch\n*** Update File: leading_ws.txt\n@@\n-line2\n+changed\n*** End Patch"

        await execute({ patchText }, ctx)
        expect(await fs.readFile(target, "utf-8")).toBe("  line1\nchanged\n  line3\n")
      },
    })
  })

  test("matches with Unicode punctuation differences", async () => {
    await using fixture = await tmpdir()
    const { ctx } = makeCtx()

    await Instance.provide({
      directory: fixture.path,
      fn: async () => {
        const target = path.join(fixture.path, "unicode.txt")
        // File has fancy Unicode quotes (U+201C, U+201D) and em-dash (U+2014)
        const leftQuote = "\u201C"
        const rightQuote = "\u201D"
        const emDash = "\u2014"
        await fs.writeFile(target, `He said ${leftQuote}hello${rightQuote}\nsome${emDash}dash\nend\n`, "utf-8")

        // Patch uses ASCII equivalents - should match via normalized pass
        // The replacement uses ASCII quotes from the patch (not preserving Unicode)
        const patchText =
          '*** Begin Patch\n*** Update File: unicode.txt\n@@\n-He said "hello"\n+He said "hi"\n*** End Patch'

        await execute({ patchText }, ctx)
        // Result has ASCII quotes because that's what the patch specifies
        expect(await fs.readFile(target, "utf-8")).toBe(`He said "hi"\nsome${emDash}dash\nend\n`)
      },
    })
  })
})
