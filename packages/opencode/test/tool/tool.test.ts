import { describe, expect, test } from "bun:test"
import { App } from "../../src/app/app"
import { GlobTool } from "../../src/tool/glob"
import { ListTool } from "../../src/tool/ls"

const ctx = {
  sessionID: "test",
  messageID: "",
  abort: AbortSignal.any([]),
  metadata: () => {},
}
const glob = await GlobTool()
const list = await ListTool()

describe("tool.glob", () => {
  test("truncate", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      let result = await glob.execute(
        {
          pattern: "../../node_modules/**/*",
          path: undefined,
        },
        ctx,
      )
      expect(result.metadata.truncated).toBe(true)
    })
  })
  test("basic", async () => {
    await App.provide({ cwd: process.cwd() }, async () => {
      let result = await glob.execute(
        {
          pattern: "*.json",
          path: undefined,
        },
        ctx,
      )
      expect(result.metadata).toMatchObject({
        truncated: false,
        count: 3,
      })
    })
  })
})

describe("tool.ls", () => {
  test("basic", async () => {
    const result = await App.provide({ cwd: process.cwd() }, async () => {
      return await list.execute({ path: "./example", ignore: [".git"] }, ctx)
    })
    expect(result.output).toMatchSnapshot()
  })
})
