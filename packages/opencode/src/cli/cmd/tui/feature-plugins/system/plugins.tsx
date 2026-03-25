import { Keybind } from "@/util/keybind"
import type { TuiPlugin, TuiPluginApi, TuiPluginStatus } from "@opencode-ai/plugin/tui"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { createMemo, createSignal } from "solid-js"

const id = "internal:plugin-manager"
const key = Keybind.parse("space").at(0)

function state(api: TuiPluginApi, item: TuiPluginStatus) {
  return (
    <span style={{ fg: item.active ? api.theme.current.success : api.theme.current.error }}>
      {item.active ? "active" : "inactive"}
    </span>
  )
}

function row(api: TuiPluginApi, item: TuiPluginStatus): DialogSelectOption<string> {
  return {
    title: item.name,
    value: item.id,
    category: item.source === "internal" ? "Internal" : "External",
    description: item.source === "internal" ? "Built-in" : item.spec,
    footer: state(api, item),
    disabled: item.id === id,
  }
}

function View(props: { api: TuiPluginApi }) {
  const [list, setList] = createSignal(props.api.plugins.list())
  const [cur, setCur] = createSignal<string | undefined>()
  const [lock, setLock] = createSignal(false)
  const rows = createMemo(() =>
    [...list()]
      .sort((a, b) => {
        const x = a.source === "internal" ? 1 : 0
        const y = b.source === "internal" ? 1 : 0
        if (x !== y) return x - y
        return a.name.localeCompare(b.name)
      })
      .map((item) => row(props.api, item)),
  )

  const flip = (x: string) => {
    if (lock()) return
    const item = list().find((entry) => entry.id === x)
    if (!item) return
    setLock(true)
    const task = item.active ? props.api.plugins.deactivate(x) : props.api.plugins.activate(x)
    task
      .then((ok) => {
        if (!ok) {
          props.api.ui.toast({
            variant: "error",
            message: `Failed to update plugin ${item.name}`,
          })
        }
        setList(props.api.plugins.list())
      })
      .finally(() => {
        setLock(false)
      })
  }

  return (
    <DialogSelect
      title="Plugins"
      options={rows()}
      current={cur()}
      onMove={(item) => setCur(item.value)}
      keybind={[
        {
          title: "toggle",
          keybind: key,
          disabled: lock(),
          onTrigger: (item) => {
            setCur(item.value)
            flip(item.value)
          },
        },
      ]}
      onSelect={(item) => {
        setCur(item.value)
        flip(item.value)
      }}
    />
  )
}

function show(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <View api={api} />)
}

const tui: TuiPlugin = async (api) => {
  api.command.register(() => [
    {
      title: "Plugins",
      value: "plugins.list",
      keybind: "plugin_manager",
      category: "System",
      onSelect() {
        show(api)
      },
    },
  ])
}

export default {
  id,
  tui,
}
