/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { ImageRenderable, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import path from "node:path"
import { createSignal, Show, type JSX } from "solid-js"
import { ConfigProvider } from "../../../src/config"
import { ThemeProvider } from "../../../src/context/theme"
import { Keymap } from "../../../src/context/keymap"
import { TuiTerminalEnvironmentProvider } from "../../../src/context/runtime"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { DiffViewerImage, diffMediaKind, isDiffImageFile } from "../../../src/feature-plugins/system/diff-viewer-image"
import { diffImageFixture } from "../../fixture/diff-image"
import { renderMedia, videoFixture } from "../../fixture/media"
import { emptyThemeSource } from "../../fixture/fixture"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

test("recognizes only supported image file extensions", () => {
  for (const extension of ["png", "jpg", "jpeg", "webp", "gif", "PNG", "JPEG"]) {
    expect(isDiffImageFile(`assets/preview.${extension}`)).toBe(true)
  }
  for (const file of ["assets/preview.svg", "preview.avif", "image.png.ts", "png", "image.png/file"]) {
    expect(isDiffImageFile(file)).toBe(false)
  }
  for (const [file, richMedia, kind] of [
    ["clip.mp4", true, "video"],
    ["clip.MOV", true, "video"],
    ["clip.m4v", true, "video"],
    ["clip.mp4", false, undefined],
    ["preview.png", false, "image"],
    ["preview.png", true, "image"],
    ["clip.webm", true, undefined],
  ] as const)
    expect(diffMediaKind(file, richMedia)).toBe(kind)
})

// `reads` in both records the files the card loads itself, which a video leaves to the viewer.
test("a local server's working-tree video plays in place as a silent tile that opens the viewer", async () => {
  const directory = path.dirname(path.dirname(videoFixture))
  const reads: string[] = []
  await using setup = await renderVideo({ file: "media/video-only.mp4", directory, localServer: true, reads })
  await setup.until(() => setup.videos().length === 1)
  const video = setup.videos()[0]!
  expect(video.source).toBe(videoFixture)
  expect(video.audio).toBe(false)

  await setup.app.mockMouse.click(video.x + 2, video.y + 1)
  expect(setup.media().viewer()?.items).toMatchObject([
    { kind: "video", mime: "video/mp4", uri: `file://${videoFixture}`, location: { directory } },
  ])
  expect(reads).toEqual([])
})

test("a remote Windows server's working-tree video shows a placeholder and is read only by the viewer", async () => {
  const reads: string[] = []
  const directory = "C:\\repo"
  await using setup = await renderVideo({ file: "assets/my clip#1.mp4", directory, localServer: false, reads })
  await setup.app.renderOnce()
  expect(setup.frame()).toContain("video · my clip#1.mp4")
  expect(setup.videos()).toEqual([])

  const lines = setup.frame().split("\n")
  const y = lines.findIndex((line) => line.includes("Click to load"))
  await setup.app.mockMouse.click(lines[y]!.indexOf("Click to load") + 1, y)
  expect(setup.media().viewer()?.items).toMatchObject([
    { uri: "file:///C:/repo/assets/my%20clip%231.mp4", name: "my clip#1.mp4", location: { directory } },
  ])
  expect(reads).toEqual([])
})

test.each([
  { width: 40, height: 16, mode: "dark" as const },
  { width: 120, height: 40, mode: "light" as const },
])("renders a real image at $width columns in $mode mode", async (options) => {
  const pending = Promise.withResolvers<Uint8Array>()
  const requested: string[] = []
  const app = await renderImage(
    () => (
      <DiffViewerImage
        file="assets/landscape.png"
        load={(file) => {
          requested.push(file)
          return pending.promise
        }}
      />
    ),
    options,
  )
  try {
    await app.waitForFrame((frame) => frame.includes("Loading image…"))
    pending.resolve(diffImageFixture)
    await app.waitForFrame((frame) => frame.includes("96 x 48"))
    expect(requested).toEqual(["assets/landscape.png"])
    expect(app.captureCharFrame()).toContain("Working tree preview")
    const image = findImage(app.renderer.root)!
    expect(image.image?.width).toBe(96)
    expect(image.image?.height).toBe(48)
    expect(image.width).toBe(options.width - 2)
    expect(image.height).toBe(Math.min(8, options.height / 4))
    expect(image.fit).toBe("fit")
    expect(image.protocol).toBe("auto")
  } finally {
    app.renderer.destroy()
  }
})

test("clicking a thumbnail opens the shared image modal and escape returns to the preview", async () => {
  const app = await renderImage(() => <DiffViewerImage file="landscape.png" load={async () => diffImageFixture} />)
  try {
    await app.waitForFrame((frame) => frame.includes("Click to enlarge"))
    const thumbnail = findImage(app.renderer.root)!
    await app.mockMouse.click(thumbnail.x + Math.floor(thumbnail.width / 2), thumbnail.y + 1)
    await app.waitForFrame((frame) => frame.includes("Image 1 of 1"))
    const modal = app.renderer.root.findDescendantById("prompt-image-viewer-image")
    expect(modal).toBeInstanceOf(ImageRenderable)
    if (!(modal instanceof ImageRenderable)) throw new Error("Missing image modal")
    await app.waitFor(() => modal.image?.width === 96)
    expect(modal.image?.height).toBe(48)
    expect(modal.height).toBeGreaterThan(thumbnail.height)
    expect(app.captureCharFrame()).toContain("landscape.png")

    app.mockInput.pressEscape()
    await app.waitForFrame((frame) => !frame.includes("Image 1 of 1"))
    expect(findImage(app.renderer.root)).toBe(thumbnail)
    expect(app.captureCharFrame()).toContain("Click to enlarge")
  } finally {
    app.renderer.destroy()
  }
})

test("pending image reads are aborted when the source changes or the preview closes", async () => {
  const pending = Promise.withResolvers<Uint8Array>()
  const [file, setFile] = createSignal("a.png")
  const [visible, setVisible] = createSignal(true)
  const signals: AbortSignal[] = []
  const app = await renderImage(() => (
    <Show when={visible()}>
      <DiffViewerImage
        file={file()}
        load={(_, signal) => {
          signals.push(signal)
          return pending.promise
        }}
      />
    </Show>
  ))
  try {
    await app.waitForFrame((frame) => frame.includes("Loading image…"))
    expect(signals[0].aborted).toBe(false)
    setFile("b.png")
    await app.flush()
    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
    setVisible(false)
    await app.flush()
    expect(signals[1].aborted).toBe(true)
  } finally {
    app.renderer.destroy()
    pending.resolve(diffImageFixture)
  }
})

test.each(["fetch", "decode"])("recovers from a %s error when the file changes", async (failure) => {
  const [file, setFile] = createSignal("broken.png")
  const app = await renderImage(() => (
    <DiffViewerImage
      file={file()}
      label="Story fixture preview"
      load={async (file) => {
        if (file !== "broken.png") return diffImageFixture
        if (failure === "fetch") throw new Error("Unavailable")
        return new Uint8Array([1, 2, 3])
      }}
    />
  ))
  try {
    await app.waitForFrame((frame) =>
      frame.includes(failure === "fetch" ? "Could not load image" : "Could not decode image"),
    )
    expect(findImage(app.renderer.root)).toBeUndefined()
    setFile("landscape.png")
    await app.waitForFrame((frame) => frame.includes("96 x 48"))
    expect(app.captureCharFrame()).toContain("Story fixture preview")
    expect(app.captureCharFrame()).not.toContain("Could not")
    expect(findImage(app.renderer.root)?.image?.width).toBe(96)
  } finally {
    app.renderer.destroy()
  }
})

function renderVideo(input: { file: string; directory: string; localServer: boolean; reads: string[] }) {
  return renderMedia(
    () => (
      <TuiTerminalEnvironmentProvider value={{ platform: "linux", localServer: input.localServer }}>
        <DiffViewerImage
          file={input.file}
          location={{ directory: input.directory }}
          load={async (file) => {
            input.reads.push(file)
            return diffImageFixture
          }}
        />
      </TuiTerminalEnvironmentProvider>
    ),
    true,
  )
}

function renderImage(
  component: () => JSX.Element,
  options = { width: 80, height: 24, mode: "dark" as "dark" | "light" },
) {
  return testRender(
    () => (
      <TestTuiContexts>
        <ConfigProvider config={createTuiResolvedConfig()}>
          <Keymap.Provider>
            <ThemeProvider mode={options.mode} source={emptyThemeSource}>
              <ToastProvider>
                <DialogProvider>{component()}</DialogProvider>
              </ToastProvider>
            </ThemeProvider>
          </Keymap.Provider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { ...options, kittyKeyboard: true },
  )
}

function findImage(root: Renderable): ImageRenderable | undefined {
  if (root instanceof ImageRenderable) return root
  return root.getChildren().map(findImage).find(Boolean)
}
