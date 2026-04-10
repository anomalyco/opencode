import { describe, expect, test } from "bun:test"
import { getDroppedPromptData } from "./drop"

describe("getDroppedPromptData", () => {
  test("prefers dropped files over file uri text", () => {
    const file = new File(["png"], "drop.png", { type: "image/png" })
    const dataTransfer = {
      files: [file] as unknown as FileList,
      getData: () => "file:/tmp/drop.png",
    }

    const result = getDroppedPromptData(dataTransfer)
    expect(result.files).toEqual([file])
    expect(result.filePath).toBeUndefined()
  })

  test("falls back to file uri text when no files are present", () => {
    const dataTransfer = {
      files: [] as unknown as FileList,
      getData: () => "file:/tmp/drop.png",
    }

    expect(getDroppedPromptData(dataTransfer)).toEqual({
      files: [],
      filePath: "/tmp/drop.png",
    })
  })
})
