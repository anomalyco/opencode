import { beforeEach, describe, expect, mock, test } from "bun:test"

const opens: string[] = []
const spawns: string[][] = []

mock.module("open", () => ({
  default: async (target: string) => {
    opens.push(target)
  },
}))

mock.module("@/util/process", () => ({
  Process: {
    spawn: (cmd: string[]) => {
      spawns.push(cmd)
      return {
        exited: Promise.resolve(0),
      }
    },
  },
}))

const { Editor } = await import("../../../src/cli/cmd/tui/util/editor")

describe("Editor.file", () => {
  beforeEach(() => {
    opens.length = 0
    spawns.length = 0
    delete process.env.EDITOR
    delete process.env.VISUAL
  })

  test("falls back to the default app when no editor is configured", async () => {
    await Editor.file({ path: "/tmp/demo.ts" })

    expect(opens).toEqual(["/tmp/demo.ts"])
    expect(spawns).toEqual([])
  })

  test("launches the configured editor command", async () => {
    process.env.EDITOR = '"C:/Program Files/Code/code.cmd" --wait'

    await Editor.file({ path: "/tmp/demo.ts" })

    expect(spawns).toEqual([["C:/Program Files/Code/code.cmd", "--wait", "/tmp/demo.ts"]])
    expect(opens).toEqual([])
  })
})

describe("Editor.dir", () => {
  beforeEach(() => {
    opens.length = 0
  })

  test("opens the directory with the system default app", async () => {
    await Editor.dir("/tmp/project")

    expect(opens).toEqual(["/tmp/project"])
  })
})
