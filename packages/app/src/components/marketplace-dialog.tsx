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
  type MarketplaceConfiguredTrust,
  type MarketplaceConflict,
  type MarketplaceHostConfig,
  type MarketplaceListing,
  type MarketplaceMutationResult,
  type MarketplacePlanResult,
  type MarketplaceSource,
  type MarketplaceView,
} from "@opencode-ai/core/marketplace"
import { Dialog } from "@opencode-ai/ui/dialog"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import "./marketplace-dialog.css"

const TABS = ["discover", "installed", "updates", "sources"] as const
const KINDS = ["all", "plugin", "skill", "agent", "command", "mcp", "bundle"] as const

type Tab = (typeof TABS)[number]
type KindFilter = (typeof KINDS)[number]
type PendingAction = "install" | "update" | "uninstall"

type Pending = {
  planId?: string
  listing: MarketplaceListing
  action: PendingAction
  conflicts: MarketplaceConflict[]
  trustWarning: boolean
  summary?: string
}

export function DialogMarketplace() {
  return (
    <Dialog
      size="x-large"
      class="!h-[min(760px,calc(100vh-32px))] !w-[min(1180px,calc(100vw-32px))]"
      title="Marketplace"
      description="Discover and manage OpenCode extensions from local, content-addressed catalogs."
    >
      <MarketplacePanel />
    </Dialog>
  )
}

export function MarketplacePanel() {
  const sync = useServerSync()
  const [view, actions] = createResource(async () => (await sync().marketplace.get()) as MarketplaceView)
  const [store, setStore] = createStore({
    tab: "discover" as Tab,
    kind: "all" as KindFilter,
    query: "",
    selected: undefined as string | undefined,
    busy: false,
    pending: undefined as Pending | undefined,
    sourceURL: "",
    sourceName: "",
    sourceTrust: "community" as MarketplaceConfiguredTrust,
    sourceHeaderName: "",
    sourceHeaderEnv: "",
  })

  const state = () => view()?.state ?? { revision: 0 }
  const config = () => ({ marketplace: state() }) satisfies MarketplaceHostConfig
  const revision = () => state().revision ?? 0
  const listings = () => view()?.listings ?? []
  const status = (listing: MarketplaceListing) => marketplaceStatus(config(), listing)
  const updates = createMemo(() => listings().filter((listing) => status(listing) === "update"))
  const visible = createMemo(() => {
    const query = store.query.trim().toLowerCase()
    return listings().filter((listing) => {
      const value = status(listing)
      if (store.tab === "discover" && listing.orphaned) return false
      if (store.tab === "installed" && value === "available") return false
      if (store.tab === "updates" && value !== "update") return false
      if (store.kind !== "all" && listing.item.kind !== store.kind) return false
      if (!query) return true
      return [
        listing.item.name,
        listing.item.description,
        listing.item.publisher?.name,
        listing.catalog.name,
        listing.source.name,
        listing.item.kind,
        ...(listing.item.tags ?? []),
      ]
        .filter((item): item is string => Boolean(item))
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  })
  const current = createMemo(() => visible().find((listing) => listing.key === store.selected) ?? visible()[0])

  createEffect(() => {
    const listing = current()
    if (listing && listing.key !== store.selected) setStore("selected", listing.key)
  })

  async function run(
    request: Promise<MarketplaceMutationResult>,
    message: string,
    options?: { restorePending?: Pending },
  ) {
    setStore("busy", true)
    try {
      const result = await request
      if (!result.ok) {
        showToast({
          variant: "error",
          title: "Marketplace request failed",
          description: result.message,
        })
        if (options?.restorePending) setStore("pending", options.restorePending)
        return false
      }
      actions.mutate(result.view)
      await Promise.allSettled(result.connect_mcp.map((name) => sync().mcp.connect(sync().data.path.directory, name)))
      showToast({ variant: "success", description: message })
      if (result.preserved.length) {
        showToast({
          title: "Settings preserved",
          description: result.preserved.join(", "),
        })
      }
      return true
    } catch (error) {
      showToast({
        variant: "error",
        title: "Marketplace request failed",
        description: error instanceof Error ? error.message : String(error),
      })
      if (options?.restorePending) setStore("pending", options.restorePending)
      return false
    } finally {
      setStore("busy", false)
    }
  }

  async function refresh() {
    setStore("busy", true)
    try {
      actions.mutate((await sync().marketplace.refresh()) as MarketplaceView)
    } catch (error) {
      showToast({
        variant: "error",
        title: "Marketplace refresh failed",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setStore("busy", false)
    }
  }

  async function request(listing: MarketplaceListing) {
    const value = status(listing)
    if (value === "installed") {
      setStore("pending", { listing, action: "uninstall", conflicts: [], trustWarning: false })
      return
    }
    setStore("busy", true)
    try {
      const result = (await sync().marketplace.plan({ key: listing.key })) as MarketplacePlanResult
      if (!result.ok) {
        showToast({ variant: "error", title: "Marketplace plan failed", description: result.message })
        return
      }
      setStore("pending", {
        planId: result.plan_id,
        listing,
        action: result.action,
        conflicts: result.conflicts,
        trustWarning: result.trust_warning,
        summary: result.summary,
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Marketplace plan failed",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setStore("busy", false)
    }
  }

  async function confirm() {
    const pending = store.pending
    if (!pending) return
    setStore("pending", undefined)
    if (pending.action === "uninstall") {
      await run(
        sync().marketplace.uninstall({
          key: pending.listing.key,
          expected_revision: revision(),
        }) as Promise<MarketplaceMutationResult>,
        `Removed ${pending.listing.item.name}`,
        { restorePending: pending },
      )
      return
    }
    await run(
      sync().marketplace.install({
        plan_id: pending.planId!,
        expected_revision: revision(),
        force: pending.conflicts.length > 0,
        accept_untrusted: pending.trustWarning,
      }) as Promise<MarketplaceMutationResult>,
      `${pending.action === "update" ? "Updated" : "Installed"} ${pending.listing.item.name}`,
      { restorePending: pending },
    )
  }

  async function updateAll() {
    await run(
      sync().marketplace.updateAll({
        expected_revision: revision(),
        force: false,
        accept_untrusted: false,
      }) as Promise<MarketplaceMutationResult>,
      `Updated ${updates().length} Marketplace item${updates().length === 1 ? "" : "s"}`,
    )
  }

  async function addSource() {
    const url = store.sourceURL.trim()
    if (!url) return
    const header = store.sourceHeaderName.trim()
    const variable = store.sourceHeaderEnv.trim()
    const success = await run(
      sync().marketplace.sourceAdd({
        expected_revision: revision(),
        url,
        name: store.sourceName.trim() || undefined,
        trust: store.sourceTrust,
        header_env: header && variable ? { [header]: variable } : undefined,
      }) as Promise<MarketplaceMutationResult>,
      "Marketplace source added",
    )
    if (success)
      setStore({
        sourceURL: "",
        sourceName: "",
        sourceTrust: "community",
        sourceHeaderName: "",
        sourceHeaderEnv: "",
      })
  }

  async function prune() {
    setStore("busy", true)
    try {
      const summary = await sync().marketplace.cachePrune({ max_age_days: 30 })
      const current = view()
      if (current) actions.mutate({ ...current, cache: summary })
      showToast({
        variant: "success",
        description: `Marketplace cache pruned: ${summary.objects} objects remain`,
      })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Marketplace cache prune failed",
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setStore("busy", false)
    }
  }

  return (
    <div data-component="marketplace-panel" class="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div data-slot="marketplace-header" class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 data-slot="marketplace-title" class="text-16-medium text-text-strong">
            Marketplace
          </h2>
          <p data-slot="marketplace-subtitle" class="mt-1 text-12-regular text-text-weak">
            SQLite registry · content-addressed cache · revision {revision()}
          </p>
        </div>
        <div data-slot="marketplace-toolbar" class="flex flex-wrap items-center gap-2 text-12-regular text-text-weak">
          <span>{Object.keys(state().installed ?? {}).length} installed</span>
          <Show when={view()?.cache}>
            {(cache) => (
              <span>
                {cache().objects} cached · {formatBytes(cache().total_bytes)}
              </span>
            )}
          </Show>
          <Show when={updates().length}>
            <ButtonV2
              type="button"
              size="small"
              variant="neutral"
              disabled={store.busy}
              onClick={() => void updateAll()}
            >
              Update all ({updates().length})
            </ButtonV2>
          </Show>
          <ButtonV2 type="button" size="small" variant="outline" disabled={store.busy} onClick={() => void prune()}>
            Prune cache
          </ButtonV2>
          <ButtonV2 type="button" size="small" variant="outline" disabled={store.busy} onClick={() => void refresh()}>
            Refresh
          </ButtonV2>
        </div>
      </div>

      <div data-slot="marketplace-tabs" class="flex flex-wrap items-center gap-1 border-b pb-2">
        <For each={TABS}>
          {(tab) => (
            <ButtonV2
              type="button"
              size="small"
              variant={store.tab === tab ? "neutral" : "ghost-muted"}
              class="capitalize"
              aria-current={store.tab === tab ? "page" : undefined}
              onClick={() => setStore("tab", tab)}
            >
              {tab}
              <Show when={tab === "updates" && updates().length}> ({updates().length})</Show>
            </ButtonV2>
          )}
        </For>
      </div>

      <Show
        when={store.tab === "sources"}
        fallback={
          <div data-slot="marketplace-content" class="flex min-h-0 flex-1 gap-3 overflow-hidden">
            <div data-slot="marketplace-pane" class="flex min-h-0 w-[42%] min-w-72 flex-col overflow-hidden rounded-lg">
              <div data-slot="marketplace-filters" class="flex gap-2 border-b p-2">
                <TextInputV2
                  autofocus
                  type="search"
                  appearance="base"
                  value={store.query}
                  onInput={(event) => setStore("query", event.currentTarget.value)}
                  placeholder="Search marketplace"
                  spellcheck={false}
                  autocorrect="off"
                  autocomplete="off"
                  autocapitalize="off"
                  aria-label="Search marketplace"
                />
                <SelectV2
                  options={[...KINDS]}
                  current={store.kind}
                  appearance="base"
                  aria-label="Marketplace item type"
                  onSelect={(value) => value && setStore("kind", value)}
                />
              </div>
              <div class="min-h-0 flex-1 overflow-y-auto p-1.5">
                <Show
                  when={!view.loading}
                  fallback={<div class="p-6 text-center text-13-regular text-text-weak">Loading catalogs…</div>}
                >
                  <Show
                    when={visible().length}
                    fallback={<div class="p-6 text-center text-13-regular text-text-weak">No matching items.</div>}
                  >
                    <For each={visible()}>
                      {(listing) => (
                        <button
                          type="button"
                          data-slot="marketplace-list-item"
                          data-selected={current()?.key === listing.key ? "" : undefined}
                          class="mb-1 flex w-full gap-2.5 rounded-md px-2.5 py-2 text-left"
                          onClick={() => setStore("selected", listing.key)}
                        >
                          <PluginIcon listing={listing} />
                          <div class="min-w-0 flex-1">
                            <div class="flex items-center justify-between gap-2">
                              <span class="truncate text-13-medium text-text-strong">{listing.item.name}</span>
                              <Status value={status(listing)} />
                            </div>
                            <div class="mt-1 line-clamp-2 text-12-regular text-text-weak">
                              {listing.item.description}
                            </div>
                            <div class="mt-1 flex gap-2 text-11-regular text-text-weak">
                              <span class="capitalize">{listing.item.kind}</span>
                              <span>v{listing.item.version}</span>
                              <span class="truncate">{listing.source.name}</span>
                            </div>
                          </div>
                        </button>
                      )}
                    </For>
                  </Show>
                </Show>
              </div>
            </div>
            <div data-slot="marketplace-pane" class="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg p-4">
              <Show
                when={current()}
                fallback={
                  <div class="flex h-full items-center justify-center text-13-regular text-text-weak">
                    Select an item.
                  </div>
                }
              >
                {(listing) => (
                  <Details
                    listing={listing()}
                    config={config()}
                    busy={store.busy}
                    action={() => void request(listing())}
                    toggle={(component, id, enabled, label) =>
                      void run(
                        sync().marketplace.toggle({
                          key: listing().key,
                          expected_revision: revision(),
                          component,
                          id,
                          enabled,
                        }) as Promise<MarketplaceMutationResult>,
                        label,
                      )
                    }
                  />
                )}
              </Show>
            </div>
          </div>
        }
      >
        <Sources
          sources={marketplaceSources(config())}
          errors={view()?.errors ?? []}
          busy={store.busy}
          sourceURL={store.sourceURL}
          sourceName={store.sourceName}
          sourceTrust={store.sourceTrust}
          sourceHeaderName={store.sourceHeaderName}
          sourceHeaderEnv={store.sourceHeaderEnv}
          setURL={(value) => setStore("sourceURL", value)}
          setName={(value) => setStore("sourceName", value)}
          setTrust={(value) => setStore("sourceTrust", value)}
          setHeaderName={(value) => setStore("sourceHeaderName", value)}
          setHeaderEnv={(value) => setStore("sourceHeaderEnv", value)}
          add={() => void addSource()}
          toggle={(source) =>
            void run(
              sync().marketplace.sourceToggle({
                id: source.id,
                expected_revision: revision(),
                enabled: source.enabled === false,
              }) as Promise<MarketplaceMutationResult>,
              `${source.enabled === false ? "Enabled" : "Disabled"} ${source.name}`,
            )
          }
          remove={(source) =>
            void run(
              sync().marketplace.sourceRemove({
                id: source.id,
                expected_revision: revision(),
              }) as Promise<MarketplaceMutationResult>,
              `Removed ${source.name}`,
            )
          }
        />
      </Show>

      <Show when={store.pending}>
        {(pending) => (
          <div
            data-slot="marketplace-modal-backdrop"
            class="absolute inset-0 z-10 flex items-center justify-center p-4"
          >
            <div data-slot="marketplace-modal" class="w-full max-w-lg rounded-xl p-4">
              <h3 class="text-15-medium text-text-strong capitalize">
                {pending().action} {pending().listing.item.name}
              </h3>
              <p class="mt-2 text-12-regular text-text-weak">
                {pending().action === "uninstall"
                  ? "The SQLite installation record will be removed. User configuration is not rewritten."
                  : (pending().summary ?? marketplacePlanSummary(pending().listing.item.install))}
              </p>
              <Show when={pending().trustWarning}>
                <div class="mt-3 rounded-md border border-border-warning px-3 py-2 text-12-regular text-text-base">
                  This catalog is marked {pending().listing.source.trust ?? "community"}. Confirm to allow its code and
                  remote assets.
                </div>
              </Show>
              <Show when={pending().conflicts.length}>
                <div class="mt-3 rounded-md border border-border-warning px-3 py-2 text-12-regular text-text-base">
                  <div class="font-medium">These settings will be shadowed:</div>
                  <For each={pending().conflicts}>
                    {(conflict) => <div class="mt-1 font-mono">{conflict.path}</div>}
                  </For>
                </div>
              </Show>
              <Show when={pending().action !== "uninstall" && marketplacePermissions(pending().listing.item).length}>
                <div class="mt-3 text-12-regular text-text-weak">
                  <div class="font-medium text-text-base">Requested capabilities</div>
                  <For each={marketplacePermissions(pending().listing.item)}>
                    {(permission) => <div class="mt-1">• {permission}</div>}
                  </For>
                </div>
              </Show>
              <div class="mt-4 flex justify-end gap-2">
                <ButtonV2 type="button" variant="ghost-muted" onClick={() => setStore("pending", undefined)}>
                  Cancel
                </ButtonV2>
                <ButtonV2
                  type="button"
                  variant={pending().action === "uninstall" ? "danger" : "neutral"}
                  disabled={store.busy}
                  onClick={() => void confirm()}
                >
                  Confirm
                </ButtonV2>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

function Status(props: { value: ReturnType<typeof marketplaceStatus> }) {
  return (
    <span data-slot="marketplace-status" class="shrink-0 rounded px-1.5 py-0.5 text-10-medium uppercase">
      {props.value}
    </span>
  )
}

function PluginIcon(props: { listing: MarketplaceListing }) {
  const sync = useServerSync()
  const [failed, setFailed] = createSignal(false)
  const src = () => props.listing.item.icon?.["src-light"]
  const [local] = createResource(
    () => (src()?.startsWith("file:") ? props.listing.key : undefined),
    (key) => sync().marketplace.icon({ key, variant: "src-light" }),
  )
  const resolved = () => (src()?.startsWith("file:") ? local()?.data_url : src())
  const initials = () =>
    props.listing.item.name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
  return (
    <div
      class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl text-12-medium text-white shadow-sm"
      style={{ "background-color": props.listing.item.brand_color ?? "#5C6470" }}
    >
      <Show when={resolved() && !failed()} fallback={<span aria-hidden="true">{initials()}</span>}>
        <img
          src={resolved()}
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          class="size-full object-cover"
          onError={() => setFailed(true)}
        />
      </Show>
    </div>
  )
}

function Details(props: {
  listing: MarketplaceListing
  config: MarketplaceHostConfig
  busy: boolean
  action: () => void
  toggle: (component: "package" | "skill" | "mcp", id: string | undefined, enabled: boolean, label: string) => void
}) {
  const language = useLanguage()
  const status = () => marketplaceStatus(props.config, props.listing)
  const installed = () => props.config.marketplace?.installed?.[props.listing.key]
  const enabled = () => marketplaceItemEnabled(props.config, props.listing.key)
  const skills = () =>
    marketplaceSkillComponents(installed()?.materialized_plan ?? installed()?.plan ?? props.listing.item.install)
  const mcp = () =>
    Object.keys(installed()?.materialized_plan?.mcp ?? installed()?.plan.mcp ?? props.listing.item.install.mcp ?? {})

  return (
    <div class="flex min-h-full flex-col">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="text-18-medium text-text-strong">{props.listing.item.name}</h3>
            <Status value={status()} />
          </div>
          <div class="mt-1 text-12-regular text-text-weak">
            {props.listing.item.publisher?.name ?? props.listing.catalog.publisher?.name ?? "Unknown publisher"} · v
            {props.listing.item.version} · {props.listing.source.name}
          </div>
        </div>
        <ButtonV2
          type="button"
          variant={status() === "installed" ? "danger" : "neutral"}
          disabled={props.busy}
          class="shrink-0"
          onClick={props.action}
        >
          {status() === "available" ? "Install" : status() === "update" ? "Update" : "Uninstall"}
        </ButtonV2>
      </div>
      <p class="mt-4 whitespace-pre-wrap text-13-regular leading-5 text-text-base">{props.listing.item.description}</p>
      <Show when={installed()}>
        <div data-slot="marketplace-component-list" class="mt-5 rounded-lg">
          <ToggleRow
            title={language.t("marketplace.component.plugin.title")}
            description={language.t("marketplace.component.plugin.description")}
            checked={enabled()}
            disabled={props.busy}
            change={(checked) =>
              props.toggle(
                "package",
                undefined,
                checked,
                `${checked ? "Enabled" : "Disabled"} ${props.listing.item.name}`,
              )
            }
          />
          <For each={skills()}>
            {(skill) => {
              const checked = () => marketplaceSkillEnabled(props.config, props.listing.key, skill.id)
              return (
                <ToggleRow
                  title={skill.name}
                  description={skill.description ?? skill.path ?? skill.url ?? "Marketplace skill"}
                  checked={checked()}
                  disabled={props.busy || !enabled()}
                  change={(value) =>
                    props.toggle("skill", skill.id, value, `${value ? "Enabled" : "Disabled"} skill ${skill.name}`)
                  }
                />
              )
            }}
          </For>
          <For each={mcp()}>
            {(name) => {
              const checked = () => marketplaceMcpEnabled(props.config, props.listing.key, name)
              return (
                <ToggleRow
                  title={name}
                  description="MCP server"
                  checked={checked()}
                  disabled={props.busy || !enabled()}
                  change={(value) =>
                    props.toggle("mcp", name, value, `${value ? "Enabled" : "Disabled"} MCP server ${name}`)
                  }
                />
              )
            }}
          </For>
        </div>
      </Show>
      <div class="mt-5 grid grid-cols-2 gap-3 text-12-regular">
        <Meta
          label="Changes"
          value={marketplacePlanSummary(
            installed()?.materialized_plan ?? installed()?.plan ?? props.listing.item.install,
          )}
        />
        <Meta label="Trust" value={props.listing.source.trust ?? "community"} />
        <Meta label="License" value={props.listing.item.license ?? "Not specified"} />
        <Meta label="Catalog digest" value={props.listing.catalog_digest ?? "Built-in or not cached"} />
      </div>
    </div>
  )
}

function ToggleRow(props: {
  title: string
  description: string
  checked: boolean
  disabled: boolean
  change: (value: boolean) => void
}) {
  return (
    <div class="flex items-center justify-between gap-4 border-b border-border-weak p-3 last:border-b-0">
      <div>
        <div class="text-13-medium text-text-strong">{props.title}</div>
        <div class="mt-0.5 text-11-regular text-text-weak">{props.description}</div>
      </div>
      <Switch checked={props.checked} disabled={props.disabled} onChange={props.change} />
    </div>
  )
}

function Meta(props: { label: string; value: string }) {
  return (
    <div>
      <div class="text-11-medium uppercase text-text-weak">{props.label}</div>
      <div class="mt-1 break-all text-text-base">{props.value}</div>
    </div>
  )
}

function Sources(props: {
  sources: MarketplaceSource[]
  errors: MarketplaceView["errors"]
  busy: boolean
  sourceURL: string
  sourceName: string
  sourceTrust: MarketplaceConfiguredTrust
  sourceHeaderName: string
  sourceHeaderEnv: string
  setURL: (value: string) => void
  setName: (value: string) => void
  setTrust: (value: MarketplaceConfiguredTrust) => void
  setHeaderName: (value: string) => void
  setHeaderEnv: (value: string) => void
  add: () => void
  toggle: (source: MarketplaceSource) => void
  remove: (source: MarketplaceSource) => void
}) {
  return (
    <div data-slot="marketplace-content" class="min-h-0 flex-1 overflow-y-auto">
      <div data-slot="marketplace-source-form" class="space-y-2 rounded-lg p-3">
        <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem_9rem]">
          <TextInputV2
            appearance="base"
            value={props.sourceURL}
            onInput={(event) => props.setURL(event.currentTarget.value)}
            placeholder="HTTPS, github:owner/repository, or local path"
            aria-label="Marketplace source URL or local path"
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
          <TextInputV2
            appearance="base"
            value={props.sourceName}
            onInput={(event) => props.setName(event.currentTarget.value)}
            placeholder="Display name"
            aria-label="Marketplace source display name"
          />
          <SelectV2
            options={["community", "private"] as MarketplaceConfiguredTrust[]}
            current={props.sourceTrust}
            appearance="base"
            aria-label="Marketplace source trust"
            onSelect={(value) => value && props.setTrust(value)}
          />
        </div>
        <div class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TextInputV2
            appearance="base"
            value={props.sourceHeaderName}
            onInput={(event) => props.setHeaderName(event.currentTarget.value)}
            placeholder="Auth header (for example, PRIVATE-TOKEN)"
            aria-label="Marketplace authentication header"
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
          <TextInputV2
            appearance="base"
            value={props.sourceHeaderEnv}
            onInput={(event) => props.setHeaderEnv(event.currentTarget.value)}
            placeholder="Environment variable (for example, GITLAB_TOKEN)"
            aria-label="Marketplace authentication environment variable"
            spellcheck={false}
            autocorrect="off"
            autocomplete="off"
            autocapitalize="off"
          />
          <ButtonV2
            type="button"
            variant="neutral"
            disabled={
              props.busy ||
              !props.sourceURL.trim() ||
              Boolean(props.sourceHeaderName.trim()) !== Boolean(props.sourceHeaderEnv.trim())
            }
            onClick={props.add}
          >
            Add
          </ButtonV2>
        </div>
      </div>
      <div class="mt-3 space-y-2">
        <For each={props.sources}>
          {(source) => {
            const locked = source.id === OFFICIAL_MARKETPLACE_SOURCE.id
            return (
              <div data-slot="marketplace-source-card" class="flex items-center justify-between gap-4 rounded-lg p-3">
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-13-medium text-text-strong">{source.name}</span>
                    <span class="text-10-medium uppercase text-text-weak">{source.trust ?? "community"}</span>
                  </div>
                  <div class="mt-1 truncate text-11-regular text-text-weak">{source.reference ?? source.url}</div>
                  <Show when={source.header_env}>
                    {(headers) => (
                      <div class="mt-1 truncate text-10-regular text-text-weak">
                        {Object.entries(headers())
                          .map(([name, variable]) => `${name} ← ${variable}`)
                          .join(", ")}
                      </div>
                    )}
                  </Show>
                </div>
                <div class="flex items-center gap-2">
                  <Switch
                    checked={source.enabled !== false}
                    disabled={props.busy}
                    onChange={() => props.toggle(source)}
                  />
                  <ButtonV2
                    type="button"
                    size="small"
                    variant="ghost-muted"
                    disabled={props.busy || locked}
                    onClick={() => props.remove(source)}
                  >
                    Remove
                  </ButtonV2>
                </div>
              </div>
            )
          }}
        </For>
      </div>
      <Show when={props.errors.length}>
        <div class="mt-3 rounded-md border border-border-warning p-3 text-12-regular text-text-base">
          <For each={props.errors}>
            {(error) => (
              <div>
                {error.source.name}: {error.message}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
