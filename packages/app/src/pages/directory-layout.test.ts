import { describe, expect, test } from "bun:test"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { decodeDirectory } from "./directory-layout"

describe("decodeDirectory", () => {
  test("decodes canonical directory segments", () => {
    const decoded: string | undefined = decodeDirectory(base64Encode("项目/repo"))
    expect(decoded).toBe("项目/repo")
  })

  test("rejects segments that do not round trip", () => {
    // "app" decodes to "j\uFFFD", which is not a directory we would have encoded.
    expect(decodeDirectory("app")).toBeUndefined()
  })
})
