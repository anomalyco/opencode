import { describe, it, expect, spyOn } from "bun:test"
import { File } from "../../../file"
import { Instance } from "../../../project/instance"
import { Filesystem } from "../../../util/filesystem"
import { Bus } from "../../../bus"
import path from "node:path"

describe("File.write", () => {
  it("should reject path traversal", async () => {
    await Instance.provide({
      directory: "/mock/dir",
      init: async () => {},
      fn: async () => {
        spyOn(Instance, "containsPath").mockReturnValue(false)
        await expect(File.write("../../etc/passwd", "bad")).rejects.toThrow(
          "Access denied: path escapes project directory",
        )
      },
    })
  })

  it("should write content to a file", async () => {
    await Instance.provide({
      directory: "/mock/dir",
      init: async () => {},
      fn: async () => {
        spyOn(Instance, "containsPath").mockReturnValue(true)
        const writeSpy = spyOn(Filesystem, "write").mockResolvedValue(undefined)
        const busSpy = spyOn(Bus, "publish").mockResolvedValue([] as any)

        await File.write("test.txt", "hello")

        expect(writeSpy).toHaveBeenCalledWith(path.join("/mock/dir", "test.txt"), "hello")
        expect(busSpy).toHaveBeenCalled()
      },
    })
  })
})
