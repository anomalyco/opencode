import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createMemo, createSignal } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"

type ImagePreviewItem = Readonly<{
  uri: string
  mention?: Readonly<{ text: string }>
}>

export function DialogImagePreview(props: { images: readonly ImagePreviewItem[]; initial: number }) {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const theme = useTheme("elevated")
  const [index, setIndex] = createSignal(Math.max(0, Math.min(props.images.length - 1, props.initial)))
  const [failed, setFailed] = createSignal(false)
  const current = createMemo(() => props.images[index()])
  const imageHeight = createMemo(() => Math.max(3, dimensions().height - 8))

  dialog.setSize("xlarge")
  dialog.setCentered(true)

  function move(direction: number) {
    if (props.images.length < 2) return
    setFailed(false)
    setIndex((value) => (value + direction + props.images.length) % props.images.length)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "left", title: "Previous image", group: "Dialog", run: () => move(-1) },
      { bind: "right", title: "Next image", group: "Dialog", run: () => move(1) },
    ],
  }))

  return (
    <box id="prompt-image-viewer" paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          Image {index() + 1} of {props.images.length}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <image
        id="prompt-image-viewer-image"
        source={current().uri}
        fit="fit"
        protocol="auto"
        width="100%"
        height={imageHeight()}
        onError={() => setFailed(true)}
      />
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text.subdued} onMouseUp={() => move(-1)}>
          {props.images.length > 1 ? "← previous" : ""}
        </text>
        <text fg={failed() ? theme.text.feedback.error.default : theme.text.subdued} wrapMode="none" truncate>
          {failed() ? "No preview" : (current().mention?.text ?? `Image ${index() + 1}`)}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => move(1)}>
          {props.images.length > 1 ? "next →" : ""}
        </text>
      </box>
    </box>
  )
}
