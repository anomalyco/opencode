/** @jsxImportSource @opentui/solid */
import type { LocationRef } from "@opencode/client"
import { useTerminalDimensions } from "@opentui/solid"
import type { MouseEvent } from "@opentui/core"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createMemo, createResource, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { DialogImagePreview } from "../../component/dialog-image-preview"
import { mediaMime, pathFlavor, type MediaItem } from "../../component/media/model"
import { MediaStrip } from "../../component/media/strip"
import { createMediaClick } from "../../component/media/tile"
import { useRichMedia } from "../../config"
import { useMedia } from "../../context/media"
import { useTuiTerminalEnvironment } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"

export function isDiffImageFile(file: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(file)
}

/** The kind of working-tree preview a changed file gets; videos only with the `rich_media` flag. */
export function diffMediaKind(file: string, richMedia: boolean) {
  if (isDiffImageFile(file)) return "image" as const
  if (richMedia && /\.(mp4|mov|m4v)$/i.test(file)) return "video" as const
}

export function DiffViewerImage(props: {
  file: string
  load: (file: string, signal: AbortSignal) => Promise<Uint8Array>
  location?: LocationRef
  label?: string
}) {
  const theme = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const richMedia = useRichMedia()
  const video = () => diffMediaKind(props.file, richMedia()) === "video"
  const height = () => Math.max(3, Math.min(8, Math.floor(dimensions().height / 4)))
  const [image] = createResource(
    () => {
      if (video()) return false
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      return { file: props.file, signal: controller.signal }
    },
    (input) => props.load(input.file, input.signal),
  )

  return (
    <box width="100%" flexShrink={0} gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
      <text fg={theme.text.muted}>{props.label ?? "Working tree preview"}</text>
      <box height={height() + 2} flexShrink={0} gap={1}>
        <Switch>
          <Match when={video()}>
            <DiffViewerVideo file={props.file} location={props.location} height={height()} />
          </Match>
          <Match when={image.error}>
            <text fg={theme.text.feedback.error.base}>Could not load image</text>
          </Match>
          <Match when={image.loading}>
            <text fg={theme.text.muted}>Loading image…</text>
          </Match>
          <Match when={!image.error && image()} keyed>
            {(bytes) => {
              const [failed, setFailed] = createSignal(false)
              const [size, setSize] = createSignal<string>()
              const open = (event: MouseEvent) => {
                if (event.button !== 0 || !size() || failed()) return
                event.stopPropagation()
                dialog.replace(() => (
                  <DialogImagePreview
                    images={[
                      {
                        uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
                        mention: { text: props.file },
                      },
                    ]}
                    initial={0}
                  />
                ))
              }
              return (
                <Show
                  when={!failed()}
                  fallback={<text fg={theme.text.feedback.error.base}>Could not decode image</text>}
                >
                  <box width="100%" height={height()} onMouseUp={open}>
                    <image
                      id={`diff-image-${props.file}`}
                      source={bytes}
                      fit="fit"
                      protocol="auto"
                      width="100%"
                      height="100%"
                      onLoad={(loaded) => setSize(`${loaded.width} x ${loaded.height}`)}
                      onError={() => setFailed(true)}
                    />
                  </box>
                  <Show when={size()}>
                    {(value) => (
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.text.muted}>{value()}</text>
                        <text fg={theme.text.action.secondary.base} onMouseUp={open}>
                          Click to enlarge
                        </text>
                      </box>
                    )}
                  </Show>
                </Show>
              )
            }}
          </Match>
        </Switch>
      </box>
    </box>
  )
}

// A local server plays the working-tree file in place. A remote one shows a placeholder and copies the file only when
// the viewer opens it.
function DiffViewerVideo(props: { file: string; location: LocationRef | undefined; height: number }) {
  const theme = useTheme()
  const media = useMedia()
  const environment = useTuiTerminalEnvironment()
  const dimensions = useTerminalDimensions()
  const item = createMemo((): MediaItem | undefined => {
    const location = props.location
    if (!location) return
    // The server's paths follow its own OS, which need not be this machine's.
    const flavor = pathFlavor(location.directory)
    const file = flavor.join(location.directory, props.file)
    const uri = pathToFileURL(file, { windows: flavor === path.win32 }).href
    return { id: file, kind: "video", mime: mediaMime(file) ?? "video/mp4", uri, name: flavor.basename(file), location }
  })
  const open = () => media.openViewer([item()!], 0)
  const click = createMediaClick(open)

  return (
    <Show when={item()} fallback={<text fg={theme.text.feedback.error.base}>Could not load video</text>}>
      {(current) => (
        <Show
          when={environment.localServer}
          fallback={
            <box
              width={Math.round((props.height * 32) / 9)}
              height={props.height}
              alignItems="center"
              justifyContent="center"
              backgroundColor={theme.background.raised.base}
              {...click}
            >
              <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                video · {current().name}
              </text>
              <text fg={theme.text.muted} selectable={false}>
                Click to load
              </text>
            </box>
          }
        >
          <MediaStrip items={[current()]} width={dimensions().width - 2} height={props.height} onOpen={open} />
        </Show>
      )}
    </Show>
  )
}
