import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FileTime } from "../../src/file/time"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-edit-session"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

async function touch(file: string, time: number) {
  const date = new Date(time)
  await fs.utimes(file, date, date)
}

describe("tool.edit", () => {
  describe("creating new files", () => {
    test("creates new file when oldString is empty", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "newfile.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: filepath,
              oldString: "",
              newString: "new content",
            },
            ctx,
          )

          expect(result.metadata.diff).toContain("new content")

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("new content")
        },
      })
    })

    test("creates new file with nested directories", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "nested", "dir", "file.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "",
              newString: "nested file",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("nested file")
        },
      })
    })

    test("emits add event for new files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "new.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const { Bus } = await import("../../src/bus")
          const { File } = await import("../../src/file")
          const { FileWatcher } = await import("../../src/file/watcher")

          const events: string[] = []
          const unsubEdited = Bus.subscribe(File.Event.Edited, () => events.push("edited"))
          const unsubUpdated = Bus.subscribe(FileWatcher.Event.Updated, () => events.push("updated"))

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "",
              newString: "content",
            },
            ctx,
          )

          expect(events).toContain("edited")
          expect(events).toContain("updated")
          unsubEdited()
          unsubUpdated()
        },
      })
    })
  })

  describe("editing existing files", () => {
    test("replaces text in existing file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "existing.txt")
      await fs.writeFile(filepath, "old content here", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: filepath,
              oldString: "old content",
              newString: "new content",
            },
            ctx,
          )

          expect(result.output).toContain("Edit applied successfully")

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("new content here")
        },
      })
    })

    test("throws error when file does not exist", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "nonexistent.txt")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "old",
                newString: "new",
              },
              ctx,
            ),
          ).rejects.toThrow("not found")
        },
      })
    })

    test("throws error when oldString equals newString", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "same",
                newString: "same",
              },
              ctx,
            ),
          ).rejects.toThrow("identical")
        },
      })
    })

    test("throws error when oldString not found in file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "actual content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "not in file",
                newString: "replacement",
              },
              ctx,
            ),
          ).rejects.toThrow()
        },
      })
    })

    test("throws error when file was not read first (FileTime)", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "content",
                newString: "modified",
              },
              ctx,
            ),
          ).rejects.toThrow("You must read file")
        },
      })
    })

    test("throws error when file has been modified since read", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original content", "utf-8")
      await touch(filepath, 1_000)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          // Read first
          await FileTime.read(ctx.sessionID, filepath)

          // Simulate external modification
          await fs.writeFile(filepath, "modified externally", "utf-8")
          await touch(filepath, 2_000)

          // Try to edit with the new content
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "modified externally",
                newString: "edited",
              },
              ctx,
            ),
          ).rejects.toThrow("modified since it was last read")
        },
      })
    })

    test("replaces all occurrences with replaceAll option", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "foo bar foo baz foo", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "foo",
              newString: "qux",
              replaceAll: true,
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("qux bar qux baz qux")
        },
      })
    })

    test("emits change event for existing files", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "original", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const { Bus } = await import("../../src/bus")
          const { File } = await import("../../src/file")
          const { FileWatcher } = await import("../../src/file/watcher")

          const events: string[] = []
          const unsubEdited = Bus.subscribe(File.Event.Edited, () => events.push("edited"))
          const unsubUpdated = Bus.subscribe(FileWatcher.Event.Updated, () => events.push("updated"))

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "original",
              newString: "modified",
            },
            ctx,
          )

          expect(events).toContain("edited")
          expect(events).toContain("updated")
          unsubEdited()
          unsubUpdated()
        },
      })
    })
  })

  describe("edge cases", () => {
    test("handles multiline replacements", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "line2",
              newString: "new line 2\nextra line",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("line1\nnew line 2\nextra line\nline3")
        },
      })
    })

    test("handles CRLF line endings", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\r\nold\r\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          await edit.execute(
            {
              filePath: filepath,
              oldString: "old",
              newString: "new",
            },
            ctx,
          )

          const content = await fs.readFile(filepath, "utf-8")
          expect(content).toBe("line1\r\nnew\r\nline3")
        },
      })
    })

    test("throws error when oldString equals newString", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "content", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: filepath,
                oldString: "",
                newString: "",
              },
              ctx,
            ),
          ).rejects.toThrow("identical")
        },
      })
    })

    test("throws error when path is directory", async () => {
      await using tmp = await tmpdir()
      const dirpath = path.join(tmp.path, "adir")
      await fs.mkdir(dirpath)

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, dirpath)

          const edit = await EditTool.init()
          await expect(
            edit.execute(
              {
                filePath: dirpath,
                oldString: "old",
                newString: "new",
              },
              ctx,
            ),
          ).rejects.toThrow("directory")
        },
      })
    })

    test("tracks file diff statistics", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "line1\nline2\nline3", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()
          const result = await edit.execute(
            {
              filePath: filepath,
              oldString: "line2",
              newString: "new line a\nnew line b",
            },
            ctx,
          )

          expect(result.metadata.filediff).toBeDefined()
          expect(result.metadata.filediff.file).toBe(filepath)
          expect(result.metadata.filediff.additions).toBeGreaterThan(0)
        },
      })
    })
  })

  describe("line endings", () => {
    const old = "alpha\nbeta\ngamma"
    const next = "alpha\nbeta-updated\ngamma"
    const alt = "alpha\nbeta\nomega"

    const normalize = (text: string, ending: "\n" | "\r\n") => {
      const normalized = text.replaceAll("\r\n", "\n")
      if (ending === "\n") return normalized
      return normalized.replaceAll("\n", "\r\n")
    }

    const count = (content: string) => {
      const crlf = content.match(/\r\n/g)?.length ?? 0
      const lf = content.match(/\n/g)?.length ?? 0
      return {
        crlf,
        lf: lf - crlf,
      }
    }

    const expectLf = (content: string) => {
      const counts = count(content)
      expect(counts.crlf).toBe(0)
      expect(counts.lf).toBeGreaterThan(0)
    }

    const expectCrlf = (content: string) => {
      const counts = count(content)
      expect(counts.lf).toBe(0)
      expect(counts.crlf).toBeGreaterThan(0)
    }

    type Input = {
      content: string
      oldString: string
      newString: string
      replaceAll?: boolean
    }

    const apply = async (input: Input) => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "test.txt"), input.content)
        },
      })

      return await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const edit = await EditTool.init()
          const filePath = path.join(tmp.path, "test.txt")
          await FileTime.read(ctx.sessionID, filePath)
          await edit.execute(
            {
              filePath,
              oldString: input.oldString,
              newString: input.newString,
              replaceAll: input.replaceAll,
            },
            ctx,
          )
          return await Bun.file(filePath).text()
        },
      })
    }

    test("preserves LF with LF multi-line strings", async () => {
      const content = normalize(old + "\n", "\n")
      const output = await apply({
        content,
        oldString: normalize(old, "\n"),
        newString: normalize(next, "\n"),
      })
      expect(output).toBe(normalize(next + "\n", "\n"))
      expectLf(output)
    })

    test("preserves CRLF with CRLF multi-line strings", async () => {
      const content = normalize(old + "\n", "\r\n")
      const output = await apply({
        content,
        oldString: normalize(old, "\r\n"),
        newString: normalize(next, "\r\n"),
      })
      expect(output).toBe(normalize(next + "\n", "\r\n"))
      expectCrlf(output)
    })

    test("preserves LF when old/new use CRLF", async () => {
      const content = normalize(old + "\n", "\n")
      const output = await apply({
        content,
        oldString: normalize(old, "\r\n"),
        newString: normalize(next, "\r\n"),
      })
      expect(output).toBe(normalize(next + "\n", "\n"))
      expectLf(output)
    })

    test("preserves CRLF when old/new use LF", async () => {
      const content = normalize(old + "\n", "\r\n")
      const output = await apply({
        content,
        oldString: normalize(old, "\n"),
        newString: normalize(next, "\n"),
      })
      expect(output).toBe(normalize(next + "\n", "\r\n"))
      expectCrlf(output)
    })

    test("preserves LF when newString uses CRLF", async () => {
      const content = normalize(old + "\n", "\n")
      const output = await apply({
        content,
        oldString: normalize(old, "\n"),
        newString: normalize(next, "\r\n"),
      })
      expect(output).toBe(normalize(next + "\n", "\n"))
      expectLf(output)
    })

    test("preserves CRLF when newString uses LF", async () => {
      const content = normalize(old + "\n", "\r\n")
      const output = await apply({
        content,
        oldString: normalize(old, "\r\n"),
        newString: normalize(next, "\n"),
      })
      expect(output).toBe(normalize(next + "\n", "\r\n"))
      expectCrlf(output)
    })

    test("preserves LF with mixed old/new line endings", async () => {
      const content = normalize(old + "\n", "\n")
      const output = await apply({
        content,
        oldString: "alpha\nbeta\r\ngamma",
        newString: "alpha\r\nbeta\nomega",
      })
      expect(output).toBe(normalize(alt + "\n", "\n"))
      expectLf(output)
    })

    test("preserves CRLF with mixed old/new line endings", async () => {
      const content = normalize(old + "\n", "\r\n")
      const output = await apply({
        content,
        oldString: "alpha\r\nbeta\ngamma",
        newString: "alpha\nbeta\r\nomega",
      })
      expect(output).toBe(normalize(alt + "\n", "\r\n"))
      expectCrlf(output)
    })

    test("replaceAll preserves LF for multi-line blocks", async () => {
      const blockOld = "alpha\nbeta"
      const blockNew = "alpha\nbeta-updated"
      const content = normalize(blockOld + "\n" + blockOld + "\n", "\n")
      const output = await apply({
        content,
        oldString: normalize(blockOld, "\n"),
        newString: normalize(blockNew, "\n"),
        replaceAll: true,
      })
      expect(output).toBe(normalize(blockNew + "\n" + blockNew + "\n", "\n"))
      expectLf(output)
    })

    test("replaceAll preserves CRLF for multi-line blocks", async () => {
      const blockOld = "alpha\nbeta"
      const blockNew = "alpha\nbeta-updated"
      const content = normalize(blockOld + "\n" + blockOld + "\n", "\r\n")
      const output = await apply({
        content,
        oldString: normalize(blockOld, "\r\n"),
        newString: normalize(blockNew, "\r\n"),
        replaceAll: true,
      })
      expect(output).toBe(normalize(blockNew + "\n" + blockNew + "\n", "\r\n"))
      expectCrlf(output)
    })
  })

  describe("concurrent editing", () => {
    test("serializes concurrent edits to same file", async () => {
      await using tmp = await tmpdir()
      const filepath = path.join(tmp.path, "file.txt")
      await fs.writeFile(filepath, "0", "utf-8")

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await FileTime.read(ctx.sessionID, filepath)

          const edit = await EditTool.init()

          // Two concurrent edits
          const promise1 = edit.execute(
            {
              filePath: filepath,
              oldString: "0",
              newString: "1",
            },
            ctx,
          )

          // Need to read again since FileTime tracks per-session
          await FileTime.read(ctx.sessionID, filepath)

          const promise2 = edit.execute(
            {
              filePath: filepath,
              oldString: "0",
              newString: "2",
            },
            ctx,
          )

          // Both should complete without error (though one might fail due to content mismatch)
          const results = await Promise.allSettled([promise1, promise2])
          expect(results.some((r) => r.status === "fulfilled")).toBe(true)
        },
      })
    })
  })
})
