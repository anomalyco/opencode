import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { AstGrepTool } from "../../src/tool/ast_grep"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_test-ast-grep"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("tool.ast_grep", () => {
  test("finds structural matches in a directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `console.log(foo)\nlogger.info(foo)\n`)
        await Bun.write(path.join(dir, "b.ts"), `if (ok) console.log(bar)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstGrepTool.init()
        const result = await tool.execute(
          {
            pattern: "console.log($A)",
            lang: "typescript",
            path: tmp.path,
          },
          ctx,
        )

        expect(result.metadata.matches).toBe(2)
        expect(result.metadata.files).toBe(2)
        expect(result.output).toContain("Line 1: console.log(foo)")
        expect(result.output).toContain("Line 1: console.log(bar)")
      },
    })
  })

  test("returns no files found when there are no matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `logger.info(foo)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstGrepTool.init()
        const result = await tool.execute(
          {
            pattern: "console.log($A)",
            lang: "typescript",
            path: tmp.path,
          },
          ctx,
        )

        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No files found")
      },
    })
  })

  test("asks for external_directory permission outside the project", async () => {
    await using outer = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `console.log(foo)\n`)
      },
    })
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstGrepTool.init()
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const testCtx = {
          ...ctx,
          ask: async (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) => {
            requests.push(req)
          },
        }

        await tool.execute(
          {
            pattern: "console.log($A)",
            lang: "typescript",
            path: outer.path,
          },
          testCtx,
        )

        expect(requests.find((item) => item.permission === "grep")).toBeDefined()
        const ext = requests.find((item) => item.permission === "external_directory")
        expect(ext).toBeDefined()
        expect(ext!.patterns).toContain(path.join(outer.path, "*").replaceAll("\\", "/"))
      },
    })
  })
})
