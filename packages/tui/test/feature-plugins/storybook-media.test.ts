import type { Plugin } from "@opencode/plugin/tui"
import { expect, test } from "bun:test"
import path from "node:path"
import { useTheme } from "../../src/context/theme"
import { mediaStory, parseStoryMedia } from "../../src/feature-plugins/system/storybook/media"
import { tmpdir } from "../fixture/fixture"
import { renderMedia } from "../fixture/media"

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

// The value of OPENCODE_STORY_MEDIA, the files in it, and the item count the story shows.
test.each([
  { value: "", files: [], items: "4 items" },
  { value: "temporary", files: ["a.png", "b.mp4"], items: "3 items" },
])("the story lists the media in OPENCODE_STORY_MEDIA=$value when it opens, not when the TUI loads", async (row) => {
  await using temporary = await tmpdir()
  for (const name of row.files) await Bun.write(path.join(temporary.path, name), "")
  const previous = process.env.OPENCODE_STORY_MEDIA
  process.env.OPENCODE_STORY_MEDIA = row.value && temporary.path
  try {
    await using story = await renderMedia(() => {
      // Only what the story reads of the plugin context.
      const context = { theme: useTheme(), keymap: { layer: () => {} }, ui: { router: { navigate: () => {} } } }
      return mediaStory.render(context as unknown as Plugin.Context)
    })
    // The files, or without any the three test fixtures, and a WebM it can't play.
    await story.until(() => story.frame().includes(`storybook / media · ${row.items}`))
  } finally {
    if (previous === undefined) delete process.env.OPENCODE_STORY_MEDIA
    else process.env.OPENCODE_STORY_MEDIA = previous
  }
})
