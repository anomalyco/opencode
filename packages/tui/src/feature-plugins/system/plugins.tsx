import type { PluginInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import type { PackageStatus } from "@opencode-ai/schema/plugin"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { DialogErrorDetails } from "../../component/dialog-error-details"
import { usePlugin } from "../../plugin/context"
import { localSource } from "../../plugin/discovery"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"
import { errorMessage } from "../../util/error"

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
      readonly revision?: string
      readonly builtin?: boolean
    }

export function PluginsDialog(props: {
  context: Plugin.Context
  plugins: ReturnType<typeof usePlugin>
  server?: () => readonly PluginInfo[]
}) {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const [locked, setLocked] = createSignal(false)
  const [busy, setBusy] = createSignal<"check" | "update">()
  const [list, setList] = createSignal<DialogSelectRef<string>>()
  const [filter, setFilter] = createSignal("")
  const [detail, setDetail] = createSignal<string>()
  const [errorDetail, setErrorDetail] = createSignal(false)
  const [errors, setErrors] = createSignal<
    Record<string, { operation: "Check" | "Update"; message: string } | undefined>
  >({})
  const [checks, setChecks] = props.context.storage.memory("checks", {
    initial: { packages: {} as Record<string, PackageStatus> },
  })
  const [initial, setInitial] = createSignal<string>()
  const [server, { refetch }] = createResource(
    () => (props.server ? undefined : props.context.data.location.default()),
    (location) => props.context.client.plugin.list({ location }).then((result) => result.data),
  )
  onMount(() => dialog.setSize("medium"))
  onCleanup(props.context.data.on("plugin.updated", () => void refetch()))
  onCleanup(props.context.data.on("server.connected", () => void refetch()))
  const entries = createMemo<Entry[]>(() => {
    const registered = props.plugins.registered()
    const builtins: Entry[] = registered
      .filter((plugin) => plugin.id !== id && plugin.source === "builtin")
      .map((plugin) => ({
        key: `tui:${plugin.id}`,
        runtime: "tui" as const,
        id: plugin.id,
        target: plugin.id,
        status: plugin.active ? ("active" as const) : ("inactive" as const),
        builtin: true,
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
        revision: registered.find((item) => item.id === plugin.id)?.revision,
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
  })

  const owner = (entry: Entry | undefined) => {
    if (!entry) return undefined
    if (entry.runtime === "server")
      return entry.plugin.source.type === "package"
        ? { runtime: "server" as const, target: entry.plugin.source.package }
        : undefined
    if (entry.builtin || localSource(entry.target, ".")) return undefined
    const companion = (props.server?.() ?? server() ?? []).some(
      (plugin) => plugin.source.type === "package" && plugin.source.package === entry.target,
    )
    return { runtime: companion ? "server" : "tui", target: entry.target }
  }
  const checkKey = (entry: Entry | undefined) => {
    const target = owner(entry)
    return JSON.stringify([
      target?.runtime,
      target?.runtime === "server" ? props.context.data.location.default() : undefined,
      target?.target,
    ])
  }
  const checked = (entry: Entry | undefined): PackageStatus | undefined => checks.packages[checkKey(entry)]
  const revision = (entry: Entry) => (entry.runtime === "server" ? entry.plugin.revision : entry.revision)
  const available = (entry: Entry) => {
    const value = checked(entry)
    return value?.mutable && value.available && value.available !== (revision(entry) ?? value.installed)
  }
  const canUpdate = (entry: Entry | undefined) =>
    entry?.runtime === "tui" &&
    owner(entry)?.runtime === "tui" &&
    checked(entry)?.mutable === true &&
    props.plugins.canUpdate(entry.target)
  const entryError = (entry: Entry | undefined) => {
    const load = pluginError(entry)
    const operation = errors()[checkKey(entry)]
    const error = operation ? `${operation.operation} error:\n${operation.message}` : undefined
    return load && error ? `Load error:\n${load}\n\n${error}` : (error ?? load)
  }
  const check = (entry: Entry | undefined) => {
    const target = owner(entry)
    if (locked() || !entry || !target) return
    const key = checkKey(entry)
    setLocked(true)
    setBusy("check")
    setErrors((items) => ({ ...items, [key]: undefined }))
    const task =
      target.runtime === "server"
        ? props.context.client.plugin
            .check({ target: target.target, location: props.context.data.location.default() })
            .then((result) => result.data)
        : props.plugins.check(target.target)
    void task
      .then((result) =>
        setChecks((draft) => {
          draft.packages[key] = result
        }),
      )
      .catch((cause) => {
        setErrors((items) => ({ ...items, [key]: { operation: "Check", message: errorMessage(cause) } }))
        props.context.ui.toast.show({ variant: "error", message: "Could not check plugin updates; view details." })
      })
      .finally(() => {
        setBusy()
        setLocked(false)
      })
  }
  const update = (entry: Entry) => {
    if (locked() || entry.runtime !== "tui" || !canUpdate(entry)) return
    const key = checkKey(entry)
    setLocked(true)
    setBusy("update")
    setErrors((items) => ({ ...items, [key]: undefined }))
    void props.plugins
      .update(entry.target)
      .then((result) => {
        setChecks((draft) => {
          draft.packages[key] = result
        })
        props.context.ui.toast.show({ variant: "success", message: "Updated and applied in this terminal." })
      })
      .catch((cause) => {
        setErrors((items) => ({ ...items, [key]: { operation: "Update", message: errorMessage(cause) } }))
        props.context.ui.toast.show({ variant: "error", message: "Could not update and apply plugin; view details." })
      })
      .finally(() => {
        setBusy()
        setLocked(false)
      })
  }

  const options = createMemo(() =>
    entries().map(
      (entry): DialogSelectOption<string> => ({
        title: label(entry, props.context),
        value: entry.key,
        category: entry.runtime === "tui" ? "TUI" : "Server",
        searchText: entry.runtime === "tui" ? entry.target : source(entry.plugin, props.context),
        footer: entryError(entry)
          ? "failed"
          : available(entry)
            ? "↑ update"
            : checked(entry)?.mutable === false
              ? "pinned"
              : status(entry) === "active"
                ? undefined
                : status(entry),
        footerColor: entryError(entry)
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
  const focusedEntry = createMemo(() => entries().find((entry) => entry.key === list()?.selected?.value))
  const focusedTui = createMemo(() => {
    const entry = focusedEntry()
    if (entry?.runtime !== "tui" || !entry.id) return undefined
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

  const detailEntry = createMemo(() => entries().find((entry) => entry.key === detail()))
  const back = () => {
    setDetail()
    setErrorDetail(false)
    dialog.setSize("medium")
  }
  let scroll: ScrollBoxRenderable | undefined

  return (
    <box>
      <Show
        when={detailEntry()}
        fallback={
          <DialogSelect
            title="Plugins"
            options={options()}
            current={initial()}
            locked={locked()}
            preserveSelection={true}
            initialFilter={filter()}
            onFilter={setFilter}
            ref={setList}
            onSelect={(option) => {
              setInitial(option.value)
              setDetail(option.value)
            }}
            actions={[
              ...(focusedTui() && !busy()
                ? [
                    {
                      title: toggleTitle(),
                      command: "plugins.toggle",
                      onTrigger: (option: DialogSelectOption<string>) =>
                        toggle(entries().find((entry) => entry.key === option.value)),
                    },
                  ]
                : []),
              ...(owner(focusedEntry()) && !busy()
                ? [
                    {
                      title: "check",
                      command: "plugins.check",
                      onTrigger: (option: DialogSelectOption<string>) =>
                        check(entries().find((entry) => entry.key === option.value)),
                    },
                  ]
                : []),
            ]}
            footerHints={!busy() && dimensions().width >= 60 ? [{ title: "enter", label: "details" }] : []}
            footer={
              <Show when={busy()}>
                <text fg={props.context.theme.text.subdued}>
                  {busy() === "update" ? "Updating & applying..." : "Checking..."}
                </text>
              </Show>
            }
          />
        }
      >
        {(entry) => (
          <Show
            when={errorDetail()}
            fallback={
              <DialogSelect
                title={label(entry(), props.context)}
                renderFilter={false}
                locked={locked()}
                titleView={
                  <box flexGrow={1} flexShrink={1} flexBasis={0} minWidth={0} gap={1}>
                    <text fg={props.context.theme.text.default} truncate>
                      <b>{label(entry(), props.context)}</b>
                    </text>
                    <scrollbox
                      ref={(value) => {
                        scroll = value
                      }}
                      width="100%"
                      height={Math.min(
                        10,
                        Math.max(
                          2,
                          Math.floor((dimensions().height * 3) / 4) -
                            8 -
                            (canUpdate(entry()) ? 2 : 0) -
                            (entryError(entry()) ? 2 : 0),
                        ),
                      )}
                      scrollbarOptions={{ visible: false }}
                    >
                      <text width="100%" fg={props.context.theme.text.subdued} wrapMode="word">
                        {[
                          `Runtime    ${entry().runtime === "server" ? "Server" : "This terminal"}`,
                          `Status     ${status(entry())}`,
                          `Source     ${pluginSource(entry(), props.context)}`,
                          `Scope      ${owner(entry())?.runtime === "server" || entry().runtime === "server" ? `Server: ${props.context.ui.format.path(props.context.data.location.default().directory)}` : "This terminal"}`,
                          `Loaded     ${revision(entry()) ?? "Unknown"}`,
                          `Installed  ${owner(entry()) ? (checked(entry()) ? (checked(entry())?.installed ?? "Unknown") : "Not checked") : "Not applicable"}`,
                          `Available  ${owner(entry()) ? (checked(entry()) ? (checked(entry())?.available ?? "Unknown") : "Not checked") : "Not applicable"}${checked(entry())?.mutable === false ? " (pinned)" : ""}`,
                          owner(entry())
                            ? owner(entry())?.runtime === "server"
                              ? "Inspection only: server plugins and TUI companions do not support hot apply."
                              : entry().runtime === "tui" &&
                                  props.plugins.canUpdate(pluginSource(entry(), props.context))
                                ? checked(entry())?.mutable === false
                                  ? "Select a newer package spec in cli.json, then reopen the TUI."
                                  : "Check for updates, then Update & Apply in this terminal; no server restart."
                                : "Inspection only: disabled or unloaded plugins do not support hot apply. Enable first or change cli.json."
                            : pluginSource(entry(), props.context) === "builtin"
                              ? "Updates with OpenCode itself."
                              : "Local/SDK source; no package check.",
                        ].join("\n")}
                      </text>
                    </scrollbox>
                  </box>
                }
                options={[
                  ...(owner(entry()) ? [{ title: "Check for updates", value: "check" }] : []),
                  ...(canUpdate(entry()) ? [{ title: "Update & Apply", value: "update" }] : []),
                  ...(entryError(entry()) ? [{ title: "View error details", value: "error" }] : []),
                  { title: "Back to plugins", value: "back" },
                ]}
                onSelect={(option) => {
                  if (option.value === "check") return check(entry())
                  if (option.value === "update") return update(entry())
                  if (option.value === "error") return setErrorDetail(true)
                  back()
                }}
                bindings={[
                  { bind: "escape", title: "Back", group: "Dialog", run: back },
                  { bind: "pageup", title: "Scroll details up", group: "Dialog", run: () => scroll?.scrollBy(-5) },
                  { bind: "pagedown", title: "Scroll details down", group: "Dialog", run: () => scroll?.scrollBy(5) },
                  ...(owner(entry())
                    ? [{ id: "plugins.check", title: "Check for updates", group: "Dialog", run: () => check(entry()) }]
                    : []),
                  ...(entry().runtime === "tui"
                    ? [{ id: "plugins.toggle", title: "Toggle plugin", group: "Dialog", run: () => toggle(entry()) }]
                    : []),
                ]}
                footer={
                  <text fg={props.context.theme.text.subdued}>
                    {busy()
                      ? busy() === "update"
                        ? "Updating & applying..."
                        : "Checking..."
                      : entryError(entry())
                        ? "Plugin operation failed; view error."
                        : available(entry())
                          ? "↑ New revision available."
                          : checked(entry())?.mutable === false
                            ? "Pinned source."
                            : "PgUp/PgDn scroll details"}
                  </text>
                }
              />
            }
          >
            <DialogErrorDetails
              title={`${entry().runtime === "tui" ? "TUI" : "Server"} plugin: ${label(entry(), props.context)}`}
              error={entryError(entry()) ?? "Unknown plugin error"}
              context={`Status: ${status(entry())}\nRuntime: ${entry().runtime}\nSource: ${pluginSource(entry(), props.context)}`}
              onBack={() => {
                setErrorDetail(false)
                dialog.setSize("medium")
              }}
            />
          </Show>
        )}
      </Show>
    </box>
  )
}

function label(entry: Entry, context: Plugin.Context) {
  if (entry.runtime === "tui") return entry.id ?? entry.target
  return entry.plugin.id ?? source(entry.plugin, context)
}

function pluginSource(entry: Entry, context: Plugin.Context) {
  if (entry.runtime === "tui") return entry.builtin ? "builtin" : entry.target
  return source(entry.plugin, context)
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
