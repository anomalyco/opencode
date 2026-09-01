import { afterEach, expect, test } from "bun:test"
import {
  CliRenderEvents,
  ImageRenderable,
  TextRenderable,
  type NativeImage,
  type ScrollbackSurface,
} from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { RunScrollbackStream } from "../../src/mini/scrollback.surface"
import { RUN_THEME_FALLBACK, RUN_THEME_MONO } from "../../src/mini/theme"
import type { StreamCommit } from "../../src/mini/types"
import { diffImageFixture } from "../fixture/diff-image"

const wide = `data:image/png;base64,${Buffer.from(diffImageFixture).toString("base64")}`
// A 48 x 192 PNG with four colored quadrants.
const tall =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAADACAIAAADN8nfJAAAA+klEQVR4nO3bUQ0AIAxDwUmZEETMf+YFTDR8XYIAQmBs7WvdM5HVoVU25ITcIa9MHVIYfR0+V+2HBk3HqKc2dZjLDIpGaWIDOYZgRUGjMVJh6dSEc9YC84U9xcDjKPJcudJ8eyAB1AKMAtcBNCGsMGgoPRwjsBJ6Cs6FLwO8EeeYfKkFuQ5BE1EcYaU/ca6dyOrQsiEn5A55ZeqQwujr8LlqPzRoOkY9tanDXGZQNEoTG8gxBCsKGo2RCkunJpyzFpgv7CkGHkeR58qV5tsDCaAWYBS4DqAJYYVBQ+nhGIGV0FNwLnwZ4I04x+RLLch1CJqI4ggr7Y841wMtbiD+34CxQgAAAABJRU5ErkJggg=="

type Preview = {
  surface: ScrollbackSurface
  image: ImageRenderable
  native: NativeImage | null
  size: { width: number; height: number }
  x: number
  y: number
  captionHeight: number
}

const cleanups: Array<() => void> = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
})

async function setup(
  options: { width?: number; height?: number; footerHeight?: number; imagePreview?: boolean; mono?: boolean } = {},
) {
  const renderer = await createTestRenderer({
    width: options.width ?? 80,
    height: options.height ?? 24,
    footerHeight: options.footerHeight ?? 6,
    screenMode: "split-footer",
    externalOutputMode: "capture-stdout",
  })
  const out = {
    ...renderer,
    scrollback: new RunScrollbackStream(renderer.renderer, options.mono ? RUN_THEME_MONO : RUN_THEME_FALLBACK, options),
    previews: [] as Preview[],
  }
  cleanups.push(() => {
    out.scrollback.destroy()
    out.renderer.destroy()
  })
  out.renderer.on(CliRenderEvents.EXTERNAL_OUTPUT, () => {
    const surface = Reflect.get(out.scrollback, "imageSurface") as ScrollbackSurface | undefined
    if (!surface || out.previews.some((preview) => preview.surface === surface)) return
    const image = surface.root.getChildren().find((child) => child instanceof ImageRenderable)
    const caption = surface.root.getChildren().find((child) => child instanceof TextRenderable)
    if (!image || !caption) throw new Error("Missing image or caption on image surface")
    out.previews.push({
      surface,
      image,
      native: image.image,
      size: { width: image.width, height: image.height },
      x: image.x,
      y: image.y,
      captionHeight: caption.height,
    })
  })
  return out
}

function image(source = wide, text = "landscape.png", partID = "image-1"): StreamCommit {
  return { kind: "user", source: "system", phase: "final", messageID: "message-1", partID, text, image: source }
}

test.each([
  {
    name: "wide",
    image: wide,
    width: 40,
    height: 30,
    size: { width: 40, height: 10 },
  },
  {
    name: "tall",
    image: tall,
    width: 80,
    height: 24,
    size: { width: 9, height: 17 },
  },
])("fits a $name image at the left edge and commits only its fitted rows", async (options) => {
  const out = await setup({ ...options, imagePreview: true })
  const listeners = out.renderer.listenerCount(CliRenderEvents.DESTROY)
  await out.scrollback.append(image(options.image))

  expect(out.previews).toHaveLength(1)
  const preview = out.previews[0]!
  expect(preview.size).toEqual(options.size)
  expect(preview.x).toBe(0)
  expect(preview.y).toBe(preview.captionHeight)
  const commits = out.externalOutput.take()
  expect(commits).toHaveLength(1)
  expect(commits[0]!.rows[0]).toBe("\u203a landscape.png")
  expect(commits[0]!.height).toBe(options.size.height + preview.captionHeight)
  expect(preview.surface.isDestroyed).toBe(true)
  expect(preview.image.isDestroyed).toBe(true)
  expect(preview.image.image).toBeNull()
  expect(() => preview.native!.info()).toThrow()
  expect(out.renderer.listenerCount(CliRenderEvents.DESTROY)).toBe(listeners)
})

test("reserves wrapped caption rows and allows caption-only output in a short terminal", async () => {
  const out = await setup({ width: 20, height: 10, footerHeight: 6, imagePreview: true })
  await out.scrollback.append(image(tall, "first caption wraps here\nsecond caption line"))
  expect(out.previews[0]!.captionHeight).toBe(3)
  expect(out.previews[0]!.size.height).toBe(1)
  expect(out.externalOutput.take()[0]!.height).toBe(4)

  out.resize(20, 8)
  await out.scrollback.append(image(wide, "first caption wraps here\nsecond caption line", "image-2"))
  expect(out.previews[1]!.image.visible).toBe(false)
  expect(out.externalOutput.take().at(-1)!.height).toBe(3)
})

test("uses physical cell geometry without enlarging a small image", async () => {
  const out = await setup({ imagePreview: true })
  Reflect.set(out.renderer, "_resolution", { width: 800, height: 720 })
  await out.scrollback.append(image(wide))
  expect(out.previews[0]!.size).toEqual({ width: 6, height: 1 })
  expect(out.previews[0]!.x).toBe(0)
})

test("finishes active text before every image and renders more than three images in order", async () => {
  const out = await setup({ imagePreview: true })
  const first = { ...image(wide, "image 1"), kind: "tool", source: "tool", tool: "read" } as const
  await out.scrollback.append({ ...first, image: undefined, tool: "shell", phase: "progress", text: "before images" })
  expect(out.externalOutput.take()).toEqual([])
  await out.scrollback.append(first)
  for (const index of [2, 3, 4, 5]) {
    await out.scrollback.append({ ...first, partID: `image-${index}`, text: `image ${index}`, image: tall })
  }
  await out.scrollback.append({ kind: "system", source: "system", phase: "final", text: "after images" })
  await out.scrollback.complete()

  expect(out.previews).toHaveLength(5)
  expect(
    out.externalOutput
      .take()
      .filter((commit) => commit.text.trim())
      .map((commit) => commit.rows[0]),
  ).toEqual(["before images", "image 1", "image 2", "image 3", "image 4", "image 5", "after images"])
  expect(out.previews.every((preview) => preview.image.isDestroyed && preview.surface.isDestroyed)).toBe(true)
})

test.each([{}, { imagePreview: false }, { imagePreview: true, mono: true }])(
  "keeps user and tool captions without loading images when previews are disabled or monochrome (%j)",
  async (options) => {
    const out = await setup(options)
    const commit = image("data:image/png;base64,AQID", "attachment.png")
    await out.scrollback.append(commit)
    await out.scrollback.append({ ...commit, kind: "tool", source: "tool", tool: "read", partID: "image-2" })
    expect(out.previews).toEqual([])
    expect(
      out.externalOutput
        .take()
        .filter((commit) => commit.text.trim())
        .map((commit) => commit.rows[0]),
    ).toEqual([`${options.mono ? ">" : "\u203a"} attachment.png`, "attachment.png"])
  },
)

test("prints a failed decode caption and continues with text", async () => {
  const out = await setup({ imagePreview: true })
  await expect(out.scrollback.append(image("data:image/png;base64,AQID", "broken.png"))).resolves.toBeUndefined()
  await out.scrollback.append({ kind: "system", source: "system", phase: "final", text: "still running" })
  const output = out.externalOutput.takeText()
  expect(output).toContain("\u203a broken.png\nNo preview")
  expect(output).toContain("still running")
  expect(out.previews[0]!.image.loadError).not.toBeNull()
  expect(out.previews[0]!.image.isDestroyed).toBe(true)
  expect(out.previews[0]!.surface.isDestroyed).toBe(true)
})

test("remeasures at load completion", async () => {
  const out = await setup({ imagePreview: true })
  const pending = out.scrollback.append(image(tall))
  await Promise.resolve()
  out.resize(40, 18)
  await pending
  expect(out.previews[0]!.size).toEqual({ width: 6, height: 11 })
})

test.each(["stream", "renderer"])("disposes an image load when the %s is destroyed", async (owner) => {
  const out = await setup({ imagePreview: true })
  const pending = out.scrollback.append(image())
  await Promise.resolve()
  const surface = Reflect.get(out.scrollback, "imageSurface") as ScrollbackSurface
  const preview = surface.root.getChildren().find((child) => child instanceof ImageRenderable)!
  expect(preview.loading).toBe(true)

  if (owner === "stream") out.scrollback.destroy()
  if (owner === "renderer") out.renderer.destroy()
  await expect(pending).resolves.toBeUndefined()
  expect(surface.isDestroyed).toBe(true)
  expect(preview.isDestroyed).toBe(true)
  expect(preview.image).toBeNull()
  expect(out.externalOutput.take()).toEqual([])
})
