import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { onMount, Show, type JSX } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export type DialogExportOptionsProps = {
  defaultFilename: string
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  defaultOpenWithoutSaving: boolean
  onConfirm?: (options: {
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  }) => void
  onCancel?: () => void
}

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable
  const [store, setStore] = createStore({
    thinking: props.defaultThinking,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    openWithoutSaving: props.defaultOpenWithoutSaving,
    active: "filename" as "filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving",
  })

  useKeyboard((evt) => {
    if (evt.name === "return") {
      props.onConfirm?.({
        filename: textarea.plainText,
        thinking: store.thinking,
        toolDetails: store.toolDetails,
        assistantMetadata: store.assistantMetadata,
        openWithoutSaving: store.openWithoutSaving,
      })
    }
    if (evt.name === "tab") {
      const order: Array<"filename" | "thinking" | "toolDetails" | "assistantMetadata" | "openWithoutSaving"> = [
        "filename",
        "thinking",
        "toolDetails",
        "assistantMetadata",
        "openWithoutSaving",
      ]
      const currentIndex = order.indexOf(store.active)
      const nextIndex = (currentIndex + 1) % order.length
      setStore("active", order[nextIndex])
      evt.preventDefault()
    }
    if (evt.name === "space") {
      if (store.active === "thinking") setStore("thinking", !store.thinking)
      if (store.active === "toolDetails") setStore("toolDetails", !store.toolDetails)
      if (store.active === "assistantMetadata") setStore("assistantMetadata", !store.assistantMetadata)
      if (store.active === "openWithoutSaving") setStore("openWithoutSaving", !store.openWithoutSaving)
      evt.preventDefault()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      textarea.focus()
    }, 1)
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Export Options
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <box>
          <text fg={theme.text}>Filename:</text>
        </box>
        <textarea
          onSubmit={() => {
            props.onConfirm?.({
              filename: textarea.plainText,
              thinking: store.thinking,
              toolDetails: store.toolDetails,
              assistantMetadata: store.assistantMetadata,
              openWithoutSaving: store.openWithoutSaving,
            })
          }}
          height={3}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.defaultFilename}
          placeholder="Enter filename"
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box flexDirection="column">
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "thinking" ? theme.backgroundElement : undefined}
          onMouseUp={() => setStore("active", "thinking")}
        >
          <text fg={store.active === "thinking" ? theme.primary : theme.textMuted}>
            {store.thinking ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "thinking" ? theme.primary : theme.text}>Include thinking</text>
        </box>
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "toolDetails" ? theme.backgroundElement : undefined}
          onMouseUp={() => setStore("active", "toolDetails")}
        >
          <text fg={store.active === "toolDetails" ? theme.primary : theme.textMuted}>
            {store.toolDetails ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "toolDetails" ? theme.primary : theme.text}>Include tool details</text>
        </box>
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "assistantMetadata" ? theme.backgroundElement : undefined}
          onMouseUp={() => setStore("active", "assistantMetadata")}
        >
          <text fg={store.active === "assistantMetadata" ? theme.primary : theme.textMuted}>
            {store.assistantMetadata ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "assistantMetadata" ? theme.primary : theme.text}>Include assistant metadata</text>
        </box>
        <box
          flexDirection="row"
          gap={2}
          paddingLeft={1}
          backgroundColor={store.active === "openWithoutSaving" ? theme.backgroundElement : undefined}
          onMouseUp={() => setStore("active", "openWithoutSaving")}
        >
          <text fg={store.active === "openWithoutSaving" ? theme.primary : theme.textMuted}>
            {store.openWithoutSaving ? "[x]" : "[ ]"}
          </text>
          <text fg={store.active === "openWithoutSaving" ? theme.primary : theme.text}>Open without saving</text>
        </box>
      </box>
      <Show when={store.active !== "filename"}>
        <text fg={theme.textMuted} paddingBottom={1}>
          Press <span style={{ fg: theme.text }}>space</span> to toggle, <span style={{ fg: theme.text }}>return</span>{" "}
          to confirm
        </text>
      </Show>
      <Show when={store.active === "filename"}>
        <text fg={theme.textMuted} paddingBottom={1}>
          Press <span style={{ fg: theme.text }}>return</span> to confirm, <span style={{ fg: theme.text }}>tab</span>{" "}
          for options
        </text>
      </Show>
    </box>
  )
}

DialogExportOptions.show = (
  dialog: DialogContext,
  defaultFilename: string,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
  defaultOpenWithoutSaving: boolean,
) => {
  return new Promise<{
    filename: string
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
    openWithoutSaving: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultFilename={defaultFilename}
          defaultThinking={defaultThinking}
          defaultToolDetails={defaultToolDetails}
          defaultAssistantMetadata={defaultAssistantMetadata}
          defaultOpenWithoutSaving={defaultOpenWithoutSaving}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
