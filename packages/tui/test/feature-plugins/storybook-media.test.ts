import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { parseStoryMedia } from "../../src/feature-plugins/system/storybook/media"
import { tmpdir } from "../fixture/fixture"

test("lists the media of files and directories, skipping missing paths and other files", async () => {
  await using temporary = await tmpdir()
  const directory = path.join(temporary.path, "capture")
  await mkdir(path.join(directory, "nested.mp4"), { recursive: true })
  await Promise.all(
    ["b.MOV", "a.png", "notes.txt", "clip.webm", "nested.mp4/inner.mp4", "single.jpg"].map((name) =>
      Bun.write(path.join(name === "single.jpg" ? temporary.path : directory, name), ""),
    ),
  )

  const items = parseStoryMedia(
    ["~/capture", path.join(temporary.path, "missing.mp4"), path.join(temporary.path, "single.jpg"), "~/capture"].join(
      path.delimiter,
    ),
    temporary.path,
  )

  expect(items.map((item) => [item.path, item.kind, item.mime])).toEqual([
    [path.join(directory, "a.png"), "image", "image/png"],
    [path.join(directory, "b.MOV"), "video", "video/quicktime"],
    [path.join(temporary.path, "single.jpg"), "image", "image/jpeg"],
  ])
  expect(new Set(items.map((item) => item.id)).size).toBe(3)
})
