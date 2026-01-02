import { describe, expect, mock, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { FileTime } from "../../src/file/time"
import { tmpdir } from "../fixture/fixture"

const state = {
  diagnostics: {} as Record<string, Array<{ severity: number }>>,
}

mock.module("../../src/lsp", () => ({
  LSP: {
    touchFile: () => Promise.resolve(),
    diagnostics: () => Promise.resolve(state.diagnostics),
    Diagnostic: {
      pretty: () => "",
    },
  },
}))

const { EditTool } = await import("../../src/tool/edit")
const { WriteTool } = await import("../../src/tool/write")

const ctx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
  ask: async () => {},
}

describe("tool diagnostics metadata", () => {
  test("write stores only touched file diagnostics", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "a.lua")
        const normalizedFilepath = Filesystem.normalizePath(filePath)
        const otherPath = Filesystem.normalizePath(path.join(tmp.path, "b.lua"))
        state.diagnostics = {
          [normalizedFilepath]: [{ severity: 1 }, { severity: 1 }],
          [otherPath]: Array.from({ length: 250 }, () => ({ severity: 1 })),
        }

        const tool = await WriteTool.init()
        const result = await tool.execute(
          {
            filePath,
            content: "print('hi')",
          },
          ctx,
        )

        expect(Object.keys(result.metadata.diagnostics)).toEqual([normalizedFilepath])
        expect(result.metadata.diagnostics[normalizedFilepath]?.length).toBe(2)
      },
    })
  })

  test("edit stores only touched file diagnostics", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const filePath = path.join(tmp.path, "a.lua")
        await Bun.write(filePath, "hello\n")
        FileTime.read(ctx.sessionID, filePath)

        const normalizedFilepath = Filesystem.normalizePath(filePath)
        const otherPath = Filesystem.normalizePath(path.join(tmp.path, "b.lua"))
        state.diagnostics = {
          [normalizedFilepath]: [{ severity: 1 }],
          [otherPath]: Array.from({ length: 250 }, () => ({ severity: 1 })),
        }

        const tool = await EditTool.init()
        const result = await tool.execute(
          {
            filePath,
            oldString: "hello",
            newString: "world",
          },
          ctx,
        )

        expect(Object.keys(result.metadata.diagnostics)).toEqual([normalizedFilepath])
        expect(result.metadata.diagnostics[normalizedFilepath]?.length).toBe(1)
      },
    })
  })
})
