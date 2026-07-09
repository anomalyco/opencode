import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For, Show } from "solid-js"
import { useBindings } from "../keymap"

export type ExportFormat = "markdown" | "json"

export type DialogExportOptionsProps = {
  defaultThinking: boolean
  defaultToolDetails: boolean
  defaultAssistantMetadata: boolean
  onConfirm?: (options: {
    action: "copy" | "export"
    format: ExportFormat
    debug: boolean
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
  }) => void
  onCancel?: () => void
}

type Active = ExportFormat | "debug" | "thinking" | "toolDetails" | "assistantMetadata" | "copy" | "export"

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    format: "markdown" as ExportFormat,
    debug: false,
    thinking: props.defaultThinking,
    toolDetails: props.defaultToolDetails,
    assistantMetadata: props.defaultAssistantMetadata,
    active: "markdown" as Active,
  })

  const confirm = (action: "copy" | "export") =>
    props.onConfirm?.({
      action,
      format: store.format,
      debug: store.debug,
      thinking: store.thinking,
      toolDetails: store.toolDetails,
      assistantMetadata: store.assistantMetadata,
    })

  const activate = () => {
    if (store.active === "markdown" || store.active === "json") {
      setStore("format", store.active)
      return
    }
    if (store.active === "debug") setStore("debug", !store.debug)
    if (store.active === "thinking") setStore("thinking", !store.thinking)
    if (store.active === "toolDetails") setStore("toolDetails", !store.toolDetails)
    if (store.active === "assistantMetadata") setStore("assistantMetadata", !store.assistantMetadata)
    if (store.active === "copy" || store.active === "export") confirm(store.active)
  }

  useBindings(() => ({
    bindings: [
      {
        key: "tab",
        desc: "Next export option",
        group: "Dialog",
        cmd: () => {
          const order: Active[] =
            store.format === "markdown"
              ? ["markdown", "json", "thinking", "toolDetails", "assistantMetadata", "copy", "export"]
              : ["markdown", "json", "debug", "copy", "export"]
          setStore("active", order[(order.indexOf(store.active) + 1) % order.length])
        },
      },
      {
        key: "return",
        desc: "Select export option",
        group: "Dialog",
        cmd: activate,
      },
    ],
  }))

  const selectFormat = (format: ExportFormat) => {
    setStore("format", format)
    setStore("active", format)
  }

  const toggle = (option: "thinking" | "toolDetails" | "assistantMetadata") => {
    setStore("active", option)
    setStore(option, !store[option])
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Export session
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={theme.text}>Export as:</text>
        <box flexDirection="row" gap={1}>
          <For each={["markdown", "json"] as const}>
            {(format) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={store.format === format ? theme.backgroundElement : undefined}
                onMouseUp={() => selectFormat(format)}
              >
                <text fg={store.format === format ? theme.text : theme.textMuted}>
                  {store.format === format ? "◉" : "○"} {format === "markdown" ? "Markdown" : "JSON"}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
      <Show when={store.format === "markdown"}>
        <box flexDirection="column">
          <For
            each={
              [
                ["thinking", "Include thinking"],
                ["toolDetails", "Include tool details"],
                ["assistantMetadata", "Include assistant metadata"],
              ] as const
            }
          >
            {(item) => (
              <box
                flexDirection="row"
                gap={1}
                backgroundColor={store.active === item[0] ? theme.backgroundElement : undefined}
                onMouseUp={() => toggle(item[0])}
              >
                <text fg={store.active === item[0] ? theme.primary : theme.textMuted}>
                  {store[item[0]] ? "[x]" : "[ ]"}
                </text>
                <text fg={store.active === item[0] ? theme.primary : theme.text}>{item[1]}</text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <Show when={store.format === "json"}>
        <box
          flexDirection="row"
          gap={1}
          backgroundColor={store.active === "debug" ? theme.backgroundElement : undefined}
          onMouseUp={() => {
            setStore("active", "debug")
            setStore("debug", !store.debug)
          }}
        >
          <text fg={store.active === "debug" ? theme.primary : theme.textMuted}>{store.debug ? "[x]" : "[ ]"}</text>
          <text fg={store.active === "debug" ? theme.primary : theme.text}>Events (debug)</text>
        </box>
      </Show>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box
          paddingLeft={4}
          paddingRight={4}
          backgroundColor={theme.backgroundElement}
          onMouseUp={() => confirm("copy")}
        >
          <text fg={theme.text}>Copy</text>
        </box>
        <box
          paddingLeft={4}
          paddingRight={4}
          backgroundColor={theme.primary}
          onMouseUp={() => confirm("export")}
        >
          <text fg={theme.selectedListItemText}>Export</text>
        </box>
      </box>
    </box>
  )
}

DialogExportOptions.show = (
  dialog: DialogContext,
  defaultThinking: boolean,
  defaultToolDetails: boolean,
  defaultAssistantMetadata: boolean,
) => {
  return new Promise<{
    action: "copy" | "export"
    format: ExportFormat
    debug: boolean
    thinking: boolean
    toolDetails: boolean
    assistantMetadata: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultThinking={defaultThinking}
          defaultToolDetails={defaultToolDetails}
          defaultAssistantMetadata={defaultAssistantMetadata}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
