import type { PluginInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import { DialogErrorDetails } from "../../component/dialog-error-details"
import { usePlugin } from "../../plugin/context"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"

const id = "opencode.plugins"

type Entry =
  | { readonly key: string; readonly runtime: "server"; readonly plugin: PluginInfo }
  | {
      readonly key: string
      readonly runtime: "tui"
      readonly id?: string
      readonly target: string
      readonly status: "active" | "inactive" | "failed"
      readonly error?: string
    }

export function PluginsDialog(props: {
  context: Plugin.Context
  plugins: ReturnType<typeof usePlugin>
  server?: () => readonly PluginInfo[]
}) {
  const dialog = useDialog()
  const [locked, setLocked] = createSignal(false)
  const [focused, setFocused] = createSignal<string>()
  const [detail, setDetail] = createSignal<Entry>()
  const [initial, setInitial] = createSignal<string>()
  const [server] = createResource(
    () => (props.server ? undefined : (props.context.location ?? props.context.data.location.default())),
    (location) => props.context.client.plugin.list({ location }).then((result) => result.data),
  )
  onMount(() => dialog.setSize("medium"))
  const entries = createMemo<Entry[]>(() => {
    const builtins: Entry[] = props.plugins
      .registered()
      .filter((plugin) => plugin.id !== id && plugin.source === "builtin")
      .map((plugin) => ({
        key: `tui:${plugin.id}`,
        runtime: "tui" as const,
        id: plugin.id,
        target: plugin.id,
        status: plugin.active ? ("active" as const) : ("inactive" as const),
      }))
    const external: Entry[] = props.plugins
      .list()
      .filter((plugin) => plugin.status !== "unsupported")
      .map((plugin) => ({
        key: `tui:${plugin.id ?? plugin.target}`,
        runtime: "tui" as const,
        id: plugin.id,
        target: plugin.target,
        status: plugin.status,
        error: plugin.status === "failed" ? plugin.error : undefined,
      }))
    const serverEntries: Entry[] = (props.server?.() ?? server() ?? []).map((plugin) => ({
      key: `server:${plugin.id ?? source(plugin, props.context)}`,
      runtime: "server" as const,
      plugin,
    }))
    return [
      ...[...builtins, ...external].sort((a, b) => label(a, props.context).localeCompare(label(b, props.context))),
      ...serverEntries.sort((a, b) => label(a, props.context).localeCompare(label(b, props.context))),
    ]
  })
  createEffect(() => {
    if (initial()) return
    const first = entries().find((entry) => entry.runtime === "tui")
    if (!first) return
    setInitial(first.key)
    setFocused(first.key)
  })

  const options = createMemo(() =>
    entries().map(
      (entry): DialogSelectOption<string> => ({
        title: label(entry, props.context),
        value: entry.key,
        category: entry.runtime === "tui" ? "TUI" : "Server",
        searchText: entry.runtime === "tui" ? entry.target : source(entry.plugin, props.context),
        footer: status(entry) === "active" ? undefined : status(entry),
        footerColor:
          status(entry) === "failed"
            ? props.context.theme.text.feedback.error.default
            : props.context.theme.text.subdued,
        gutter:
          status(entry) === "active"
            ? () => <text fg={props.context.theme.text.feedback.success.default}>✓</text>
            : status(entry) === "failed"
              ? () => <text fg={props.context.theme.text.feedback.error.default}>✗</text>
              : undefined,
      }),
    ),
  )
  const focusedEntry = createMemo(() => entries().find((entry) => entry.key === focused()))
  const focusedTui = createMemo(() => {
    const entry = focusedEntry()
    if (entry?.runtime !== "tui" || !entry.id) return
    return entry
  })
  const toggleTitle = createMemo(() => {
    const entry = focusedTui()
    if (!entry) return "toggle"
    return props.plugins.registered().find((plugin) => plugin.id === entry.id)?.active ? "disable" : "enable"
  })
  const toggle = (entry: Entry | undefined) => {
    if (locked() || entry?.runtime !== "tui" || !entry.id) return
    const current = props.plugins.registered().find((plugin) => plugin.id === entry.id)
    if (!current) return
    setLocked(true)
    void (current.active ? props.plugins.deactivate(current.id) : props.plugins.activate(current.id))
      .then((ok) => {
        if (ok) return
        props.context.ui.toast.show({ variant: "error", message: `Failed to update plugin ${current.id}` })
      })
      .catch((cause) => {
        props.context.ui.toast.show({
          variant: "error",
          message: cause instanceof Error ? cause.message : String(cause),
        })
      })
      .finally(() => setLocked(false))
  }

  return (
    <box>
      <Show
        when={detail()}
        fallback={
          <DialogSelect
            title="Plugins"
            options={options()}
            current={initial()}
            locked={locked()}
            preserveSelection={true}
            onMove={(option) => setFocused(option.value)}
            onSelect={(option) => {
              const entry = entries().find((entry) => entry.key === option.value)
              if (pluginError(entry)) setDetail(entry)
            }}
            actions={
              focusedTui()
                ? [
                    {
                      title: toggleTitle(),
                      command: "plugins.toggle",
                      onTrigger: (option) => toggle(entries().find((entry) => entry.key === option.value)),
                    },
                  ]
                : []
            }
            footer={
              <Show when={pluginError(focusedEntry())}>
                <text>
                  <span style={{ fg: props.context.theme.text.default }}>
                    <b>enter</b>
                  </span>
                  <span style={{ fg: props.context.theme.text.subdued }}> view error</span>
                </text>
              </Show>
            }
          />
        }
      >
        {(entry) => (
          <DialogErrorDetails
            title={`${entry().runtime === "tui" ? "TUI" : "Server"} plugin: ${label(entry(), props.context)}`}
            error={pluginError(entry()) ?? "Unknown plugin error"}
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

function label(entry: Entry, context: Plugin.Context) {
  if (entry.runtime === "tui") return entry.id ?? entry.target
  return entry.plugin.id ?? source(entry.plugin, context)
}

function source(plugin: PluginInfo, context: Plugin.Context) {
  if (plugin.source.type === "package") return plugin.source.package
  if (plugin.source.type === "local") return context.ui.format.path(plugin.source.path)
  return plugin.source.type
}

function status(entry: Entry) {
  if (entry.runtime === "server") return entry.plugin.status
  return entry.status
}

function pluginError(entry: Entry | undefined) {
  if (entry?.runtime === "server") return entry.plugin.status === "failed" ? entry.plugin.error : undefined
  return entry?.error
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
          props.context.ui.dialog.show(() => <PluginsDialog context={props.context} plugins={plugins} />)
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
