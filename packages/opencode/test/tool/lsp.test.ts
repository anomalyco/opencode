import { afterEach, describe, expect, spyOn, test } from "bun:test"
import path from "path"
import { LspTool } from "../../src/tool/lsp"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Filesystem } from "../../src/util/filesystem"
import { LSP } from "../../src/lsp"
import { MessageID, SessionID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const spies: Array<{ mockRestore(): void }> = []

afterEach(() => {
  while (spies.length > 0) spies.pop()?.mockRestore()
})

describe("tool.lsp", () => {
  test("allows diagnostics without line and character", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.ts"), "const x = 1\n")
      },
    })

    const filepath = path.join(tmp.path, "file.ts")
    const normalized = Filesystem.normalizePath(filepath)
    spies.push(spyOn(LSP, "hasClients").mockResolvedValue(true))
    spies.push(spyOn(LSP, "touchFile").mockResolvedValue())
    spies.push(
      spyOn(LSP, "diagnostics").mockResolvedValue({
        [normalized]: [
          {
            severity: 2,
            message: '"x" is declared but its value is never read',
            range: {
              start: { line: 0, character: 6 },
              end: { line: 0, character: 7 },
            },
            source: "language-server",
          },
        ],
      }),
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lsp = await LspTool.init()
        const result = await lsp.execute({ operation: "diagnostics", filePath: filepath }, ctx)
        expect(result.output).toContain("declared but its value is never read")
      },
    })
  })

  test("requires line and character for position-based operations", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.ts"), "const x = 1\n")
      },
    })

    const filepath = path.join(tmp.path, "file.ts")
    const hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
    spies.push(hasClientsSpy)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lsp = await LspTool.init()
        await expect(lsp.execute({ operation: "hover", filePath: filepath }, ctx)).rejects.toThrow(
          "line is required for hover",
        )
        expect(hasClientsSpy).not.toHaveBeenCalled()
      },
    })
  })

  test("rejects line and character for diagnostics", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "file.ts"), "const x = 1\n")
      },
    })

    const filepath = path.join(tmp.path, "file.ts")
    const hasClientsSpy = spyOn(LSP, "hasClients").mockResolvedValue(true)
    spies.push(hasClientsSpy)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const lsp = await LspTool.init()
        await expect(
          lsp.execute({ operation: "diagnostics", filePath: filepath, line: 1, character: 1 }, ctx),
        ).rejects.toThrow("line is not used for diagnostics")
        expect(hasClientsSpy).not.toHaveBeenCalled()
      },
    })
  })
})
