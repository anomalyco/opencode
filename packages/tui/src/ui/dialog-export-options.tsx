import { Keymap } from "../context/keymap"
import { useNewDesigns } from "../config"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, type DialogContext } from "./dialog"
import { DialogSelect, DialogSelectChoice } from "./dialog-select"
import { createStore } from "solid-js/store"
import { createMemo, createSignal, For, Show } from "solid-js"

export type ExportFormat = "markdown" | "json"

export type DialogExportOptionsProps = {
  defaultThinking: boolean
  onConfirm?: (options: {
    action: "copy" | "export"
    format: ExportFormat
    thinking: boolean
    tools: boolean
    sanitize: boolean
  }) => void
  onCancel?: () => void
}

type Active = ExportFormat | "thinking" | "tools" | "sanitize" | "copy" | "export"

export function DialogExportOptions(props: DialogExportOptionsProps) {
  const newDesigns = useNewDesigns()
  return (
    <Show when={newDesigns()} fallback={<LegacyDialogExportOptions {...props} />}>
      <DialogExportOptionsList {...props} />
    </Show>
  )
}

type Row = "format" | "thinking" | "tools" | "sanitize"

/** Export options as a list of values, under the "new-designs" experiment: ↑/↓ moves, ←/→ or space changes. */
function DialogExportOptionsList(props: DialogExportOptionsProps) {
  const [store, setStore] = createStore({
    format: "markdown" as ExportFormat,
    thinking: props.defaultThinking,
    tools: true,
    sanitize: false,
  })
  const [selected, setSelected] = createSignal<Row>("format")

  const confirm = (action: "copy" | "export") =>
    props.onConfirm?.({
      action,
      format: store.format,
      thinking: store.thinking,
      tools: store.tools,
      sanitize: store.sanitize,
    })

  const change = (row: Row) => {
    if (row === "format") return setStore("format", store.format === "markdown" ? "json" : "markdown")
    setStore(row, !store[row])
  }

  const include = (value: boolean) => (value ? "include" : "exclude")
  const options = createMemo(() => [
    {
      title: "Format",
      value: "format" as Row,
      onSelect: () => change("format"),
      footerOverhang: 2,
      footer: <DialogSelectChoice value={store.format} active={selected() === "format"} />,
    },
    ...(store.format === "markdown"
      ? [
          {
            title: "Thinking",
            value: "thinking" as Row,
            onSelect: () => change("thinking"),
            category: "Options",
            footerOverhang: 2,
            footer: <DialogSelectChoice value={include(store.thinking)} active={selected() === "thinking"} />,
          },
          {
            title: "Tools",
            value: "tools" as Row,
            onSelect: () => change("tools"),
            category: "Options",
            footerOverhang: 2,
            footer: <DialogSelectChoice value={include(store.tools)} active={selected() === "tools"} />,
          },
        ]
      : [
          {
            title: "Sanitize",
            value: "sanitize" as Row,
            onSelect: () => change("sanitize"),
            category: "Options",
            footerOverhang: 2,
            footer: <DialogSelectChoice value={store.sanitize ? "on" : "off"} active={selected() === "sanitize"} />,
          },
        ]),
  ])

  return (
    <DialogSelect
      title="Export session"
      renderFilter={false}
      footerGap={2}
      options={options()}
      onMove={(option) => setSelected(option.value)}
      actions={[
        {
          command: "dialog.export.copy",
          title: "copy",
          bind: "c",
          selection: "none",
          group: "primary",
          onTrigger: () => confirm("copy"),
        },
      ]}
      footerHints={[{ title: "save to file", label: "enter", group: "primary" }]}
      bindings={[
        { bind: "left", title: "Previous value", group: "Dialog", run: () => change(selected()) },
        { bind: "right", title: "Next value", group: "Dialog", run: () => change(selected()) },
        { bind: "space", title: "Change export option", group: "Dialog", run: () => change(selected()) },
        { bind: "return", title: "Save to file", group: "Dialog", run: () => confirm("export") },
      ]}
    />
  )
}

function LegacyDialogExportOptions(props: DialogExportOptionsProps) {
  const theme = useTheme().surface("dialog")
  // Same field styling as the question form: only the focused row is highlighted, and the
  // mark alone shows what's checked.
  const markColor = (active: boolean, checked: boolean) =>
    active ? theme.text.formfield.focused : checked ? theme.text.formfield.selected : theme.text.muted
  const labelColor = (active: boolean) => (active ? theme.text.formfield.focused : theme.text.formfield.base)
  const [store, setStore] = createStore({
    format: "markdown" as ExportFormat,
    thinking: props.defaultThinking,
    tools: true,
    sanitize: false,
    active: "markdown" as Active,
  })

  const confirm = (action: "copy" | "export") =>
    props.onConfirm?.({
      action,
      format: store.format,
      thinking: store.thinking,
      tools: store.tools,
      sanitize: store.sanitize,
    })

  const activate = () => {
    if (store.active === "markdown" || store.active === "json") {
      setStore("format", store.active)
      return
    }
    if (store.active === "thinking") setStore("thinking", !store.thinking)
    if (store.active === "tools") setStore("tools", !store.tools)
    if (store.active === "sanitize") setStore("sanitize", !store.sanitize)
    if (store.active === "copy" || store.active === "export") confirm(store.active)
  }

  const move = (offset: number) => {
    const options: Active[] =
      store.format === "markdown" ? ["markdown", "json", "thinking", "tools"] : ["markdown", "json", "sanitize"]
    const order: Active[] = [...options, "copy", "export"]
    setStore("active", order[(order.indexOf(store.active) + offset + order.length) % order.length])
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "tab", title: "Next export option", group: "Dialog", run: () => move(1) },
      { bind: "shift+tab", title: "Previous export option", group: "Dialog", run: () => move(-1) },
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
    <DialogLayout
      header={<DialogHeader title="Export session" />}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end" gap={1}>
          <box
            paddingLeft={4}
            paddingRight={4}
            backgroundColor={
              store.active === "copy" ? theme.background.action.primary.focused : theme.background.action.primary.base
            }
            onMouseUp={() => confirm("copy")}
          >
            <text fg={store.active === "copy" ? theme.text.action.primary.focused : theme.text.action.primary.base}>
              Copy
            </text>
          </box>
          <box
            paddingLeft={4}
            paddingRight={4}
            backgroundColor={
              store.active === "export" ? theme.background.action.primary.focused : theme.background.action.primary.base
            }
            onMouseUp={() => confirm("export")}
          >
            <text fg={store.active === "export" ? theme.text.action.primary.focused : theme.text.action.primary.base}>
              Export
            </text>
          </box>
        </box>
      }
    >
      <box gap={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text.base}>Export as:</text>
          <box flexDirection="row" gap={1}>
            <For each={["markdown", "json"] as const}>
              {(format) => (
                <box
                  flexDirection="row"
                  gap={1}
                  paddingLeft={1}
                  paddingRight={1}
                  onMouseUp={() => selectFormat(format)}
                >
                  <text fg={markColor(store.active === format, store.format === format)}>
                    {store.format === format ? "◉" : "○"}
                  </text>
                  <text fg={labelColor(store.active === format)}>{format === "markdown" ? "Markdown" : "JSON"}</text>
                </box>
              )}
            </For>
          </box>
        </box>
        <Show when={store.format === "markdown"}>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setStore("active", "thinking")
              setStore("thinking", !store.thinking)
            }}
          >
            <text fg={markColor(store.active === "thinking", store.thinking)}>{store.thinking ? "[x]" : "[ ]"}</text>
            <text fg={labelColor(store.active === "thinking")}>Include thinking</text>
          </box>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setStore("active", "tools")
              setStore("tools", !store.tools)
            }}
          >
            <text fg={markColor(store.active === "tools", store.tools)}>{store.tools ? "[x]" : "[ ]"}</text>
            <text fg={labelColor(store.active === "tools")}>Include tools</text>
          </box>
        </Show>
        <Show when={store.format === "json"}>
          <box
            flexDirection="row"
            gap={1}
            onMouseUp={() => {
              setStore("active", "sanitize")
              setStore("sanitize", !store.sanitize)
            }}
          >
            <text fg={markColor(store.active === "sanitize", store.sanitize)}>{store.sanitize ? "[x]" : "[ ]"}</text>
            <text fg={labelColor(store.active === "sanitize")}>Sanitize sensitive data</text>
          </box>
        </Show>
      </box>
    </DialogLayout>
  )
}

DialogExportOptions.show = (dialog: DialogContext, defaultThinking: boolean) => {
  return new Promise<{
    action: "copy" | "export"
    format: ExportFormat
    thinking: boolean
    tools: boolean
    sanitize: boolean
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
