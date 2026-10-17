import { describe, expect, test } from "bun:test"
import path from "node:path"
import { platformFields } from "../script/platform-fields"

const manifestWriters = ["build.ts", "build-node.ts"]

describe("npm platform fields", () => {
  test("pins each Linux variant to the libc it was built against", () => {
    expect([
      platformFields({ os: "linux", arch: "x64" }),
      platformFields({ os: "linux", arch: "arm64" }),
      platformFields({ os: "linux", arch: "x64", abi: "musl" }),
      platformFields({ os: "linux", arch: "arm64", abi: "musl" }),
    ]).toEqual([
      { os: ["linux"], cpu: ["x64"], libc: ["glibc"] },
      { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] },
      { os: ["linux"], cpu: ["x64"], libc: ["musl"] },
      { os: ["linux"], cpu: ["arm64"], libc: ["musl"] },
    ])
  })

  test("omits libc on the platforms npm does not match it on", () => {
    expect([
      platformFields({ os: "darwin", arch: "arm64" }),
      platformFields({ os: "darwin", arch: "x64" }),
      platformFields({ os: "win32", arch: "x64" }),
    ]).toEqual([
      { os: ["darwin"], cpu: ["arm64"] },
      { os: ["darwin"], cpu: ["x64"] },
      { os: ["win32"], cpu: ["x64"] },
    ])
  })

  test("routes every published platform manifest through platformFields", async () => {
    const writers = await Promise.all(
      manifestWriters.map(async (writer) => ({
        writer,
        source: await Bun.file(path.join(import.meta.dir, "..", "script", writer)).text(),
      })),
    )
    expect(writers.filter((entry) => /^\s+(?:os|cpu|libc): \[/m.test(entry.source)).map((entry) => entry.writer)).toEqual(
      [],
    )
  })
})
