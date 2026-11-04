import { expect, test } from "bun:test"
import path from "node:path"
import { parseStoryMedia } from "../../src/feature-plugins/system/storybook/media"
import { tmpdir } from "../fixture/fixture"

test("lists the media of files and directories once each, skipping missing paths and files it cannot show", async () => {
  await using temporary = await tmpdir()
  const directory = path.join(temporary.path, "capture")
  const single = path.join(temporary.path, "single.jpg")
  for (const name of ["b.MOV", "a.png", "notes.txt", "clip.webm", "nested.mp4/inner.mp4"])
    await Bun.write(path.join(directory, name), "")
  await Bun.write(single, "")

  const items = parseStoryMedia(
    [directory, path.join(temporary.path, "missing.mp4"), single, directory].join(path.delimiter),
  )

  expect(items.map((item) => [item.path, item.kind, item.mime])).toEqual([
    [path.join(directory, "a.png"), "image", "image/png"],
    [path.join(directory, "b.MOV"), "video", "video/quicktime"],
    [single, "image", "image/jpeg"],
  ])
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
})
