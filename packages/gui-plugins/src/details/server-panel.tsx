import type { PluginInfo } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { ErrorDetails } from "@opencode/ui/error-details"
import { Icon } from "@opencode/ui/icon"
import { Switch } from "@opencode/ui/switch"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { TruncatedText } from "@opencode/ui/truncated-text"
import { useMutation } from "@tanstack/solid-query"
import {
  children,
  createMemo,
  createResource,
  createSignal,
  createUniqueId,
  For,
  Index,
  on,
  onCleanup,
  Show,
  type Component,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createKeyed, useDrawer, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { globalConfigDirectory, serviceConfigFile } from "./config-file"
import { configuredLsps } from "./configured-lsp"
import { builtinContext } from "@opencode/plugin/gui/builtin"

const services = [
  { type: "mcp", icon: "mcp", label: "mcp" },
  { type: "plugins", icon: "cube", label: "plugins" },
  { type: "skills", icon: "graduation-cap", label: "skills" },
  { type: "lsp", icon: "code-slash", label: "lsp" },
] as const

type Service = (typeof services)[number]["type"]

type ServiceProps = {
  session: MountedSession
  directory: string
  shown: boolean
  /** Closes the details popover, once an action opened something beside it. */
  onClose?: () => void
}

/** One service's list: its load state, what its row summarises, and the list itself. */
type ServiceSource = {
  readonly loading: boolean
  readonly ready: boolean
  readonly error: boolean
  readonly count: number
  readonly failed: boolean
  retry: () => void
  Body: Component
}

// How long a pointer may rest inside the safe triangle before the row under it takes over.
const AIM_TIMEOUT = 100

export function SessionServerPanel(props: ServiceProps & { mobile?: boolean }) {
  const ctx = usePlugin()
  const name = () => (ctx.servers.list().length < 2 ? ctx.t("server") : props.session.server.name)

  return (
    <Show
      when={props.directory}
      keyed
      fallback={
        <section class="session-summary-card" data-section="server">
          <ServerHeading name={name()} />
        </section>
      }
    >
      {(directory) => (
        <ServiceMenu
          session={props.session}
          directory={directory}
          shown={props.shown}
          mobile={props.mobile}
          name={name()}
          onClose={props.onClose}
        />
      )}
    </Show>
  )
}

function ServerHeading(props: { name: string }) {
  return (
    <h2 class="session-summary-row session-summary-heading">
      <span dir="auto" class="session-summary-label">
        {props.name}
      </span>
    </h2>
  )
}

function ServiceMenu(props: ServiceProps & { mobile?: boolean; name: string }) {
  const ctx = usePlugin()
  const drawer = useDrawer()
  const id = createUniqueId()

  // A new scope whenever visibility changes closes the flyout.
  const scope = createMemo(
    on(
      () => props.shown,
      () => ({}),
    ),
  )

  // A signal, not a store field: a store would wrap the scope object and never match it.
  const [open, setOpen] = createSignal<{ readonly scope: object; readonly service: Service }>()

  const [menu, setMenu] = createStore<{
    // The pane on show, kept through the flyout's exit so it fades out with its list.
    pane: Service | undefined
    // Where the trigger row sits in the flyout's containing block, and the room around it in the viewport.
    anchor: { row: number; above: number; below: number }
    heights: Partial<Record<Service, number>>
    overflow: Partial<Record<Service, boolean>>
  }>({ pane: undefined, anchor: { row: 0, above: 0, below: 0 }, heights: {}, overflow: {} })

  const sources: Record<Service, ServiceSource> = {
    mcp: useMcp(props, () => close()),
    plugins: useCatalog(props, "plugins"),
    skills: useCatalog(props, "skills"),
    lsp: useLsp(props),
  }

  const active = () => {
    const current = open()

    return current?.scope === scope() ? current.service : undefined
  }

  const height = () => (menu.pane ? (menu.heights[menu.pane] ?? 0) : 0) + 4
  // Beside its row, kept inside the viewport.
  const offset = () => Math.max(-menu.anchor.above, Math.min(menu.anchor.row - 2, menu.anchor.below - height()))

  const rows: Partial<Record<Service, HTMLButtonElement>> = {}
  const panes: Partial<Record<Service, HTMLElement>> = {}
  let flyout: HTMLDivElement | undefined
  let surface: HTMLDivElement | undefined
  // The flyout's containing block in the viewport, measured when a list opens and on scroll or resize, so pointer
  // moves never read layout.
  const bounds = { left: 0, right: 0, top: 0 }
  // Each list refreshes the first time it shows after the flyout opens.
  const refreshed = new Set<Service>()
  // The two latest pointer positions at least 2px apart, which give the pointer's heading.
  const trail = { x: 0, y: 0, px: 0, py: 0 }
  let pending: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(pending))

  // Places the flyout beside a row: where the row sits in the containing block, and the room around it.
  const measure = (service: Service) => {
    const row = rows[service]
    const box = flyout?.offsetParent

    if (!row || !box) return false
    const base = box.getBoundingClientRect()

    bounds.left = base.left
    bounds.right = base.right
    bounds.top = base.top
    setMenu("anchor", {
      row: row.getBoundingClientRect().top - base.top,
      above: base.top - 16,
      below: window.innerHeight - 16 - base.top,
    })

    return true
  }

  const activate = (service: Service, focus = false) => {
    clearTimeout(pending)

    if (!flyout || !surface) return
    const opening = active() === undefined

    if (!refreshed.has(service)) {
      refreshed.add(service)

      if (!sources[service].loading) sources[service].retry()
    }

    // The first open lands beside its row at its list's height; later switches glide and resize.
    if (opening) {
      flyout.style.transition = "none"
      surface.style.transition = "none"
    }

    if (!measure(service)) return
    setOpen({ scope: scope(), service })
    setMenu("pane", service)

    if (opening) {
      void flyout.offsetHeight
      flyout.style.removeProperty("transition")
      surface.style.removeProperty("transition")
    }

    if (focus) {
      const pane = panes[service]

      if (pane) (focusables(pane)[0] ?? pane).focus()
    }
  }

  const close = (focus = false) => {
    clearTimeout(pending)
    const service = active()

    // Focus returns to the row before the list goes inert, so it never falls to the document.
    if (focus && service) rows[service]?.focus()
    refreshed.clear()
    setOpen(undefined)
  }

  // Moving between rows switches at once, except while the pointer heads for the open flyout across other rows.
  const hover = (event: PointerEvent) => {
    if (event.pointerType === "touch") return

    if (Math.hypot(event.clientX - trail.x, event.clientY - trail.y) >= 2) {
      trail.px = trail.x
      trail.py = trail.y
      trail.x = event.clientX
      trail.y = event.clientY
    }

    // A closed flyout opens when the pointer enters a row, so a pointer resting where Escape closed it stays put.
    if (!active()) return
    const target = event.target

    const service =
      target instanceof Node ? services.find((item) => rows[item.type]?.contains(target))?.type : undefined

    if (!service || service === active()) return clearTimeout(pending)

    if (!aiming(event)) return activate(service)
    clearTimeout(pending)
    pending = setTimeout(() => activate(service), AIM_TIMEOUT)
  }

  // Whether the pointer's last step points into the open flyout: inside the triangle from its previous position to
  // the flyout's near edge.
  const aiming = (event: PointerEvent) => {
    if (!active()) return false
    // The flyout sits against the containing block's inline start, where it is heading rather than where it is.
    const edge = ctx.locale.direction() === "rtl" ? bounds.right : bounds.left
    const top = bounds.top + offset()

    return insideTriangle(
      { x: event.clientX, y: event.clientY },
      { x: trail.px, y: trail.py },
      { x: edge, y: top - 8 },
      { x: edge, y: top + height() + 8 },
    )
  }

  const keydown = (event: KeyboardEvent) => {
    const target = event.target

    if (!(target instanceof HTMLElement)) return
    const rtl = ctx.locale.direction() === "rtl"
    const into = rtl ? "ArrowLeft" : "ArrowRight"
    const back = rtl ? "ArrowRight" : "ArrowLeft"
    const row = services.findIndex((item) => rows[item.type] === target)

    if (row !== -1) {
      if (event.key === into) {
        event.preventDefault()
        activate(services[row].type, true)
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      event.preventDefault()
      const next = services[(row + (event.key === "ArrowDown" ? 1 : services.length - 1)) % services.length].type
      rows[next]?.focus()

      if (active()) activate(next)

      return
    }

    const pane = menu.pane ? panes[menu.pane] : undefined

    if (!pane?.contains(target)) return

    if (event.key === back) {
      event.preventDefault()
      close(true)

      return
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const items = focusables(pane)
    const index = items.findIndex((item) => item === target || item.contains(target))
    const step = event.key === "ArrowDown" ? 1 : -1
    items[index === -1 ? 0 : (index + step + items.length) % items.length]?.focus()
  }

  // While a list is open: Escape closes only the flyout, before the details popover's own Escape handling sees it,
  // and scrolling or resizing measures the flyout's place again.
  createKeyed(
    () => active() !== undefined,
    () => {
      const remeasure = () => {
        const service = active()

        if (service) measure(service)
      }

      const escape = (event: KeyboardEvent) => {
        const focused = document.activeElement

        if (event.key !== "Escape" || !focused || !flyout?.offsetParent?.contains(focused)) return
        event.preventDefault()
        event.stopPropagation()
        close(!!flyout?.contains(focused))
      }

      document.addEventListener("keydown", escape, true)
      document.addEventListener("scroll", remeasure, { capture: true, passive: true })
      window.addEventListener("resize", remeasure)
      onCleanup(() => {
        document.removeEventListener("keydown", escape, true)
        document.removeEventListener("scroll", remeasure, true)
        window.removeEventListener("resize", remeasure)
      })
    },
  )

  // Measures each list, so the flyout clips to the one on show and knows when it scrolls.
  const observer = new ResizeObserver((entries) =>
    entries.forEach((entry) => {
      const service = services.find((item) => panes[item.type]?.contains(entry.target))?.type
      const pane = service ? panes[service] : undefined

      if (!service || !pane) return
      setMenu("heights", service, pane.offsetHeight)
      setMenu("overflow", service, pane.scrollHeight > pane.clientHeight + 1)
    }),
  )

  onCleanup(() => observer.disconnect())

  if (props.mobile && drawer) {
    return (
      <section class="session-summary-card" data-section="server">
        <ServerHeading name={props.name} />
        <div class="session-summary-rows">
          <For each={services}>
            {(service) => {
              const source = sources[service.type]
              // In a narrow-screen drawer the service list replaces the drawer's view.

              const content = children(() => (
                <div class="session-summary-card session-service-drawer" aria-busy={source.loading}>
                  <ServiceBody source={source}>
                    <source.Body />
                  </ServiceBody>
                </div>
              ))

              return (
                <button
                  type="button"
                  class="session-summary-row"
                  onClick={(event) => {
                    if (!source.loading) source.retry()
                    drawer.open({ title: ctx.t(service.label), content: content(), trigger: event.currentTarget })
                  }}
                >
                  <Icon name={service.icon} class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="session-summary-label">{ctx.t(service.label)}</span>
                  <Icon name="chevron-right" class="session-summary-menu-indicator shrink-0 text-v2-icon-icon-muted" />
                </button>
              )
            }}
          </For>
        </div>
      </section>
    )
  }

  return (
    <>
      <section class="session-summary-card" data-section="server" onKeyDown={keydown}>
        <ServerHeading name={props.name} />
        <div class="session-summary-rows" onPointerMove={hover} onPointerLeave={() => clearTimeout(pending)}>
          <For each={services}>
            {(service) => {
              const source = sources[service.type]

              return (
                <button
                  ref={(element) => (rows[service.type] = element)}
                  type="button"
                  class="session-summary-row session-service-trigger"
                  data-expanded={active() === service.type || undefined}
                  aria-expanded={active() === service.type}
                  aria-controls={`${id}-${service.type}`}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== "touch" && active() === undefined) activate(service.type)
                  }}
                  onClick={(event) => activate(service.type, event.detail === 0)}
                >
                  <Icon name={service.icon} class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="session-summary-label">{ctx.t(service.label)}</span>
                  <Show when={source.ready && !source.error}>
                    <Show when={source.failed}>
                      <span class="session-service-dot" data-status="failed" aria-hidden="true" />
                    </Show>
                    <Show when={source.count}>
                      <span class="session-service-count" aria-hidden="true">
                        {source.count}
                      </span>
                    </Show>
                  </Show>
                  <Icon
                    name="chevron-right"
                    class="session-summary-menu-indicator session-service-chevron shrink-0 text-v2-icon-icon-muted"
                  />
                </button>
              )
            }}
          </For>
        </div>
      </section>
      <div
        ref={flyout}
        class="session-service-flyout"
        data-open={active() !== undefined || undefined}
        inert={active() === undefined || undefined}
        style={{ transform: `translateY(${offset()}px)` }}
        onKeyDown={keydown}
        onPointerEnter={() => clearTimeout(pending)}
      >
        <div class="session-service-flyout-body">
          <div ref={surface} class="session-service-flyout-surface" style={{ "--flyout-height": `${height()}px` }}>
            <For each={services}>
              {(service) => {
                const source = sources[service.type]

                return (
                  <div
                    ref={(element) => {
                      panes[service.type] = element
                      observer.observe(element)
                    }}
                    id={`${id}-${service.type}`}
                    class="session-service-pane"
                    role="group"
                    tabIndex={-1}
                    aria-label={ctx.t(service.label)}
                    aria-busy={source.loading}
                    data-service={service.type}
                    data-active={menu.pane === service.type || undefined}
                    data-overflow={menu.overflow[service.type] || undefined}
                    inert={menu.pane !== service.type || undefined}
                  >
                    <div ref={(element) => observer.observe(element)} class="session-service-pane-content">
                      <ServiceBody source={source}>
                        <source.Body />
                      </ServiceBody>
                    </div>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </>
  )
}

function useLsp(props: ServiceProps): ServiceSource {
  const ctx = usePlugin()
  const data = () => props.session.server.data

  const [load, { refetch }] = createResource(
    () => props.shown && data(),
    (current) => {
      const directory = props.directory

      current.location.config.invalidate({ directory })

      return current.location.config.sync({ directory })
    },
  )

  const names = createMemo(() => configuredLsps(data().location.config.list({ directory: props.directory }) ?? []))

  createKeyed(data, (current) =>
    onCleanup(
      current.on("config.updated", (event) => {
        if (event.location?.directory !== props.directory) return
        void refetch()
      }),
    ),
  )

  return {
    get loading() {
      return load.loading
    },
    get ready() {
      return data().location.config.list({ directory: props.directory }) !== undefined
    },
    get error() {
      return !!load.error
    },
    get count() {
      return names().length
    },
    failed: false,
    retry: () => void refetch(),
    Body: () => (
      <Show when={names().length} fallback={<ServiceEmpty owner={props} title={ctx.t("lsp.empty")} service="lsp" />}>
        <For each={names()}>
          {(name) => (
            <div class="session-service-row">
              <TruncatedText text={name} class="session-summary-label" />
            </div>
          )}
        </For>
        <div class="session-service-footer">
          <span class="session-service-config-separator" role="separator" />
          <ServiceConfigLink owner={props} service="lsp" />
        </div>
      </Show>
    ),
  }
}

function useMcp(props: ServiceProps, close: () => void): ServiceSource {
  const ctx = usePlugin()
  const data = () => props.session.server.data

  const toggle = useMcpToggle(props.session, () => props.directory)

  const [load, { refetch }] = createResource(
    () => props.shown && data(),
    async (current) => {
      const directory = props.directory

      current.location.mcp.server.invalidate({ directory })
      await current.location.mcp.server.sync({ directory })
    },
  )

  const servers = createMemo(() =>
    (data().location.mcp.server.list({ directory: props.directory }) ?? []).toSorted((a, b) =>
      a.name.localeCompare(b.name),
    ),
  )

  const showError = (name: string) =>
    ctx.dialogs.open((dialog) => (
      <McpErrorDialog session={props.session} directory={props.directory} name={name} onClose={dialog.close} />
    ))

  return {
    get loading() {
      return load.loading
    },
    get ready() {
      return data().location.mcp.server.list({ directory: props.directory }) !== undefined
    },
    get error() {
      return !!load.error
    },
    get count() {
      return servers().length
    },
    get failed() {
      return servers().some((server) => server.status.status === "failed")
    },
    retry: () => void refetch(),
    Body: () => (
      <Show when={servers().length} fallback={<ServiceEmpty owner={props} title={ctx.t("mcp.empty")} service="mcp" />}>
        <Index each={servers()}>
          {(server) => {
            const enabled = () => server().status.status !== "disabled"
            const pending = () => toggle.isPending || server().status.status === "pending"

            const failure = () => {
              const status = server().status

              return status.status === "failed" ? status.error : undefined
            }

            const signIn = () => server().status.status === "needs_auth" && !!server().integrationID
            const busy = () => toggle.isPending && toggle.variables?.name === server().name

            // The dot shows the status; the words stay for assistive technology.
            const label = () => {
              const status = server().status.status

              if (status === "pending") return ctx.t("connecting")

              if (status === "needs_auth") return ctx.t("needsAuth")

              if (status === "failed") return ctx.t("failed")

              return ctx.t(status === "connected" ? "mcp.connected" : "mcp.disabled")
            }

            const change = (value: boolean) => {
              if (pending()) return
              toggle.mutate({ name: server().name, enabled: value })
            }

            const follow = () => {
              if (failure()) return showError(server().name)
              change(server().status.status === "needs_auth" || !enabled())
            }

            return (
              <div
                class="session-mcp-row"
                data-status={server().status.status}
                data-disabled={pending() || undefined}
                onClick={follow}
              >
                <span class="session-mcp-name">
                  <StatusDot
                    status={server().status.status}
                    error={failure()}
                    label={ctx.t("mcp.error.actionLabel", { name: server().name })}
                    onClick={() => showError(server().name)}
                  />
                  <TruncatedText text={server().name} class="session-summary-label" />
                </span>
                <span class="session-mcp-trailing" onClick={(event) => event.stopPropagation()}>
                  <Show
                    when={signIn()}
                    fallback={
                      <Switch
                        checked={enabled()}
                        readOnly={pending()}
                        aria-disabled={pending()}
                        aria-busy={busy()}
                        description={label()}
                        class="[&_[data-slot=switch-description]]:sr-only"
                        onChange={change}
                      >
                        <span class="sr-only">{server().name}</span>
                      </Switch>
                    }
                  >
                    <Button
                      size="small"
                      variant="ghost-muted"
                      class="session-mcp-sign-in"
                      disabled={pending()}
                      aria-busy={busy()}
                      aria-label={ctx.t("mcp.signIn.open", { name: server().name })}
                      onClick={follow}
                    >
                      {ctx.t(busy() ? "mcp.signingIn" : "mcp.signIn")}
                    </Button>
                  </Show>
                </span>
              </div>
            )
          }}
        </Index>
        <div class="session-service-footer">
          <span class="session-service-config-separator" role="separator" />
          <ServiceConfigLink owner={props} service="mcp" />
          <button
            type="button"
            class="session-service-config"
            onClick={() => {
              close()
              builtinContext(ctx).layout.command("mcp.toggle")
            }}
          >
            <Icon name="mcp" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 truncate">{ctx.t("mcp.manage")}</span>
          </button>
        </div>
      </Show>
    ),
  }
}

function useCatalog(props: ServiceProps, service: "plugins" | "skills"): ServiceSource {
  const ctx = usePlugin()
  const data = () => props.session.server.data

  const [items, { refetch }] = createResource(
    () => props.shown && data(),
    async (current) => {
      const directory = props.directory

      if (service === "plugins") {
        const result = await props.session.server.client.plugin.list({ location: { directory } })

        return result.data
          .filter((plugin) => plugin.source.type !== "builtin")
          .map((plugin) => ({
            name: pluginLabel(plugin),
            status: plugin.state.status,
            error: plugin.state.status === "failed" ? plugin.state.error : undefined,
            path: undefined,
          }))
      }

      current.location.skill.invalidate({ directory })
      await current.location.skill.sync({ directory })

      return undefined
    },
  )

  const loaded = () => items.state === "ready" || items.state === "refreshing"

  const list = createMemo(() => {
    const entries =
      service === "plugins"
        ? loaded()
          ? (items.latest ?? [])
          : []
        : (data().location.skill.list({ directory: props.directory }) ?? []).map((skill) => ({
            name: skill.name,
            status: undefined,
            error: undefined,
            path: skill.path,
          }))

    return entries.toSorted((a, b) => a.name.localeCompare(b.name))
  })

  createKeyed(data, (current) =>
    onCleanup(
      current.on(service === "plugins" ? "plugin.updated" : "skill.updated", (event) => {
        if (event.location?.directory !== props.directory) return
        void refetch()
      }),
    ),
  )

  return {
    get loading() {
      return items.loading
    },
    get ready() {
      return service === "plugins" ? loaded() : data().location.skill.list({ directory: props.directory }) !== undefined
    },
    get error() {
      return !!items.error
    },
    get count() {
      return list().length
    },
    get failed() {
      return list().some((item) => item.status === "failed")
    },
    retry: () => void refetch(),
    Body: () => (
      <Show
        when={list().length}
        fallback={
          <ServiceEmpty
            owner={props}
            title={ctx.t(service === "plugins" ? "plugins.empty" : "skills.empty")}
            service={service}
          />
        }
      >
        <For each={list()}>
          {(item) => (
            <Show
              when={item.path}
              fallback={
                <div class="session-service-row" data-status={item.status}>
                  <Show when={item.status}>
                    {(status) => (
                      <>
                        <StatusDot status={status()} error={item.error} />
                        <Show when={status() === "failed"}>
                          <span class="sr-only">{ctx.t("failed")}</span>
                        </Show>
                      </>
                    )}
                  </Show>
                  <TruncatedText text={item.name} class="session-summary-label" />
                </div>
              }
            >
              {(path) => (
                // A skill opens its SKILL.md in a side tab.
                <button
                  type="button"
                  class="session-service-row session-service-file"
                  onClick={() => {
                    if (ctx.links.open({ href: path(), session: props.session })) props.onClose?.()
                  }}
                >
                  <Icon name="file-document" class="shrink-0 text-v2-icon-icon-muted" />
                  <TruncatedText text={item.name} class="session-summary-label" />
                </button>
              )}
            </Show>
          )}
        </For>
        <div class="session-service-footer">
          <span class="session-service-config-separator" role="separator" />
          <Show when={service === "skills"}>
            <ServiceSetup owner={props} service={service} />
          </Show>
          <ServiceConfigLink owner={props} service={service} />
        </div>
      </Show>
    ),
  }
}

// A status dot. A failed one shows its error on hover and, given an action, opens the full error.
function StatusDot(props: { status: string; error?: string; label?: string; onClick?: () => void }) {
  return (
    <Show
      when={props.error}
      fallback={<span class="session-service-dot" data-status={props.status} aria-hidden="true" />}
    >
      {(error) => (
        <Tooltip
          value={<span class="session-service-error">{error()}</span>}
          placement="top"
          openDelay={0}
          class="session-service-dot-tip"
        >
          <Show
            when={props.onClick}
            fallback={<span class="session-service-dot" data-status={props.status} aria-hidden="true" />}
          >
            <button
              type="button"
              class="session-service-dot"
              data-status={props.status}
              aria-label={props.label}
              onClick={(event) => {
                event.stopPropagation()
                props.onClick?.()
              }}
            />
          </Show>
        </Tooltip>
      )}
    </Show>
  )
}

function ServiceBody(props: { source: ServiceSource; children: JSX.Element }) {
  const ctx = usePlugin()

  return (
    <Show
      when={props.source.ready || !props.source.loading}
      fallback={
        <div class="session-service-message" role="status">
          {ctx.t("common.loading")}
        </div>
      }
    >
      <Show
        when={!props.source.error}
        fallback={
          <div class="session-service-message" role="alert">
            <p>{ctx.t("common.requestFailed")}</p>
            <button type="button" class="session-summary-row" onClick={() => props.source.retry()}>
              {ctx.t("retry")}
            </button>
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  )
}

function ServiceConfigLink(props: { owner: ServiceProps; service: Service }) {
  const ctx = usePlugin()
  const system = ctx.system
  const local = () => props.owner.session.server.local
  const [store, setStore] = createStore({ opening: false, copied: false })
  const label = () => ctx.t(local() ? "configure" : "copyConfigPath")
  // Clears the copied mark two seconds after the latest copy.
  let reset: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => clearTimeout(reset))

  const activate = async () => {
    if (store.opening) return
    setStore({ opening: true, copied: false })
    const session = props.owner.session
    await session.server.client.config
      .get({ location: { directory: props.owner.directory } })
      .then(async (entries) => {
        const path = serviceConfigFile(entries, props.service)

        if (!path) throw new Error(ctx.t("configFileMissing"))

        // A local file opens in a side tab beside the session, inside the workspace or not.
        if (local()) {
          if (ctx.links.open({ href: path, session })) return props.owner.onClose?.()
          await ctx.desktop?.reveal(path)

          return
        }

        await system.copy(path)
        setStore("copied", true)
        clearTimeout(reset)
        reset = setTimeout(() => setStore("copied", false), 2000)
      })
      .catch((error) =>
        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setStore("opening", false))
  }

  return (
    <Tooltip
      inactive={local()}
      value={ctx.t(store.copied ? "ui.message.copied" : "ui.message.copy")}
      placement="top"
      getAnchorRect={(anchor) => anchor?.querySelector("svg")?.getBoundingClientRect()}
      forceOpen={store.copied ? true : undefined}
      class="w-full"
    >
      <button
        type="button"
        class="session-service-config"
        disabled={store.opening}
        onMouseDown={(event) => {
          if (!local()) event.preventDefault()
        }}
        onClick={() => void activate()}
      >
        <Icon
          name={local() ? "settings-gear" : store.copied ? "check" : "outline-copy"}
          class="shrink-0 text-v2-icon-icon-muted"
        />
        <span class="session-summary-label">{label()}</span>
      </button>
    </Tooltip>
  )
}

// Starts a draft session in the global configuration's directory that asks OpenCode to set the service up.
function ServiceSetup(props: { owner: ServiceProps; service: Service }) {
  const ctx = usePlugin()
  const [store, setStore] = createStore({ opening: false })

  const start = async () => {
    if (store.opening) return
    setStore("opening", true)
    const session = props.owner.session
    await session.server.client.config
      .get({ location: { directory: props.owner.directory } })
      .then((entries) => {
        ctx.layout.draft({
          server: session.server.id,
          directory: globalConfigDirectory(entries, props.owner.directory),
          prompt: ctx.t(`setup.${props.service}.prompt`),
        })
        props.owner.onClose?.()
      })
      .catch((error) =>
        showToast({
          variant: "error",
          title: ctx.t("common.requestFailed"),
          description: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => setStore("opening", false))
  }

  return (
    <button type="button" class="session-service-config" disabled={store.opening} onClick={() => void start()}>
      <Icon name="plus" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="session-summary-label">{ctx.t(`setup.${props.service}`)}</span>
    </button>
  )
}

function ServiceEmpty(props: { owner: ServiceProps; title: string; service: Service }) {
  return (
    <div class="session-service-empty">
      <strong>{props.title}</strong>
      <div class="session-service-footer">
        <ServiceSetup owner={props.owner} service={props.service} />
        <span class="session-service-config-separator" role="separator" />
        <ServiceConfigLink owner={props.owner} service={props.service} />
      </div>
    </div>
  )
}

function pluginLabel(plugin: PluginInfo) {
  if (plugin.id) return plugin.id

  if (plugin.source.type === "package") return plugin.source.target

  if (plugin.source.type === "local") return plugin.source.path

  return plugin.source.type
}

function focusables(root: HTMLElement) {
  return [
    ...root.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])",
    ),
  ]
}

type Point = { x: number; y: number }

function insideTriangle(point: Point, a: Point, b: Point, c: Point) {
  const side = (p: Point, q: Point) => (q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x)
  const sides = [side(a, b), side(b, c), side(c, a)]

  return sides.every((value) => value >= 0) || sides.every((value) => value <= 0)
}

// Connects, disconnects, or starts sign-in for one of the session server's MCPs, like the app's MCP toggle.
function useMcpToggle(session: MountedSession, directory: () => string) {
  const ctx = usePlugin()
  const system = ctx.system
  const data = () => session.server.data

  return useMutation(() => ({
    mutationFn: async (input: { name: string; enabled: boolean }) => {
      const client = session.server.client
      const source = data()
      const ref = { directory: directory() }
      const server = (await client.mcp.list({ location: ref })).data.find((item) => item.name === input.name)

      if (!server) return

      if (!input.enabled) {
        await client.mcp.disconnect({ server: input.name, location: ref })
      }

      if (input.enabled && server.status.status !== "needs_auth") {
        await client.mcp.connect({ server: input.name, location: ref })
      }

      source.location.mcp.server.invalidate(ref)
      await source.location.mcp.server.sync(ref)
      const current = source.location.mcp.server.list(ref)?.find((item) => item.name === input.name)

      if (input.enabled && current?.status.status === "needs_auth" && current.integrationID) {
        const integration = await client.integration.get({ integrationID: current.integrationID, location: ref })
        const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)

        if (!method || method.type !== "oauth") throw new Error(ctx.t("mcp.interactiveAuth", { name: input.name }))

        const attempt = await client.integration.oauth.connect({
          integrationID: current.integrationID,
          methodID: method.id,
          location: ref,
        })

        system.openExternal(attempt.data.url)
      }

      source.location.mcp.resource.invalidate(ref)
      await source.location.mcp.resource.sync(ref)
      // A successful HTTP response can still leave the MCP connection in a failed state.
      const status = current?.status

      if (status?.status === "failed") throw new Error(`${input.name}: ${status.error}`)
    },
    onError: (error) =>
      showToast({
        variant: "error",
        title: ctx.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
  }))
}

// The MCPs dialog's error view, for a server the popover lists. It reads the server's own data, so it outlives the
// popover that opened it.
function McpErrorDialog(props: { session: MountedSession; directory: string; name: string; onClose: () => void }) {
  const ctx = usePlugin()
  const toggle = useMcpToggle(props.session, () => props.directory)
  const [copied, setCopied] = createSignal(false)

  const failure = () => {
    const server = props.session.server.data.location.mcp.server
      .list({ directory: props.directory })
      ?.find((item) => item.name === props.name)

    return server?.status.status === "failed" ? { name: server.name, error: server.status.error } : undefined
  }

  // A successful retry, disabling, or a removed server leaves nothing to show.
  createKeyed(
    () => !!failure(),
    () => undefined,
    { otherwise: props.onClose },
  )

  return (
    <Show when={failure()}>
      {(current) => (
        <Dialog class="session-mcp-error">
          <DialogHeader>
            <DialogTitleGroup
              title={
                <span dir="auto" class="[overflow-wrap:anywhere]">
                  {current().name}
                </span>
              }
              description={ctx.t("mcp.error.status")}
            />
          </DialogHeader>
          <DialogBody class="session-mcp-error-body">
            <ErrorDetails error={current().error}>
              <Button
                class="error-details-copy"
                variant="ghost-muted"
                icon={copied() ? "check" : "copy"}
                onClick={() =>
                  void ctx.system
                    .copy(ctx.t("mcp.error.details", { name: current().name, error: current().error }))
                    .then(() => setCopied(true))
                    .catch((error) =>
                      showToast({
                        variant: "error",
                        title: ctx.t("mcp.error.copyFailed"),
                        description: error instanceof Error ? error.message : String(error),
                      }),
                    )
                }
              >
                {ctx.t(copied() ? "common.copied" : "mcp.error.copy")}
              </Button>
              <Button
                variant="ghost"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ name: props.name, enabled: false })}
              >
                {ctx.t("mcp.error.disable")}
              </Button>
              <Button
                variant="neutral"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ name: props.name, enabled: true })}
              >
                {ctx.t("common.retry")}
              </Button>
            </ErrorDetails>
          </DialogBody>
        </Dialog>
      )}
    </Show>
  )
}
