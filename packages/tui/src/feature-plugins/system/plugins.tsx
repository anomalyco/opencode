import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createSignal, Show } from "solid-js"
import { usePlugin } from "../../plugin/context"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { DialogErrorDetails } from "../../component/dialog-error-details"

const id = "opencode.plugins"

function View(props: { context: Plugin.Context; plugins: ReturnType<typeof usePlugin> }) {
  const [locked, setLocked] = createSignal(false)
  const [focused, setFocused] = createSignal<string>()
  const [detail, setDetail] = createSignal<{ title: string; error: string }>()
  const dialog = useDialog()
  const options = createMemo(() => {
    const builtins = props.plugins
      .registered()
      .filter((plugin) => plugin.id !== id && plugin.source === "builtin")
      .map(
        (plugin): DialogSelectOption<string> => ({
          title: plugin.id,
          value: plugin.id,
          category: "Built-in",
          footer: plugin.active ? "active" : "inactive",
          footerColor: plugin.active
            ? props.context.theme.text.feedback.success.default
            : props.context.theme.text.subdued,
        }),
      )
    const external = props.plugins
      .list()
      .filter((plugin) => plugin.status !== "unsupported")
      .map(
        (plugin): DialogSelectOption<string> => ({
          title: plugin.id ?? plugin.target,
          value: plugin.id ?? plugin.target,
          category: "External",
          searchText: plugin.target,
          footer: plugin.status,
          footerColor:
            plugin.status === "active"
              ? props.context.theme.text.feedback.success.default
              : plugin.status === "failed"
                ? props.context.theme.text.feedback.error.default
                : props.context.theme.text.subdued,
        }),
      )
    return [...builtins, ...external].sort((a, b) => a.title.localeCompare(b.title))
  })

  const failure = (value: string | undefined) =>
    props.plugins.list().find((plugin) => {
      if (plugin.status !== "failed") return false
      return (plugin.id ?? plugin.target) === value
    })

  createEffect(() => {
    if (focused()) return
    const first = options()[0]
    if (first) setFocused(first.value)
  })

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

  const select = (plugin: DialogSelectOption<string>) => {
    const failed = failure(plugin.value)
    if (!failed || failed.status !== "failed") return toggle(plugin)
    setDetail({ title: failed.target, error: failed.error })
  }

  return (
    <box>
      <Show
        when={detail()}
        fallback={
          <DialogSelect
            title="Plugins"
            options={options()}
            locked={locked()}
            preserveSelection={true}
            onMove={(option) => setFocused(option.value)}
            actions={[
              {
                title: "toggle",
                command: "plugins.toggle",
                disabled: (option) => {
                  const failed = failure(option?.value)
                  return Boolean(failed && !("id" in failed && failed.id))
                },
                onTrigger: toggle,
              },
            ]}
            onSelect={select}
            footer={
              <Show when={failure(focused())}>
                <text fg={props.context.theme.text.subdued}>enter to view error</text>
              </Show>
            }
          />
        }
      >
        {(item) => (
          <DialogErrorDetails
            title={`Plugin: ${item().title}`}
            error={item().error}
            onBack={() => {
              setDetail()
              dialog.setSize("medium")
            }}
          />
        )}
      </Show>
    </box>
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
        slash: { name: "plugins" },
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
    context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
