import { describe, test, expect } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { FileTime } from "../../src/file/time"
import { hashlineLine, hashlineRef } from "../../src/tool/hashline"

const ctx = {
  sessionID: "test-edit-session",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.edit", () => {
  test("rejects legacy payloads", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "a\nb\nc", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: filepath,
              oldString: "b",
              newString: "B",
            } as any,
            ctx,
          ),
        ).rejects.toThrow("Legacy edit payload has been removed")
      },
    })
  })

  test("replaces a single line", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "a\nb\nc", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        const edit = await EditTool.init()
        const result = await edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "set_line",
                line: hashlineRef(2, "b"),
                text: "B",
              },
            ],
          },
          ctx,
        )

        expect(await fs.readFile(filepath, "utf-8")).toBe("a\nB\nc")
        expect(result.metadata.edit_mode).toBe("hashline")
      },
    })
  })

  test("supports replace operations with all=true", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "foo bar foo baz foo", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        const edit = await EditTool.init()
        await edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "replace",
                old_text: "foo",
                new_text: "qux",
                all: true,
              },
            ],
          },
          ctx,
        )

        expect(await fs.readFile(filepath, "utf-8")).toBe("qux bar qux baz qux")
      },
    })
  })

  test("supports range replacement and insert modes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "a\nb\nc\nd", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        const edit = await EditTool.init()
        await edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "replace_lines",
                start_line: hashlineRef(2, "b"),
                end_line: hashlineRef(3, "c"),
                text: ["B", "C"],
              },
              {
                type: "insert_before",
                line: hashlineRef(2, "b"),
                text: "x",
              },
              {
                type: "insert_after",
                line: hashlineRef(3, "c"),
                text: "y",
              },
            ],
          },
          ctx,
        )

        expect(await fs.readFile(filepath, "utf-8")).toBe("a\nx\nB\nC\ny\nd")
      },
    })
  })

  test("creates missing files from append and prepend operations", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "created.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        await edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "prepend",
                text: "start",
              },
              {
                type: "append",
                text: "end",
              },
            ],
          },
          ctx,
        )

        expect(await fs.readFile(filepath, "utf-8")).toBe("start\nend")
      },
    })
  })

  test("requires a prior read for existing files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "content", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: filepath,
              edits: [
                {
                  type: "set_line",
                  line: hashlineRef(1, "content"),
                  text: "changed",
                },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow("You must read file")
      },
    })
  })

  test("rejects files modified since read", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "original", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        await new Promise((resolve) => setTimeout(resolve, 100))
        await fs.writeFile(filepath, "external", "utf-8")

        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: filepath,
              edits: [
                {
                  type: "set_line",
                  line: hashlineRef(1, "original"),
                  text: "changed",
                },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow("modified since it was last read")
      },
    })
  })

  test("rejects missing files for non-append and non-prepend edits", async () => {
    await using tmp = await tmpdir()
    const filepath = path.join(tmp.path, "missing.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: filepath,
              edits: [
                {
                  type: "replace",
                  old_text: "a",
                  new_text: "b",
                },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow("Missing file can only be created")
      },
    })
  })

  test("rejects directories", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.mkdir(path.join(dir, "adir"))
      },
    })
    const filepath = path.join(tmp.path, "adir")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()
        await expect(
          edit.execute(
            {
              filePath: filepath,
              edits: [
                {
                  type: "append",
                  text: "x",
                },
              ],
            },
            ctx,
          ),
        ).rejects.toThrow("directory")
      },
    })
  })

  test("tracks file diff statistics", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "line1\nline2\nline3", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        const edit = await EditTool.init()
        const result = await edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "replace_lines",
                start_line: hashlineRef(2, "line2"),
                end_line: hashlineRef(2, "line2"),
                text: ["new line a", "new line b"],
              },
            ],
          },
          ctx,
        )

        expect(result.metadata.filediff).toBeDefined()
        expect(result.metadata.filediff.file).toBe(filepath)
        expect(result.metadata.filediff.additions).toBeGreaterThan(0)
      },
    })
  })

  test("emits change events for existing files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "a\nb", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)

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
            edits: [
              {
                type: "set_line",
                line: hashlineRef(2, "b"),
                text: "B",
              },
            ],
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

  test("applies hashline autocorrect prefixes through config", async () => {
    await using tmp = await tmpdir({
      config: {
        experimental: {
          hashline_autocorrect: true,
        },
      },
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "a\nb\nc", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        const edit = await EditTool.init()
        await edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "set_line",
                line: hashlineRef(2, "b"),
                text: hashlineLine(2, "B"),
              },
            ],
          },
          ctx,
        )

        expect(await fs.readFile(filepath, "utf-8")).toBe("a\nB\nc")
      },
    })
  })

  test("supports delete and rename flows", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "src.txt"), "a\nb", "utf-8")
        await fs.writeFile(path.join(dir, "delete.txt"), "delete me", "utf-8")
      },
    })
    const source = path.join(tmp.path, "src.txt")
    const target = path.join(tmp.path, "renamed.txt")
    const doomed = path.join(tmp.path, "delete.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const edit = await EditTool.init()

        FileTime.read(ctx.sessionID, source)
        await edit.execute(
          {
            filePath: source,
            rename: target,
            edits: [
              {
                type: "set_line",
                line: hashlineRef(2, "b"),
                text: "B",
              },
            ],
          },
          ctx,
        )

        expect(await fs.readFile(target, "utf-8")).toBe("a\nB")
        await expect(fs.stat(source)).rejects.toThrow()

        FileTime.read(ctx.sessionID, doomed)
        await edit.execute(
          {
            filePath: doomed,
            delete: true,
            edits: [],
          },
          ctx,
        )

        await expect(fs.stat(doomed)).rejects.toThrow()
      },
    })
  })

  test("serializes concurrent edits to the same file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await fs.writeFile(path.join(dir, "file.txt"), "0", "utf-8")
      },
    })
    const filepath = path.join(tmp.path, "file.txt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        FileTime.read(ctx.sessionID, filepath)
        const edit = await EditTool.init()

        const first = edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "set_line",
                line: hashlineRef(1, "0"),
                text: "1",
              },
            ],
          },
          ctx,
        )

        FileTime.read(ctx.sessionID, filepath)
        const second = edit.execute(
          {
            filePath: filepath,
            edits: [
              {
                type: "set_line",
                line: hashlineRef(1, "0"),
                text: "2",
              },
            ],
          },
          ctx,
        )

        const results = await Promise.allSettled([first, second])
        expect(results.some((result) => result.status === "fulfilled")).toBe(true)
      },
    })
  })
})
