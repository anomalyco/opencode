/** @jsxImportSource @opentui/solid */
import { useTerminalDimensions } from "@opentui/solid"
import type { MouseEvent } from "@opentui/core"
import { createResource, createSignal, Match, onCleanup, Show, Switch } from "solid-js"
import { DialogImagePreview } from "../../component/dialog-image-preview"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"

export function isDiffImageFile(file: string) {
  return /\.(png|jpe?g|webp|gif)$/i.test(file)
}

export function DiffViewerImage(props: {
  file: string
  load: (file: string, signal: AbortSignal) => Promise<Uint8Array>
  label?: string
}) {
  const theme = useTheme()
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const height = () => Math.max(3, Math.min(8, Math.floor(dimensions().height / 4)))
  const [image] = createResource(
    () => {
      const controller = new AbortController()
      onCleanup(() => controller.abort())
      return { file: props.file, signal: controller.signal }
    },
    (input) => props.load(input.file, input.signal),
  )

  return (
    <box width="100%" flexShrink={0} gap={1} paddingLeft={1} paddingRight={1} paddingBottom={1}>
      <text fg={theme.text.subdued}>{props.label ?? "Working tree preview"}</text>
      <box height={height() + 2} flexShrink={0} gap={1}>
        <Switch>
          <Match when={image.error}>
            <text fg={theme.text.feedback.error.default}>Could not load image</text>
          </Match>
          <Match when={image.loading}>
            <text fg={theme.text.subdued}>Loading image...</text>
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
                  fallback={<text fg={theme.text.feedback.error.default}>Could not decode image</text>}
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
                        <text fg={theme.text.subdued}>{value()}</text>
                        <text fg={theme.text.action.secondary.default} onMouseUp={open}>
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
