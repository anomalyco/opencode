import { describe, expect, test } from "bun:test"
import { AppArchive } from "../src/app-archive"

describe("app archive", () => {
  test("reads back every asset's bytes by key", () => {
    const entries = [
      ["index.html", new TextEncoder().encode("<html></html>")],
      ["_assets/empty.js", new Uint8Array()],
      ["_assets/engine.wasm", Uint8Array.from({ length: 70_000 }, (_, index) => index % 251)],
    ] as const

    const assets = AppArchive.decode(AppArchive.encode(entries))

    expect(Object.keys(assets)).toEqual(entries.map((entry) => entry[0]))
    entries.forEach(([key, body]) => expect(assets[key]).toEqual(body))
  })

  test("reads an archive that starts partway into its buffer", () => {
    const archive = AppArchive.encode([["sw.js", new Uint8Array([1, 2, 3])]])
    const shared = new Uint8Array(archive.length + 7)
    shared.set(archive, 7)

    expect(AppArchive.decode(shared.subarray(7))["sw.js"]).toEqual(new Uint8Array([1, 2, 3]))
  })

  test("reads an empty archive as no assets", () => {
    expect(AppArchive.decode(AppArchive.encode([]))).toEqual({})
  })
})
