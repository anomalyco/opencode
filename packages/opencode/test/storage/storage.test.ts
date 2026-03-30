import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Global } from "../../src/global"
import { Storage } from "../../src/storage/storage"

const dir = path.join(Global.Path.data, "storage")

async function reset() {
  await fs.rm(dir, { recursive: true, force: true })
}

describe("Storage", () => {
  beforeEach(reset)
  afterAll(reset)

  test("round-trips JSON content", async () => {
    const key = ["session_diff", "roundtrip"]
    const value = [{ file: "a.ts", additions: 2, deletions: 1 }]

    await Storage.write(key, value)

    expect(await Storage.read<typeof value>(key)).toEqual(value)
  })

  test("maps missing reads to NotFoundError", async () => {
    await expect(Storage.read(["missing", "value"])).rejects.toMatchObject({ name: "NotFoundError" })
  })

  test("serializes concurrent updates for the same key", async () => {
    const key = ["counter", "shared"]
    await Storage.write(key, { value: 0 })

    await Promise.all(
      Array.from({ length: 25 }, () =>
        Storage.update<{ value: number }>(key, (draft) => {
          draft.value += 1
        }),
      ),
    )

    expect(await Storage.read<{ value: number }>(key)).toEqual({ value: 25 })
  })

  test("lists and removes stored entries", async () => {
    await Storage.write(["list", "b"], { value: 2 })
    await Storage.write(["list", "a"], { value: 1 })

    expect(await Storage.list(["list"])).toEqual([
      ["list", "a"],
      ["list", "b"],
    ])

    await Storage.remove(["list", "a"])

    expect(await Storage.list(["list"])).toEqual([["list", "b"]])
    await expect(Storage.read(["list", "a"])).rejects.toMatchObject({ name: "NotFoundError" })
  })
})
