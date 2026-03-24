import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Permission } from "../../src/permission"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { AstEditTool } from "../../src/tool/ast_edit"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: SessionID.make("ses_test-ast-edit"),
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

describe("tool.ast_edit", () => {
  test("rewrites structural matches in a single file", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `console.log(foo)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstEditTool.init()
        const result = await tool.execute(
          {
            pattern: "console.log($A)",
            rewrite: "logger.info($A)",
            lang: "typescript",
            path: path.join(tmp.path, "a.ts"),
          },
          ctx,
        )

        expect(result.metadata.matches).toBe(1)
        expect(result.metadata.files).toBe(1)
        expect(result.metadata.diff).toContain("logger.info(foo)")
        expect(await Bun.file(path.join(tmp.path, "a.ts")).text()).toBe("logger.info(foo)\n")
      },
    })
  })

  test("rewrites matches across a directory", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `console.log(foo)\n`)
        await Bun.write(path.join(dir, "b.ts"), `console.log(bar)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstEditTool.init()
        const result = await tool.execute(
          {
            pattern: "console.log($A)",
            rewrite: "logger.info($A)",
            lang: "typescript",
            path: tmp.path,
          },
          ctx,
        )

        expect(result.metadata.matches).toBe(2)
        expect(result.metadata.files).toBe(2)
        expect(result.output).toContain("Updated files:")
        expect(await Bun.file(path.join(tmp.path, "a.ts")).text()).toBe("logger.info(foo)\n")
        expect(await Bun.file(path.join(tmp.path, "b.ts")).text()).toBe("logger.info(bar)\n")
      },
    })
  })

  test("preserves original spacing for $$$NAME rewrites", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `foo(a, b)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstEditTool.init()
        await tool.execute(
          {
            pattern: "foo($$$ARGS)",
            rewrite: "bar($$$ARGS)",
            lang: "typescript",
            path: path.join(tmp.path, "a.ts"),
          },
          ctx,
        )

        expect(await Bun.file(path.join(tmp.path, "a.ts")).text()).toBe("bar(a, b)\n")
      },
    })
  })

  test("asks for edit and external_directory permissions outside the project", async () => {
    await using outer = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `console.log(foo)\n`)
      },
    })
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstEditTool.init()
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
            rewrite: "logger.info($A)",
            lang: "typescript",
            path: outer.path,
          },
          testCtx,
        )

        expect(requests.find((item) => item.permission === "edit")).toBeDefined()
        const ext = requests.find((item) => item.permission === "external_directory")
        expect(ext).toBeDefined()
        expect(ext!.patterns).toContain(path.join(outer.path, "*").replaceAll("\\", "/"))
      },
    })
  })

  test("fails if the file changes after planning", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `console.log(foo)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstEditTool.init()
        const file = path.join(tmp.path, "a.ts")
        const testCtx = {
          ...ctx,
          ask: async () => {
            await new Promise((resolve) => setTimeout(resolve, 20))
            await Bun.write(file, `console.log(bar)\n`)
            const time = new Date(Date.now() + 2_000)
            await fs.utimes(file, time, time)
            await new Promise((resolve) => setTimeout(resolve, 20))
          },
        }

        await expect(
          tool.execute(
            {
              pattern: "console.log($A)",
              rewrite: "logger.info($A)",
              lang: "typescript",
              path: file,
            },
            testCtx,
          ),
        ).rejects.toThrow("has been modified since it was last read")
      },
    })
  })

  test("returns no matches found when nothing changes", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "a.ts"), `logger.info(foo)\n`)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await AstEditTool.init()
        const result = await tool.execute(
          {
            pattern: "console.log($A)",
            rewrite: "logger.info($A)",
            lang: "typescript",
            path: tmp.path,
          },
          ctx,
        )

        expect(result.metadata.matches).toBe(0)
        expect(result.output).toBe("No matches found")
      },
    })
  })
})
