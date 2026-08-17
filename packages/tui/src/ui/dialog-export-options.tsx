import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For, Show } from "solid-js"

export type ExportFormat = "markdown" | "json"

export type DialogExportOptionsProps = {
  defaultThinking: boolean
  onConfirm?: (options: { action: "copy" | "export"; format: ExportFormat; debug: boolean; thinking: boolean }) => void
  onCancel?: () => void
}

type Active = ExportFormat | "debug" | "thinking" | "copy" | "export"

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const dialog = useDialog()
  const { themeV2 } = useTheme().contextual("elevated")
  const { themeV2: overlayTheme } = useTheme().contextual("overlay")
  const [store, setStore] = createStore({
    format: "markdown" as ExportFormat,
    debug: false,
    thinking: props.defaultThinking,
    active: "markdown" as Active,
  })

  const confirm = (action: "copy" | "export") =>
    props.onConfirm?.({
      action,
      format: store.format,
      debug: store.debug,
      thinking: store.thinking,
    })

  const activate = () => {
    if (store.active === "markdown" || store.active === "json") {
      setStore("format", store.active)
      return
    }
    if (store.active === "debug") setStore("debug", !store.debug)
    if (store.active === "thinking") setStore("thinking", !store.thinking)
    if (store.active === "copy" || store.active === "export") confirm(store.active)
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "tab",
        title: "Next export option",
        group: "Dialog",
        run: () => {
          const order: Active[] =
            store.format === "markdown"
              ? ["markdown", "json", "thinking", "copy", "export"]
              : ["markdown", "json", "debug", "copy", "export"]
          setStore("active", order[(order.indexOf(store.active) + 1) % order.length])
        },
      },
      {
        bind: "return",
        title: "Select export option",
        group: "Dialog",
        run: activate,
      },
    ],
  }))

  const selectFormat = (format: ExportFormat) => {
    setStore("format", format)
    setStore("active", format)
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          Export session
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box flexDirection="row" gap={1}>
        <text fg={themeV2.text()}>Export as:</text>
        <box flexDirection="row" gap={1}>
          <For each={["markdown", "json"] as const}>
            {(format) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={themeV2.background.formfield({
                  focused: store.active === format,
                  selected: store.format === format,
                })}
                onMouseUp={() => selectFormat(format)}
              >
                <text
                  fg={themeV2.text.formfield({
                    focused: store.active === format,
                    selected: store.format === format,
                  })}
                >
                  {store.format === format ? "◉" : "○"} {format === "markdown" ? "Markdown" : "JSON"}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
      <Show when={store.format === "markdown"}>
        <box
          flexDirection="row"
          gap={1}
          backgroundColor={themeV2.background.formfield({
            focused: store.active === "thinking",
            selected: store.thinking,
          })}
          onMouseUp={() => {
            setStore("active", "thinking")
            setStore("thinking", !store.thinking)
          }}
        >
          <text fg={themeV2.text.formfield({ focused: store.active === "thinking", selected: store.thinking })}>
            {store.thinking ? "[x]" : "[ ]"}
          </text>
          <text fg={themeV2.text.formfield({ focused: store.active === "thinking", selected: store.thinking })}>
            Include thinking
          </text>
        </box>
      </Show>
      <Show when={store.format === "json"}>
        <box
          flexDirection="row"
          gap={1}
          backgroundColor={themeV2.background.formfield({
            focused: store.active === "debug",
            selected: store.debug,
          })}
          onMouseUp={() => {
            setStore("active", "debug")
            setStore("debug", !store.debug)
          }}
        >
          <text fg={themeV2.text.formfield({ focused: store.active === "debug", selected: store.debug })}>
            {store.debug ? "[x]" : "[ ]"}
          </text>
          <text fg={themeV2.text.formfield({ focused: store.active === "debug", selected: store.debug })}>
            Events (debug)
          </text>
        </box>
      </Show>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box
          paddingLeft={4}
          paddingRight={4}
          backgroundColor={overlayTheme.background()}
          onMouseUp={() => confirm("copy")}
        >
          <text fg={overlayTheme.text()}>Copy</text>
        </box>
        <box
          paddingLeft={4}
          paddingRight={4}
          backgroundColor={themeV2.background.action({ focused: store.active === "export" })}
          onMouseUp={() => confirm("export")}
        >
          <text fg={themeV2.text.action({ focused: store.active === "export" })}>Export</text>
        </box>
      </box>
    </box>
  )
}

DialogExportOptions.show = (dialog: DialogContext, defaultThinking: boolean) => {
  return new Promise<{
    action: "copy" | "export"
    format: ExportFormat
    debug: boolean
    thinking: boolean
  } | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogExportOptions
          defaultThinking={defaultThinking}
          onConfirm={(options) => resolve(options)}
          onCancel={() => resolve(null)}
        />
      ),
      () => resolve(null),
    )
  })
}
