import { Plugin } from "@opencode-ai/plugin/tui"
import { createMemo, createSignal } from "solid-js"
import { usePlugin } from "../../plugin/use-plugin"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"

const id = "opencode.plugins"

function View(props: { context: Plugin.Context; plugins: ReturnType<typeof usePlugin> }) {
  const [locked, setLocked] = createSignal(false)
  const options = createMemo(() =>
    props.plugins
      .registered()
      .filter((plugin) => plugin.id !== id)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(
        (plugin): DialogSelectOption<string> => ({
          title: plugin.id,
          value: plugin.id,
          category: plugin.source === "builtin" ? "Built-in" : "External",
          footer: (
            <span
              style={{
                fg: plugin.active
                  ? props.context.theme.text.feedback.success.default
                  : props.context.theme.text.subdued,
              }}
            >
              {plugin.active ? "active" : "inactive"}
            </span>
          ),
        }),
      ),
  )

  const toggle = (plugin: DialogSelectOption<string>) => {
    if (locked()) return
    const current = props.plugins.registered().find((item) => item.id === plugin.value)
    if (!current) return
    setLocked(true)
    void (current.active ? props.plugins.deactivate(current.id) : props.plugins.activate(current.id))
      .then((ok) => {
        if (ok) return
        props.context.ui.toast.show({ variant: "error", message: `Failed to update plugin ${current.id}` })
      })
      .catch((error) => {
        props.context.ui.toast.show({
          variant: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      })
      .finally(() => setLocked(false))
  }

  return (
    <DialogSelect
      title="Plugins"
      options={options()}
      locked={locked()}
      preserveSelection={true}
      actions={[{ title: "toggle", command: "plugins.toggle", onTrigger: toggle }]}
      onSelect={toggle}
    />
  )
}

function Commands(props: { context: Plugin.Context }) {
  const plugins = usePlugin()
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "plugins.list",
        title: "Plugins",
        group: "System",
        palette: true,
        run() {
          props.context.ui.dialog.show(() => <View context={props.context} plugins={plugins} />)
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id,
  setup(context) {
    context.ui.slot("app", () => <Commands context={context} />)
  },
})
