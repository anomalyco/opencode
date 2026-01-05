import { describe, expect, test, afterEach } from "bun:test"
import { ProcessCwd } from "../../src/util/process-cwd"
import fs from "fs"
import os from "os"

const realpath = (p: string) => fs.realpathSync(p)

describe("util.ProcessCwd", () => {
  const originalCwd = process.cwd()

  afterEach(() => {
    process.chdir(originalCwd)
  })

  test("runs function in specified directory", async () => {
    const tmpdir = realpath(os.tmpdir())
    const result = await ProcessCwd.run(tmpdir, () => process.cwd())
    expect(result).toBe(tmpdir)
  })

  test("restores original directory after execution", async () => {
    await ProcessCwd.run(realpath(os.tmpdir()), () => {})
    expect(process.cwd()).toBe(originalCwd)
  })

  test("skips chdir when already in target directory", async () => {
    const result = await ProcessCwd.run(originalCwd, () => 42)
    expect(result).toBe(42)
    expect(process.cwd()).toBe(originalCwd)
  })

  test("restores directory even when function throws", async () => {
    await expect(
      ProcessCwd.run(realpath(os.tmpdir()), () => {
        throw new Error("test error")
      }),
    ).rejects.toThrow("test error")
    expect(process.cwd()).toBe(originalCwd)
  })

  test("handles nested calls correctly", async () => {
    const dir1 = realpath(os.tmpdir())
    const dir2 = originalCwd

    await ProcessCwd.run(dir1, async () => {
      expect(process.cwd()).toBe(dir1)
      await ProcessCwd.run(dir2, async () => {
        expect(process.cwd()).toBe(dir2)
      })
      expect(process.cwd()).toBe(dir1)
    })
    expect(process.cwd()).toBe(originalCwd)
  })

  test("serializes concurrent top-level calls", async () => {
    const order: number[] = []
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

    await Promise.all([
      ProcessCwd.run(realpath(os.tmpdir()), async () => {
        order.push(1)
        await delay(10)
        order.push(2)
      }),
      ProcessCwd.run(realpath(os.tmpdir()), async () => {
        order.push(3)
        await delay(5)
        order.push(4)
      }),
    ])

    expect(order).toEqual([1, 2, 3, 4])
  })

  test("returns function result correctly", async () => {
    const result = await ProcessCwd.run(realpath(os.tmpdir()), () => ({ value: 42 }))
    expect(result).toEqual({ value: 42 })
  })

  test("works with async functions", async () => {
    const result = await ProcessCwd.run(realpath(os.tmpdir()), async () => {
      await new Promise((r) => setTimeout(r, 1))
      return "async result"
    })
    expect(result).toBe("async result")
  })

  test("handles deeply nested calls", async () => {
    const tmpdir = realpath(os.tmpdir())
    const dirs = [tmpdir, originalCwd, tmpdir]
    const observed: string[] = []

    await ProcessCwd.run(dirs[0], async () => {
      observed.push(process.cwd())
      await ProcessCwd.run(dirs[1], async () => {
        observed.push(process.cwd())
        await ProcessCwd.run(dirs[2], async () => {
          observed.push(process.cwd())
        })
        observed.push(process.cwd())
      })
      observed.push(process.cwd())
    })

    expect(observed).toEqual([dirs[0], dirs[1], dirs[2], dirs[1], dirs[0]])
  })

  test("nested call skips chdir when same directory", async () => {
    const dir = realpath(os.tmpdir())
    let innerCalled = false

    await ProcessCwd.run(dir, async () => {
      await ProcessCwd.run(dir, () => {
        innerCalled = true
        expect(process.cwd()).toBe(dir)
      })
    })

    expect(innerCalled).toBe(true)
  })
})
