/** @jsxImportSource @opentui/solid */
import type { LocationRef } from "@opencode/client"
import { useRenderer, useTerminalDimensions } from "@opentui/solid"
import type { MouseEvent } from "@opentui/core"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { createResource, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { DialogImagePreview } from "../../component/dialog-image-preview"
import { mediaMime, type MediaItem } from "../../component/media/model"
import { isMediaClick, MediaTile } from "../../component/media/tile"
import { useRichMedia } from "../../config"
import { useMedia } from "../../context/media"
import { useTuiTerminalEnvironment } from "../../context/runtime"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"

export function isDiffImageFile(file: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(file)
}

/** The kind of working-tree preview a changed file gets; videos only with the rich media experiment. */
export function diffMediaKind(file: string, richMedia: boolean) {
  if (isDiffImageFile(file)) return "image" as const
  if (richMedia && /\.(mp4|mov|m4v)$/i.test(file)) return "video" as const
}

export function DiffViewerImage(props: {
  file: string
  load: (file: string, signal: AbortSignal) => Promise<Uint8Array>
  /** Where `file` lives; a video is played from there instead of being loaded with the card. */
  location?: LocationRef
  label?: string
}) {
  const theme = useTheme()
  const dialog = useDialog()
  const renderer = useRenderer()
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
                if (!isMediaClick(renderer, event) || !size() || failed()) return
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
                        <text fg={theme.text.action.secondary.base} selectable={false} onMouseUp={open}>
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

// A local server plays the working-tree file in place as a silent poster that plays while hovered. A remote one
// shows a placeholder and copies the file only when the viewer opens it. Either opens the media viewer on click.
function DiffViewerVideo(props: { file: string; location: LocationRef | undefined; height: number }) {
  const theme = useTheme()
  const media = useMedia()
  const renderer = useRenderer()
  const environment = useTuiTerminalEnvironment()
  const dimensions = useTerminalDimensions()
  const item = (): MediaItem | undefined => {
    const location = props.location
    if (!location) return
    // The server's paths follow its own OS, which need not be this machine's.
    const windows = /^(?:[a-z]:[\\/]|\\\\)/i.test(location.directory)
    const file = (windows ? path.win32 : path.posix).join(location.directory, props.file)
    return {
      id: file,
      kind: "video",
      mime: mediaMime(props.file) ?? "video/mp4",
      uri: pathToFileURL(file, { windows }).href,
      name: path.basename(props.file),
      location,
    }
  }
  // Cells are about twice as tall as wide, so this frames a 16:9 video.
  const width = () => Math.max(1, Math.min(dimensions().width - 2, Math.round((props.height * 32) / 9)))

  return (
    <Show when={item()} fallback={<text fg={theme.text.feedback.error.base}>Could not load video</text>}>
      {(current) => {
        const open = (event: MouseEvent) => {
          if (!isMediaClick(renderer, event)) return
          event.stopPropagation()
          media.openViewer([current()], 0)
        }
        return (
          <>
            <Show
              when={environment.localServer}
              fallback={
                <box
                  width={width()}
                  height={props.height}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={theme.background.raised.base}
                  onMouseUp={open}
                >
                  <text fg={theme.text.muted} wrapMode="none" truncate selectable={false}>
                    video · {current().name}
                  </text>
                </box>
              }
            >
              <MediaTile
                item={current()}
                width={width()}
                height={props.height}
                onOpen={() => media.openViewer([current()], 0)}
              />
            </Show>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme.text.muted}>{environment.localServer ? "Hover to play" : "Loads when opened"}</text>
              <text fg={theme.text.action.secondary.base} selectable={false} onMouseUp={open}>
                Click to open
              </text>
            </box>
          </>
        )
      }}
    </Show>
  )
}
