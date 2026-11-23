import { expect, test } from "bun:test"
import { previewRange } from "./range"

test("range headers describe the exact slice streamed, including suffixes and empty files", () => {
  expect(previewRange(null, 10)).toEqual({ status: 200, length: 10 })

  for (const value of ["bytes=7-", "bytes=-3", "bytes=7-20"])
    expect(previewRange(value, 10)).toEqual({ status: 206, length: 3, content: "bytes 7-9/10", range: "bytes=7-9" })

  for (const value of ["bytes=10-", "bytes=8-7", "bytes=-0", "bytes=0-1,4-5"])
    expect(previewRange(value, 10)).toMatchObject({ status: 416, content: "bytes */10", length: 0 })
  expect(previewRange("bytes=0-", 0)).toMatchObject({ status: 416 })
})
