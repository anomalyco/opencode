import { describe, expect, mock, test } from "bun:test"
import { attachFiles } from "./attach-files"

describe("attachFiles", () => {
  test("adds every selected file in order", async () => {
    const a = new File(["a"], "a.png", { type: "image/png" })
    const b = new File(["b"], "b.pdf", { type: "application/pdf" })
    const add = mock(async (_file: File) => undefined)
    const list = {
      0: a,
      1: b,
      length: 2,
      item: (index: number) => [a, b][index] ?? null,
      [Symbol.iterator]: function* () {
        yield a
        yield b
      },
    } as FileList

    await attachFiles(list, add)

    expect(add.mock.calls).toHaveLength(2)
    expect(add.mock.calls[0]?.[0]).toBe(a)
    expect(add.mock.calls[1]?.[0]).toBe(b)
  })

  test("ignores empty selections", async () => {
    const add = mock(async (_file: File) => undefined)

    await attachFiles(null, add)

    expect(add.mock.calls).toHaveLength(0)
  })

  test("continues after one file add fails", async () => {
    const a = new File(["a"], "a.png", { type: "image/png" })
    const b = new File(["b"], "b.pdf", { type: "application/pdf" })
    const add = mock(async (file: File) => {
      if (file === a) throw new Error("fail")
    })
    const list = {
      0: a,
      1: b,
      length: 2,
      item: (index: number) => [a, b][index] ?? null,
      [Symbol.iterator]: function* () {
        yield a
        yield b
      },
    } as FileList

    await attachFiles(list, add)

    expect(add.mock.calls).toHaveLength(2)
    expect(add.mock.calls[0]?.[0]).toBe(a)
    expect(add.mock.calls[1]?.[0]).toBe(b)
  })
})
