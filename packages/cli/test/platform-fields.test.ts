import { expect, test } from "bun:test"
import { platformFields } from "../script/platform-fields"

test("declares libc on linux", () => {
  expect(platformFields({ os: "linux", arch: "x64" })).toEqual({ os: ["linux"], cpu: ["x64"], libc: ["glibc"] })
  expect(platformFields({ os: "linux", arch: "arm64", abi: "musl" })).toEqual({
    os: ["linux"],
    cpu: ["arm64"],
    libc: ["musl"],
  })
})

test("omits libc outside linux", () => {
  const fields = platformFields({ os: "darwin", arch: "arm64" })

  expect(fields).toEqual({ os: ["darwin"], cpu: ["arm64"] })
  expect("libc" in fields).toBe(false)
})
