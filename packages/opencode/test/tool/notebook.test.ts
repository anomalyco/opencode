import { describe, test, expect, afterEach } from "bun:test"
import path from "path"
import { NotebookEditTool } from "../../src/tool/notebook"
import { renderNotebook } from "../../src/tool/notebook"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-notebook"),
  messageID: MessageID.make(""),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

const nb = (cells: object[]) => JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: {}, cells })

const codeCell = (source: string) => ({ cell_type: "code", source, metadata: {}, outputs: [] })
const mdCell = (source: string) => ({ cell_type: "markdown", source, metadata: {} })

afterEach(async () => {
  await Instance.disposeAll()
})

describe("renderNotebook", () => {
  test("renders code and markdown cells", () => {
    const raw = nb([codeCell("print('hi')"), mdCell("# Title")])
    const out = renderNotebook(raw)
    expect(out).toContain("[Cell 1] code")
    expect(out).toContain("print('hi')")
    expect(out).toContain("[Cell 2] markdown")
    expect(out).toContain("# Title")
  })

  test("handles empty cell source", () => {
    const raw = nb([codeCell("")])
    expect(renderNotebook(raw)).toContain("(empty)")
  })

  test("handles array source", () => {
    const raw = nb([{ cell_type: "code", source: ["a = 1\n", "b = 2"], metadata: {}, outputs: [] }])
    expect(renderNotebook(raw)).toContain("a = 1\nb = 2")
  })
})

describe("NotebookEditTool insert", () => {
  test("inserts a cell at index 0", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "nb.ipynb")
    await Bun.write(file, nb([codeCell("original")]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await NotebookEditTool.init()
        await tool.execute({ filePath: file, operation: "insert", index: 0, cellType: "markdown", source: "new" }, ctx)
        const out = JSON.parse(await Bun.file(file).text())
        expect(out.cells[0].cell_type).toBe("markdown")
        expect(out.cells[0].source).toBe("new")
        expect(out.cells[1].source).toBe("original")
      },
    })
  })
})

describe("NotebookEditTool replace", () => {
  test("replaces cell content", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "nb.ipynb")
    await Bun.write(file, nb([codeCell("old"), mdCell("keep")]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await NotebookEditTool.init()
        await tool.execute({ filePath: file, operation: "replace", index: 0, cellType: "code", source: "new" }, ctx)
        const out = JSON.parse(await Bun.file(file).text())
        expect(out.cells[0].source).toBe("new")
        expect(out.cells[1].source).toBe("keep")
      },
    })
  })

  test("throws on out-of-range index", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "nb.ipynb")
    await Bun.write(file, nb([codeCell("only")]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await NotebookEditTool.init()
        expect(tool.execute({ filePath: file, operation: "replace", index: 5, source: "x" }, ctx)).rejects.toThrow(
          "out of range",
        )
      },
    })
  })
})

describe("NotebookEditTool delete", () => {
  test("deletes a cell", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, "nb.ipynb")
    await Bun.write(file, nb([codeCell("first"), codeCell("second")]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await NotebookEditTool.init()
        await tool.execute({ filePath: file, operation: "delete", index: 0 }, ctx)
        const out = JSON.parse(await Bun.file(file).text())
        expect(out.cells.length).toBe(1)
        expect(out.cells[0].source).toBe("second")
      },
    })
  })
})
