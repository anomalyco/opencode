import { describe, expect, test } from "bun:test"
import path from "path"
import { EditTool } from "../../src/tool/edit"
import { Instance } from "../../src/project/instance"
import { FileTime } from "../../src/file/time"
import { tmpdir } from "../fixture/fixture"

const baseCtx = {
  sessionID: "test",
  messageID: "",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: () => {},
}

type AskInput = {
  permission: string
  patterns: string[]
  always: string[]
  metadata: {
    filepath: string
    diff: string
  }
}

type ToolCtx = typeof baseCtx & {
  ask: (input: AskInput) => Promise<void>
}

const baseOld = "alpha\nbeta\ngamma"
const baseNew = "alpha\nbeta-updated\ngamma"
const baseAlt = "alpha\nbeta\nomega"

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

const normalize = (text: string, ending: "\n" | "\r\n") => {
  const normalized = text.replaceAll("\r\n", "\n")
  if (ending === "\n") return normalized
  return normalized.replaceAll("\n", "\r\n")
}

const countLineEndings = (content: string) => {
  const crlfMatches = content.match(/\r\n/g)
  const lfMatches = content.match(/\n/g)
  const crlf = crlfMatches ? crlfMatches.length : 0
  const lf = lfMatches ? lfMatches.length : 0
  return {
    crlf,
    lf: lf - crlf,
  }
}

const expectLf = (content: string) => {
  const counts = countLineEndings(content)
  expect(counts.crlf).toBe(0)
  expect(counts.lf).toBeGreaterThan(0)
}

const expectCrlf = (content: string) => {
  const counts = countLineEndings(content)
  expect(counts.lf).toBe(0)
  expect(counts.crlf).toBeGreaterThan(0)
}

type EditInput = {
  content: string
  oldString: string
  newString: string
  replaceAll?: boolean
}

const runEdit = async (input: EditInput) => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(path.join(dir, "test.txt"), input.content)
    },
  })
  const ctxData = makeCtx()
  const ctx = ctxData.ctx
  return Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const edit = await EditTool.init()
      const filePath = path.join(tmp.path, "test.txt")
      FileTime.read(ctx.sessionID, filePath)
      await edit.execute(
        {
          filePath,
          oldString: input.oldString,
          newString: input.newString,
          replaceAll: input.replaceAll,
        },
        ctx,
      )
      return Bun.file(filePath).text()
    },
  })
}

describe("tool.edit line endings", () => {
  test("preserves LF with LF multi-line strings", async () => {
    const content = normalize(baseOld + "\n", "\n")
    const output = await runEdit({
      content,
      oldString: normalize(baseOld, "\n"),
      newString: normalize(baseNew, "\n"),
    })
    expect(output).toBe(normalize(baseNew + "\n", "\n"))
    expectLf(output)
  })

  test("preserves CRLF with CRLF multi-line strings", async () => {
    const content = normalize(baseOld + "\n", "\r\n")
    const output = await runEdit({
      content,
      oldString: normalize(baseOld, "\r\n"),
      newString: normalize(baseNew, "\r\n"),
    })
    expect(output).toBe(normalize(baseNew + "\n", "\r\n"))
    expectCrlf(output)
  })

  test("preserves LF when old/new use CRLF", async () => {
    const content = normalize(baseOld + "\n", "\n")
    const output = await runEdit({
      content,
      oldString: normalize(baseOld, "\r\n"),
      newString: normalize(baseNew, "\r\n"),
    })
    expect(output).toBe(normalize(baseNew + "\n", "\n"))
    expectLf(output)
  })

  test("preserves CRLF when old/new use LF", async () => {
    const content = normalize(baseOld + "\n", "\r\n")
    const output = await runEdit({
      content,
      oldString: normalize(baseOld, "\n"),
      newString: normalize(baseNew, "\n"),
    })
    expect(output).toBe(normalize(baseNew + "\n", "\r\n"))
    expectCrlf(output)
  })

  test("preserves LF when newString uses CRLF", async () => {
    const content = normalize(baseOld + "\n", "\n")
    const output = await runEdit({
      content,
      oldString: normalize(baseOld, "\n"),
      newString: normalize(baseNew, "\r\n"),
    })
    expect(output).toBe(normalize(baseNew + "\n", "\n"))
    expectLf(output)
  })

  test("preserves CRLF when newString uses LF", async () => {
    const content = normalize(baseOld + "\n", "\r\n")
    const output = await runEdit({
      content,
      oldString: normalize(baseOld, "\r\n"),
      newString: normalize(baseNew, "\n"),
    })
    expect(output).toBe(normalize(baseNew + "\n", "\r\n"))
    expectCrlf(output)
  })

  test("preserves LF with mixed old/new line endings", async () => {
    const content = normalize(baseOld + "\n", "\n")
    const output = await runEdit({
      content,
      oldString: "alpha\nbeta\r\ngamma",
      newString: "alpha\r\nbeta\nomega",
    })
    expect(output).toBe(normalize(baseAlt + "\n", "\n"))
    expectLf(output)
  })

  test("preserves CRLF with mixed old/new line endings", async () => {
    const content = normalize(baseOld + "\n", "\r\n")
    const output = await runEdit({
      content,
      oldString: "alpha\r\nbeta\ngamma",
      newString: "alpha\nbeta\r\nomega",
    })
    expect(output).toBe(normalize(baseAlt + "\n", "\r\n"))
    expectCrlf(output)
  })

  test("replaceAll preserves LF for multi-line blocks", async () => {
    const blockOld = "alpha\nbeta"
    const blockNew = "alpha\nbeta-updated"
    const content = normalize(blockOld + "\n" + blockOld + "\n", "\n")
    const output = await runEdit({
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
    const output = await runEdit({
      content,
      oldString: normalize(blockOld, "\r\n"),
      newString: normalize(blockNew, "\r\n"),
      replaceAll: true,
    })
    expect(output).toBe(normalize(blockNew + "\n" + blockNew + "\n", "\r\n"))
    expectCrlf(output)
  })
})
