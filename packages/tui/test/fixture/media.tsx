/** @jsxImportSource @opentui/solid */
import { VideoRenderable, type Clock, type Renderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { expect } from "bun:test"
import path from "node:path"
import { createSignal, Show, type JSX } from "solid-js"
import "../../src/component/media/viewer"
import type { MediaItem } from "../../src/component/media/model"
import { ConfigProvider, useConfig, type Info } from "../../src/config"
import { Keymap } from "../../src/context/keymap"
import { MediaHost, MediaProvider, useMedia } from "../../src/context/media"
import { ThemeProvider } from "../../src/context/theme"
import { DialogProvider, useDialog } from "../../src/ui/dialog"
import { Toast, ToastProvider, useToast } from "../../src/ui/toast"
import { emptyThemeSource, tmpdir } from "./fixture"
import { TestTuiContexts } from "./tui-environment"
import { createTuiResolvedConfig } from "./tui-runtime"

// 2 s and 4 s 160x90 H.264 clips without audio: ffmpeg -f lavfi -i testsrc2=size=160x90:rate=10 -t 2 -c:v libx264 -an
export const videoFixture = path.join(import.meta.dir, "media", "video-only.mp4")
export const longVideoFixture = path.join(import.meta.dir, "media", "video-long.mp4")
/** A 20 s 64x36 clip at 2 fps, long enough for 5 s seeks to add up: testsrc2=size=64x36:rate=2 -t 20, as above. */
export const seekVideoFixture = path.join(import.meta.dir, "media", "video-seek.mp4")
/** A 96x48 PNG, the bytes of `diffImageFixture`. */
export const imageFixture = path.join(import.meta.dir, "media", "image.png")

export function video(id: string, item?: Partial<MediaItem>): MediaItem {
  return { id, kind: "video", mime: "video/mp4", uri: "", name: `${id}.mp4`, path: videoFixture, ...item }
}
export function image(id: string, item?: Partial<MediaItem>): MediaItem {
  return video(id, { kind: "image", mime: "image/png", name: `${id}.png`, path: imageFixture, ...item })
}

const probe = () => ({
  media: useMedia(),
  keymap: Keymap.use(),
  dialog: useDialog(),
  toast: useToast(),
  config: useConfig(),
})

/**
 * Renders `view` inside the media provider and host, which shows the real viewer and PiP, toasts, and what they need.
 * The `clock` drives the renderer's timers, such as the seek bar's; playback follows the wall clock regardless.
 */
export async function renderMedia(view: () => JSX.Element, richMedia = false, clock?: Clock) {
  const temporary = await tmpdir()
  const info: Info = { experimental: { rich_media: richMedia } }
  const service = {
    get: async () => info,
    update: async (update: (draft: Info) => void) => {
      update(info)
      return info
    },
  }
  let contexts: ReturnType<typeof probe> | undefined
  const [mounted, setMounted] = createSignal(true)
  function Probe() {
    contexts = probe()
    return null
  }
  const app = await testRender(
    () => (
      <TestTuiContexts directory={temporary.path} paths={{ state: temporary.path }}>
        <ConfigProvider config={createTuiResolvedConfig(info)} service={service}>
          <ThemeProvider mode="dark" source={emptyThemeSource}>
            <Keymap.Provider>
              <ToastProvider>
                <DialogProvider>
                  <Show when={mounted()}>
                    <MediaProvider directory={path.join(temporary.path, "media")}>
                      <Probe />
                      {view()}
                      <MediaHost />
                      <Toast />
                    </MediaProvider>
                  </Show>
                </DialogProvider>
              </ToastProvider>
            </Keymap.Provider>
          </ThemeProvider>
        </ConfigProvider>
      </TestTuiContexts>
    ),
    { width: 80, height: 30, kittyKeyboard: true, clock },
  )
  // Playback and file resolution follow the wall clock, so poll with short sleeps between frames.
  async function until(condition: () => boolean) {
    const deadline = Date.now() + 5_000
    while (!condition() && Date.now() < deadline) {
      await Bun.sleep(5)
      await app.renderOnce()
    }
    if (!condition()) console.log(app.captureCharFrame())
    expect(condition()).toBe(true)
  }
  async function press(key: string) {
    const arrow = /^(shift\+)?(left|right|up|down)$/.exec(key)
    if (arrow) app.mockInput.pressArrow(arrow[2] as "left", { shift: arrow[1] !== undefined })
    else app.mockInput.pressKey(key)
    await app.renderOnce()
  }
  await until(() => contexts !== undefined)
  const find = (id: string) => descendants(app.renderer.root).find((node) => node.id === id)
  return {
    media: () => contexts!.media,
    keymap: () => contexts!.keymap,
    dialog: () => contexts!.dialog,
    toast: () => contexts!.toast,
    app,
    until,
    press,
    find,
    directory: path.join(temporary.path, "media"),
    /** Unmounts the media provider and everything inside it. */
    unmount: () => setMounted(false),
    setRichMedia: (enabled: boolean) =>
      contexts!.config.update((draft) => (draft.experimental = { rich_media: enabled })),
    frame: () => app.captureCharFrame(),
    videos: (id?: string) =>
      descendants(id ? find(id)! : app.renderer.root).filter((node) => node instanceof VideoRenderable),
    async [Symbol.asyncDispose]() {
      app.renderer.destroy()
      await temporary[Symbol.asyncDispose]()
    },
  }
}

export function descendants(node: Renderable): Renderable[] {
  return node.getChildren().flatMap((child) => [child, ...descendants(child as Renderable)])
}
