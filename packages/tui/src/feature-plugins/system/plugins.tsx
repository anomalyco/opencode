import type { PluginInfo, PluginSource } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { createEffect, createMemo, createResource, createSignal, onMount, Show } from "solid-js"
import { DialogErrorDetails } from "../../component/dialog-error-details"
import { usePlugin } from "../../plugin/context"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog } from "../../ui/dialog"

const id = "opencode.plugins"

export type PluginUpdateInfo = {
  readonly name: string
  readonly source: PluginSource
  readonly status: "not-updateable" | "pinned" | "up-to-date" | "available" | "failed"
  readonly currentVersion?: string
  readonly latestVersion?: string
  readonly error?: string
}

export type PluginUpdateResult = {
  readonly name: string
  readonly source: PluginSource
  readonly status: "not-updateable" | "pinned" | "up-to-date" | "updated" | "failed"
  readonly previousVersion?: string
  readonly version?: string
  readonly error?: string
}

type UpdateEntry = PluginUpdateInfo | PluginUpdateResult

type Entry =
  | { readonly key: string; readonly runtime: "server"; readonly plugin: PluginInfo; readonly update?: UpdateEntry }
  | {
      readonly key: string
      readonly runtime: "tui"
      readonly id?: string
      readonly target: string
      readonly status: "active" | "inactive" | "failed"
      readonly error?: string
    }

type PluginUpdateOperations = {
  check(): Promise<readonly PluginUpdateInfo[]>
  update(name: string): Promise<PluginUpdateResult>
  updateAll(): Promise<readonly PluginUpdateResult[]>
}

export type PluginRegistry = Pick<ReturnType<typeof usePlugin>, "registered" | "list" | "activate" | "deactivate">

type ServerEntry = Extract<Entry, { runtime: "server" }>

type PendingPluginClient = Plugin.Context["client"]["plugin"] & {
  check(input: { location: NonNullable<Plugin.Context["location"]> }): Promise<{ data: PluginUpdateInfo[] }>
  update(input: { name: string; location: NonNullable<Plugin.Context["location"]> }): Promise<{
    data: PluginUpdateResult
  }>
  updateAll(input: { location: NonNullable<Plugin.Context["location"]> }): Promise<{
    data: PluginUpdateResult[]
  }>
}

export function PluginsDialog(props: {
  context: Plugin.Context
  plugins: PluginRegistry
  server?: () => readonly PluginInfo[]
  updates?: PluginUpdateOperations
}) {
  const dialog = useDialog()
  const [locked, setLocked] = createSignal(false)
  const [focused, setFocused] = createSignal<string>()
  const [detail, setDetail] = createSignal<Entry>()
  const [initial, setInitial] = createSignal<string>()
  const [checking, setChecking] = createSignal(true)
  const [checkError, setCheckError] = createSignal<string>()
  const [updateEntries, setUpdateEntries] = createSignal<readonly UpdateEntry[]>([])
  const [updating, setUpdating] = createSignal<string>()
  const location = () => props.context.location ?? props.context.data.location.default()
  const pending = props.context.client.plugin as PendingPluginClient
  const operations: PluginUpdateOperations = props.updates ?? {
    check: () => pending.check({ location: location() }).then((result) => result.data),
    update: (name) => pending.update({ name, location: location() }).then((result) => result.data),
    updateAll: () => pending.updateAll({ location: location() }).then((result) => result.data),
  }
  const [server, { refetch: refetchServer }] = createResource(
    () => (props.server ? undefined : location()),
    (location) => props.context.client.plugin.list({ location }).then((result) => result.data),
  )
  onMount(() => {
    dialog.setSize("medium")
    void operations
      .check()
      .then(setUpdateEntries)
      .catch((cause) => setCheckError(errorMessage(cause)))
      .finally(() => setChecking(false))
  })
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
    const runtime = props.server?.() ?? server() ?? []
    const matched = new Set<PluginInfo>()
    const checked: ServerEntry[] = updateEntries().flatMap((update) => {
      const plugin = runtime.find((candidate) => matchesPluginUpdate(candidate, update))
      if (!plugin) return []
      matched.add(plugin)
      return [{ key: pluginServerKey(plugin), runtime: "server", plugin, update }]
    })
    const serverEntries: Entry[] = [
      ...checked,
      ...runtime
        .filter((plugin) => !matched.has(plugin))
        .map((plugin) => ({
          key: pluginServerKey(plugin),
          runtime: "server" as const,
          plugin,
        })),
    ]
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
        footer: statusLabel(entry, checking(), updating()),
        footerColor:
          status(entry) === "failed" || updateStatus(entry) === "failed"
            ? props.context.theme.text.feedback.error.default
            : updateStatus(entry) === "updated" || updateStatus(entry) === "up-to-date"
              ? props.context.theme.text.feedback.success.default
              : updateStatus(entry) === "available"
                ? props.context.theme.text.feedback.info.default
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
  const focusedUpdate = createMemo(() => {
    const entry = focusedEntry()
    if (entry?.runtime !== "server") return
    return entry.update
  })
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
  const update = (name: string) => {
    if (locked()) return
    setLocked(true)
    setUpdating(name)
    setCheckError()
    void operations
      .update(name)
      .then(async (result) => {
        setUpdateEntries((current) => current.map((entry) => (entry.name === name ? result : entry)))
        if (!props.server && result.status === "updated") await refetchServer()
      })
      .catch((cause) => {
        setCheckError(errorMessage(cause))
        props.context.ui.toast.show({ variant: "error", message: errorMessage(cause) })
      })
      .finally(() => {
        setUpdating()
        setLocked(false)
      })
  }
  const updateAll = () => {
    if (locked()) return
    setLocked(true)
    setUpdating("*")
    setCheckError()
    void operations
      .updateAll()
      .then(async (results) => {
        setUpdateEntries(results)
        if (!props.server && results.some((result) => result.status === "updated")) await refetchServer()
      })
      .catch((cause) => {
        setCheckError(errorMessage(cause))
        props.context.ui.toast.show({ variant: "error", message: errorMessage(cause) })
      })
      .finally(() => {
        setUpdating()
        setLocked(false)
      })
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
            actions={[
              ...(focusedTui()
                ? [
                    {
                      title: toggleTitle(),
                      command: "plugins.toggle",
                      onTrigger: (option: DialogSelectOption<string>) =>
                        toggle(entries().find((entry) => entry.key === option.value)),
                    },
                  ]
                : []),
              ...(focusedUpdate()?.status === "available"
                ? [
                    {
                      title: "update",
                      command: "dialog.plugins.update",
                      onTrigger: (_option: DialogSelectOption<string>) => update(focusedUpdate()!.name),
                    },
                  ]
                : []),
              ...(updateEntries().some((entry) => entry.status === "available")
                ? [
                    {
                      title: "update all",
                      command: "dialog.plugins.update_all",
                      selection: "none" as const,
                      side: "right" as const,
                      onTrigger: updateAll,
                    },
                  ]
                : []),
            ]}
            footer={
              <Show
                when={pluginError(focusedEntry())}
                fallback={
                  <Show when={checkError()}>
                    <text fg={props.context.theme.text.feedback.error.default}>Update check failed</text>
                  </Show>
                }
              >
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

export function matchesPluginUpdate(plugin: PluginInfo, update: UpdateEntry) {
  if (plugin.source.type !== update.source.type) return false
  if (plugin.source.type === "package" && update.source.type === "package") {
    return plugin.source.package === update.source.package
  }
  if (plugin.source.type === "local" && update.source.type === "local") return plugin.source.path === update.source.path
  return plugin.id === update.name
}

export function pluginServerKey(plugin: PluginInfo) {
  if (plugin.id) return `server:${plugin.id}`
  if (plugin.source.type === "package") return `server:package:${plugin.source.package}`
  if (plugin.source.type === "local") return `server:local:${plugin.source.path}`
  return `server:${plugin.source.type}`
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

function updateStatus(entry: Entry) {
  if (entry.runtime !== "server") return
  return entry.update?.status
}

function statusLabel(entry: Entry, checking: boolean, updating: string | undefined) {
  if (entry.runtime === "tui") return status(entry) === "active" ? undefined : status(entry)
  const update = entry.update
  if (updating === "*" || (update && updating === update.name)) return "updating …"
  if (entry.plugin.status === "failed") return "failed"
  if (!update) return checking ? "checking …" : undefined
  if (update.status === "not-updateable") return update.source.type === "local" ? "local" : "not updateable"
  const currentVersion =
    "currentVersion" in update ? update.currentVersion : "version" in update ? update.version : undefined
  if (update.status === "pinned") return currentVersion ? `${currentVersion} pinned` : "pinned"
  if (update.status === "up-to-date") return currentVersion ? `${currentVersion} up to date` : "up to date"
  if (update.status === "available") {
    return `${update.currentVersion ?? "installed"} → ${update.latestVersion ?? "update available"}`
  }
  if (update.status === "updated") return `${update.previousVersion ?? "installed"} → ${update.version ?? "updated"} ✓`
  return "failed"
}

function pluginError(entry: Entry | undefined) {
  if (entry?.runtime === "server") {
    if (entry.plugin.status === "failed") return entry.plugin.error
    if (entry.update?.status === "failed") return entry.update.error
    return
  }
  return entry?.error
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
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
