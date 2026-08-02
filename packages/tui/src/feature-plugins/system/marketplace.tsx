import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import {
  OFFICIAL_MARKETPLACE_SOURCE,
  marketplaceItemEnabled,
  marketplaceMcpEnabled,
  marketplacePermissions,
  marketplacePlanSummary,
  marketplaceSkillComponents,
  marketplaceSkillEnabled,
  marketplaceSources,
  marketplaceStatus,
  type MarketplaceMutationResult,
  type MarketplaceInstallPlan,
  type MarketplacePlanResult,
  type MarketplaceView,
} from "@opencode-ai/core/marketplace"
import { createMemo, createResource } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useBindings } from "../../keymap"
import { errorMessage } from "../../util/error"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:marketplace"

function confirm(api: TuiPluginApi, title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    api.ui.dialog.replace(
      () => (
        <api.ui.DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
        />
      ),
      () => resolve(false),
    )
  })
}

function prompt(api: TuiPluginApi, title: string, placeholder: string) {
  return new Promise<string | undefined>((resolve) => {
    api.ui.dialog.replace(
      () => (
        <api.ui.DialogPrompt
          title={title}
          placeholder={placeholder}
          onConfirm={(value) => resolve(value)}
          onCancel={() => resolve(undefined)}
        />
      ),
      () => resolve(undefined),
    )
  })
}

async function unwrap<T>(request: PromiseLike<{ data?: unknown; error?: unknown }>): Promise<T> {
  const result = await request
  if (result.error) throw new Error(errorMessage(result.error))
  if (result.data === undefined) throw new Error("Marketplace server returned no data")
  return result.data as T
}

const getView = (api: TuiPluginApi, refresh = false) =>
  unwrap<MarketplaceView>(refresh ? api.client.marketplace.refresh() : api.client.marketplace.get())

const planRequest = (api: TuiPluginApi, key: string) => api.client.marketplace.plan({ marketplacePlanInput: { key } })

const installRequest = (
  api: TuiPluginApi,
  input: { plan_id: string; expected_revision: number; force?: boolean; accept_untrusted?: boolean },
) => api.client.marketplace.install({ marketplaceInstallInput: input })

const updateAllRequest = (
  api: TuiPluginApi,
  input: { expected_revision: number; force?: boolean; accept_untrusted?: boolean },
) => api.client.marketplace.updateAll({ marketplaceUpdateAllInput: input })

const cachePruneRequest = (api: TuiPluginApi, input: { max_age_days?: number }) =>
  api.client.marketplace.cachePrune({ marketplaceCachePruneInput: input })

const toggleRequest = (
  api: TuiPluginApi,
  input: {
    key: string
    expected_revision: number
    component: "package" | "skill" | "mcp"
    id?: string
    enabled: boolean
  },
) => {
  const { key, ...marketplaceToggleInput } = input
  return api.client.marketplace.toggle({ key, marketplaceToggleInput })
}

const uninstallRequest = (api: TuiPluginApi, input: { key: string; expected_revision: number }) =>
  api.client.marketplace.uninstall({
    key: input.key,
    expected_revision: String(input.expected_revision),
  })

const sourceAddRequest = (
  api: TuiPluginApi,
  input: {
    expected_revision: number
    url: string
    name?: string
    trust?: "community" | "private"
    format?: "auto" | "opencode" | "codex"
    header_env?: Record<string, string>
  },
) => api.client.marketplace.sourceAdd({ marketplaceSourceAddInput: input })

const sourceToggleRequest = (api: TuiPluginApi, input: { id: string; expected_revision: number; enabled: boolean }) =>
  api.client.marketplace.sourceToggle({
    id: input.id,
    marketplaceSourceToggleInput: {
      expected_revision: input.expected_revision,
      enabled: input.enabled,
    },
  })

const sourceRemoveRequest = (api: TuiPluginApi, input: { id: string; expected_revision: number }) =>
  api.client.marketplace.sourceRemove({
    id: input.id,
    expected_revision: String(input.expected_revision),
  })

function statusText(api: TuiPluginApi, view: MarketplaceView, key: string) {
  const listing = view.listings.find((candidate) => candidate.key === key)
  if (!listing) return ""
  const status = marketplaceStatus({ marketplace: view.state }, listing)
  const color =
    status === "update"
      ? api.theme.current.warning
      : status === "installed"
        ? api.theme.current.success
        : api.theme.current.textMuted
  return <span style={{ fg: color }}>{status}</span>
}

function details(listing: MarketplaceView["listings"][number], plan: MarketplaceInstallPlan) {
  return [
    listing.item.description,
    `publisher: ${listing.item.publisher?.name ?? listing.catalog.publisher?.name ?? "unknown"}`,
    `version: ${listing.item.version}`,
    `catalog: ${listing.source.name} (${listing.source.trust ?? "community"})`,
    listing.catalog_digest ? `catalog digest: ${listing.catalog_digest}` : undefined,
    listing.orphaned ? "catalog status: unavailable; local install remains manageable" : undefined,
    `changes: ${marketplacePlanSummary(plan)}`,
    ...marketplacePermissions(listing.item).map((permission) => `permission: ${permission}`),
  ].filter((value): value is string => value !== undefined)
}

async function applyMutation(
  api: TuiPluginApi,
  request: PromiseLike<{ data?: unknown; error?: unknown }>,
  message: string,
) {
  try {
    const result = await unwrap<MarketplaceMutationResult>(request)
    if (!result.ok) {
      api.ui.toast({ variant: "error", message: result.message })
      return false
    }
    await Promise.allSettled(result.connect_mcp.map((name) => api.client.mcp.connect({ name })))
    api.ui.toast({ variant: "success", message })
    if (result.preserved.length) {
      api.ui.toast({ variant: "warning", message: `Kept modified settings: ${result.preserved.join(", ")}` })
    }
    return true
  } catch (error) {
    api.ui.toast({ variant: "error", message: errorMessage(error) })
    return false
  }
}

function View(props: { api: TuiPluginApi }) {
  const [data, actions] = createResource(() => getView(props.api))
  const rows = createMemo<DialogSelectOption<string>[]>(() =>
    (data()?.listings ?? []).map((listing) => ({
      title: listing.item.name,
      value: listing.key,
      category: `${listing.item.kind} · ${listing.source.name}`,
      description: listing.item.description,
      details: details(listing, data()?.state.installed?.[listing.key]?.plan ?? listing.item.install),
      footer: data() ? statusText(props.api, data()!, listing.key) : "",
    })),
  )
  let current: string | undefined

  async function apply(key: string) {
    const view = data()
    const listing = view?.listings.find((candidate) => candidate.key === key)
    if (!view || !listing) return
    const status = marketplaceStatus({ marketplace: view.state }, listing)
    if (status === "installed") {
      showComponents(props.api, key)
      return
    }

    try {
      const planned = await unwrap<MarketplacePlanResult>(planRequest(props.api, key))
      if (!planned.ok) {
        props.api.ui.toast({ variant: "error", message: planned.message })
        show(props.api)
        return
      }
      const message = [
        planned.summary,
        planned.trust_warning ? `Catalog trust: ${listing.source.trust ?? "community"}.` : undefined,
        planned.permissions.length ? `Capabilities: ${planned.permissions.join("; ")}.` : undefined,
        planned.conflicts.length ? `Shadow: ${planned.conflicts.map((item) => item.path).join(", ")}.` : undefined,
      ]
        .filter((value): value is string => value !== undefined)
        .join("\n")
      if (
        !(await confirm(
          props.api,
          `${planned.action === "update" ? "Update" : "Install"} ${listing.item.name}?`,
          message,
        ))
      ) {
        show(props.api)
        return
      }
      await applyMutation(
        props.api,
        installRequest(props.api, {
          plan_id: planned.plan_id,
          expected_revision: view.state.revision ?? 0,
          force: planned.conflicts.length > 0,
          accept_untrusted: planned.trust_warning,
        }),
        `${planned.action === "update" ? "Updated" : "Installed"} ${listing.item.name}`,
      )
    } catch (error) {
      props.api.ui.toast({ variant: "error", message: errorMessage(error) })
    }
    show(props.api)
  }

  async function updateAll() {
    const view = data()
    if (!view) return
    const result = await applyMutation(
      props.api,
      updateAllRequest(props.api, {
        expected_revision: view.state.revision ?? 0,
        force: false,
        accept_untrusted: false,
      }),
      "Updated Marketplace packages",
    )
    if (result) await actions.refetch()
  }

  async function prune() {
    try {
      const summary = await unwrap<MarketplaceView["cache"]>(cachePruneRequest(props.api, { max_age_days: 30 }))
      props.api.ui.toast({
        variant: "success",
        message: `Cache: ${summary.objects} objects, ${summary.total_bytes} bytes`,
      })
    } catch (error) {
      props.api.ui.toast({ variant: "error", message: errorMessage(error) })
    }
    show(props.api)
  }

  useBindings(() => ({
    bindings: [
      { key: "ctrl+r", desc: "Refresh marketplace", group: "Marketplace", cmd: () => void actions.refetch() },
      { key: "ctrl+s", desc: "Open marketplace sources", group: "Marketplace", cmd: () => showSources(props.api) },
      { key: "ctrl+u", desc: "Update all marketplace items", group: "Marketplace", cmd: () => void updateAll() },
      { key: "ctrl+p", desc: "Prune marketplace cache", group: "Marketplace", cmd: () => void prune() },
      {
        key: "space",
        desc: "Enable or disable installed package",
        group: "Marketplace",
        cmd: () => {
          const view = data()
          const listing = view?.listings.find((candidate) => candidate.key === current)
          if (!view || !listing || marketplaceStatus({ marketplace: view.state }, listing) === "available") return
          const enabled = !marketplaceItemEnabled({ marketplace: view.state }, listing.key)
          void applyMutation(
            props.api,
            toggleRequest(props.api, {
              key: listing.key,
              expected_revision: view.state.revision ?? 0,
              component: "package",
              enabled,
            }),
            `${enabled ? "Enabled" : "Disabled"} ${listing.item.name}`,
          ).then(() => show(props.api))
        },
      },
    ],
  }))

  return (
    <DialogSelect
      title="Marketplace"
      placeholder="Search plugins, skills, agents, commands, MCP servers…"
      options={rows()}
      onMove={(option) => (current = option.value)}
      emptyView={
        <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
          <text fg={props.api.theme.current.textMuted}>
            {data.loading
              ? "Loading cached catalogs…"
              : data.error
                ? errorMessage(data.error)
                : "No Marketplace items. Add a catalog with Marketplace: Sources."}
          </text>
        </box>
      }
      footer={
        <box flexDirection="column">
          <text fg={props.api.theme.current.textMuted}>
            ctrl+r refresh · ctrl+s sources · ctrl+u update · ctrl+p prune · space enable/disable
          </text>
          {data() ? (
            <text fg={props.api.theme.current.textMuted}>
              revision {data()!.state.revision ?? 0} · {data()!.cache.objects} cached objects
            </text>
          ) : null}
          {data()?.errors.length ? (
            <text fg={props.api.theme.current.warning}>
              {data()!
                .errors.map((error) => `${error.source.name}: ${error.message}`)
                .join(" · ")}
            </text>
          ) : null}
        </box>
      }
      onSelect={(option) => void apply(option.value)}
    />
  )
}

function Components(props: { api: TuiPluginApi; key: string }) {
  const [view] = createResource(() => getView(props.api))
  const listing = () => view()?.listings.find((candidate) => candidate.key === props.key)
  const installed = () => view()?.state.installed?.[props.key]
  const rows = createMemo<DialogSelectOption<string>[]>(() => {
    const state = installed()
    const item = listing()
    const data = view()
    if (!state || !item || !data) return []
    const config = { marketplace: data.state }
    const packageEnabled = marketplaceItemEnabled(config, props.key)
    return [
      {
        title: item.item.name,
        value: "package",
        category: "Package",
        description: "Enable or disable every capability in this package.",
        details: [`status: ${packageEnabled ? "enabled" : "disabled"}`],
        footer: packageEnabled ? "enabled" : "disabled",
      },
      ...marketplaceSkillComponents(state.plan).map((skill) => {
        const enabled = marketplaceSkillEnabled(config, props.key, skill.id)
        return {
          title: skill.name,
          value: `skill:${skill.id}`,
          category: "Skills",
          description: skill.description ?? skill.path ?? skill.url,
          details: [`status: ${enabled ? "enabled" : "disabled"}`],
          footer: enabled ? "enabled" : "disabled",
        }
      }),
      ...Object.keys(state.plan.mcp ?? {}).map((name) => {
        const enabled = marketplaceMcpEnabled(config, props.key, name)
        return {
          title: name,
          value: `mcp:${name}`,
          category: "MCP servers",
          description: "Managed MCP server",
          details: [`status: ${enabled ? "enabled" : "disabled"}`],
          footer: enabled ? "enabled" : "disabled",
        }
      }),
    ]
  })

  async function remove() {
    const data = view()
    const item = listing()
    if (!data || !item) return
    if (!(await confirm(props.api, `Remove ${item.item.name}?`, "The local SQLite install record will be removed."))) {
      showComponents(props.api, props.key)
      return
    }
    await applyMutation(
      props.api,
      uninstallRequest(props.api, {
        key: props.key,
        expected_revision: data.state.revision ?? 0,
      }),
      `Removed ${item.item.name}`,
    )
    show(props.api)
  }

  async function toggle(value: string) {
    const data = view()
    const item = listing()
    if (!data || !item) return
    const config = { marketplace: data.state }
    const component = value === "package" ? "package" : value.startsWith("skill:") ? "skill" : "mcp"
    const componentID = component === "package" ? undefined : value.slice(value.indexOf(":") + 1)
    const enabled =
      component === "package"
        ? !marketplaceItemEnabled(config, props.key)
        : component === "skill"
          ? !marketplaceSkillEnabled(config, props.key, componentID!)
          : !marketplaceMcpEnabled(config, props.key, componentID!)
    await applyMutation(
      props.api,
      toggleRequest(props.api, {
        key: props.key,
        expected_revision: data.state.revision ?? 0,
        component,
        id: componentID,
        enabled,
      }),
      `${enabled ? "Enabled" : "Disabled"} ${componentID ?? item.item.name}`,
    )
    showComponents(props.api, props.key)
  }

  useBindings(() => ({
    bindings: [
      { key: "ctrl+b", desc: "Back to marketplace", group: "Marketplace", cmd: () => show(props.api) },
      { key: "ctrl+d", desc: "Uninstall package", group: "Marketplace", cmd: () => void remove() },
    ],
  }))

  return (
    <DialogSelect
      title={`${listing()?.item.name ?? "Marketplace"} components`}
      options={rows()}
      footer={<text fg={props.api.theme.current.textMuted}>enter toggle · ctrl+d uninstall · ctrl+b back</text>}
      onSelect={(option) => void toggle(option.value)}
    />
  )
}

function Sources(props: { api: TuiPluginApi }) {
  const [view] = createResource(() => getView(props.api))
  const sources = () => (view() ? marketplaceSources({ marketplace: view()!.state }) : [])
  const rows = createMemo<DialogSelectOption<string>[]>(() =>
    sources().map((source) => ({
      title: source.name,
      value: source.id,
      category: source.trust ?? "community",
      description: source.reference ?? source.url,
      details: [`status: ${source.enabled === false ? "disabled" : "enabled"}`],
      footer: source.enabled === false ? "disabled" : "enabled",
    })),
  )
  let current: string | undefined

  async function add() {
    const raw = await prompt(props.api, "Add marketplace catalog", "URL, file URL, or local path")
    const data = view()
    if (!raw?.trim() || !data) {
      showSources(props.api)
      return
    }
    await applyMutation(
      props.api,
      sourceAddRequest(props.api, {
        expected_revision: data.state.revision ?? 0,
        url: raw.trim(),
        trust: "community",
      }),
      "Marketplace source added",
    )
    showSources(props.api)
  }

  async function remove() {
    const data = view()
    const source = sources().find((candidate) => candidate.id === current)
    if (!data || !source || source.id === OFFICIAL_MARKETPLACE_SOURCE.id) return
    if (
      !(await confirm(props.api, `Remove ${source.name}?`, "Installed packages remain available from local state."))
    ) {
      showSources(props.api)
      return
    }
    await applyMutation(
      props.api,
      sourceRemoveRequest(props.api, {
        id: source.id,
        expected_revision: data.state.revision ?? 0,
      }),
      `Removed ${source.name}`,
    )
    showSources(props.api)
  }

  useBindings(() => ({
    bindings: [
      { key: "ctrl+a", desc: "Add marketplace source", group: "Marketplace", cmd: () => void add() },
      { key: "ctrl+d", desc: "Remove marketplace source", group: "Marketplace", cmd: () => void remove() },
      { key: "ctrl+b", desc: "Back to marketplace", group: "Marketplace", cmd: () => show(props.api) },
    ],
  }))

  return (
    <DialogSelect
      title="Marketplace sources"
      options={rows()}
      onMove={(option) => (current = option.value)}
      footer={
        <text fg={props.api.theme.current.textMuted}>
          ctrl+a add · ctrl+d remove · ctrl+b back · enter enable/disable
        </text>
      }
      onSelect={(option) => {
        const data = view()
        const source = sources().find((candidate) => candidate.id === option.value)
        if (!data || !source) return
        void applyMutation(
          props.api,
          sourceToggleRequest(props.api, {
            id: source.id,
            expected_revision: data.state.revision ?? 0,
            enabled: source.enabled === false,
          }),
          `${source.enabled === false ? "Enabled" : "Disabled"} ${source.name}`,
        ).then(() => showSources(props.api))
      }}
    />
  )
}

function show(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <View api={api} />)
}

function showSources(api: TuiPluginApi) {
  api.ui.dialog.replace(() => <Sources api={api} />)
}

function showComponents(api: TuiPluginApi, key: string) {
  api.ui.dialog.replace(() => <Components api={api} key={key} />)
}

const tui: TuiPlugin = async (api) => {
  api.keymap.registerLayer({
    commands: [
      {
        name: "marketplace.open",
        title: "Marketplace",
        category: "System",
        namespace: "palette",
        run() {
          setTimeout(() => show(api), 0)
        },
      },
      {
        name: "marketplace.sources",
        title: "Marketplace sources",
        category: "System",
        namespace: "palette",
        run() {
          setTimeout(() => showSources(api), 0)
        },
      },
    ],
  })
}

const plugin: BuiltinTuiPlugin = { id, tui }
export default plugin
