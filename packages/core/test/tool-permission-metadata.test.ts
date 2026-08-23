import { describe, expect, test } from "bun:test"
import { jsonMetadata } from "../src/tool/metadata"

describe("jsonMetadata", () => {
  test("drops absent optional fields so metadata stays JSON-encodable", () => {
    const metadata = jsonMetadata({
      root: ".",
      path: undefined,
      include: undefined,
      limit: undefined,
    })
    expect(metadata).toEqual({ root: "." })
    expect(JSON.parse(JSON.stringify(metadata))).toEqual(metadata)
  })

  test("keeps provided optional fields and required values", () => {
    const metadata = jsonMetadata({
      root: "src",
      path: "src",
      include: "*.ts",
      limit: 10,
    })
    expect(metadata).toEqual({ root: "src", path: "src", include: "*.ts", limit: 10 })
  })

  test("matches the glob/grep pending-permission repro from #37650", () => {
    // glob input without the optional `path`
    expect(jsonMetadata({ root: ".", path: undefined, limit: undefined })).toEqual({ root: "." })
    // grep input with `path` but absent `include`/`limit`
    expect(jsonMetadata({ root: ".", path: "docs", include: undefined, limit: undefined })).toEqual({
      root: ".",
      path: "docs",
    })
  })
})
