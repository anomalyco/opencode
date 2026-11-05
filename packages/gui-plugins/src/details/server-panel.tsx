import type { PluginInfo } from "@opencode/client"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { ErrorDetails } from "@opencode/ui/error-details"
import { Icon } from "@opencode/ui/icon"
import { Loader } from "@opencode/ui/loader"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { Switch } from "@opencode/ui/switch"
import { TextInput } from "@opencode/ui/text-input"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { TruncatedText } from "@opencode/ui/truncated-text"
import {
  children,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  Index,
  onCleanup,
  onMount,
  Show,
  untrack,
  type Accessor,
  type Component,
  type JSX,
} from "solid-js"
import { createStore } from "solid-js/store"
import { createKeyed, useDrawer, usePlugin, type MountedSession, type ServerRef } from "@opencode/plugin/gui"
import { globalConfigDirectory, serviceConfigFile } from "./config-file"
import { builtinContext } from "@opencode/plugin/gui/builtin"
import { createFlyoutMotion } from "./flyout-motion"
import {
  configActionView,
  initialConfigActionState,
  transitionConfigAction,
  type ConfigActionEffect,
  type ConfigActionEvent,
  type ConfigActionState,
} from "./config-action-machine"
import {
  flyoutActive,
  flyoutAnchor,
  flyoutPane,
  initialFlyoutState,
  sameAnchor,
  transitionFlyout,
  type FlyoutAnchor,
  type FlyoutEvent,
  type FlyoutState,
  type Service,
} from "./flyout-machine"
import {
  initialMcpState,
  mcpDialogView,
  mcpRowView,
  transitionMcp,
  type McpEffect,
  type McpEvent,
  type McpServerStatus,
  type McpState,
} from "./mcp-machine"
import {
  selectMcpSignInView,
  startMcpSignIn,
  transitionMcpSignIn,
  type McpSignInEffect,
  type McpSignInEvent,
  type McpSignInFailure,
} from "./mcp-sign-in-machine"
import {
  initialServiceLoadState,
  serviceLoadView,
  transitionServiceLoad,
  type ServiceLoadEffect,
  type ServiceLoadEvent,
  type ServiceLoadState,
  type ServiceLoadView,
} from "./service-load-machine"

const services = [
  { type: "mcp", icon: "mcp", label: "mcp" },
  { type: "plugins", icon: "cube", label: "plugins" },
  { type: "skills", icon: "graduation-cap", label: "skills" },
] as const satisfies readonly { type: Service; icon: string; label: string }[]

type ServiceProps = {
  session: MountedSession
  directory: string
  shown: boolean
  /** Closes the details popover, once an action opened something beside it. */
  onClose?: () => void
}

/** One service's list: its load state, what its row summarises, and the list itself. */
type ServiceSource = {
  readonly view: ServiceLoadView<unknown>
  readonly count: number
  readonly failed: boolean
  /** Loads the list again when it opens; joins a load that runs. */
  refresh: () => void
  retry: () => void
  Body: Component
  /** The actions under the list, outside its scroll box so they stay in view. */
  Footer: Component
}

export function SessionServerPanel(props: ServiceProps & { mobile?: boolean; mcp: McpControllers }) {
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
        // Another server starts its lists and flyout afresh.
        <Show when={props.session.server.id} keyed>
          <ServiceMenu
            session={props.session}
            directory={directory}
            shown={props.shown}
            mobile={props.mobile}
            name={name()}
            mcp={props.mcp}
            onClose={props.onClose}
          />
        </Show>
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

function ServiceMenu(props: ServiceProps & { mobile?: boolean; name: string; mcp: McpControllers }) {
  const ctx = usePlugin()
  const drawer = useDrawer()
  const id = createUniqueId()
  const motion = createFlyoutMotion()

  const [flyoutState, setFlyoutState] = createSignal<FlyoutState>(initialFlyoutState)

  // Each list's measured height, and whether it scrolls.
  const [sizes, setSizes] = createStore<{
    heights: Partial<Record<Service, number>>
    overflow: Partial<Record<Service, boolean>>
  }>({ heights: {}, overflow: {} })

  const sources: Record<Service, ServiceSource> = {
    mcp: useMcp(props, props.mcp, () => dispatch({ type: "close", focusRow: false })),
    plugins: usePlugins(props),
    skills: useSkills(props),
  }

  // Memos, so a pointer aiming across rows, which replaces the state on each new target, rewrites nothing on screen.
  const active = createMemo(() => flyoutActive(flyoutState()))
  const pane = createMemo(() => flyoutPane(flyoutState()))
  const anchor = createMemo(() => flyoutAnchor(flyoutState()), undefined, { equals: sameAnchor })

  const height = () => {
    const current = pane()

    return (current ? (sizes.heights[current] ?? 0) : 0) + 4
  }

  // Beside its row, kept inside the viewport.
  const offset = () => Math.max(-anchor().above, Math.min(anchor().row - 2, anchor().below - height()))

  const rows: Partial<Record<Service, HTMLButtonElement>> = {}
  const panes: Partial<Record<Service, HTMLElement>> = {}
  const scrollers: Partial<Record<Service, HTMLElement>> = {}
  let flyout: HTMLDivElement | undefined
  let surface: HTMLDivElement | undefined
  // The flyout's containing block in the viewport, measured when a list opens and on scroll or resize, so pointer
  // moves never read layout.
  const bounds = { left: 0, right: 0, top: 0 }
  // The two latest pointer positions at least 2px apart, which give the pointer's heading.
  const trail = { x: 0, y: 0, px: 0, py: 0 }
  let aimTimer: ReturnType<typeof setTimeout> | undefined

  // Places the flyout beside a row: where the row sits in the containing block, and the room around it. Undefined
  // while the flyout or the row is not laid out.
  const measure = (service: Service): FlyoutAnchor | undefined => {
    const row = rows[service]
    const box = flyout?.offsetParent

    if (!row || !box || !surface) return
    const base = box.getBoundingClientRect()

    bounds.left = base.left
    bounds.right = base.right
    bounds.top = base.top

    return {
      row: row.getBoundingClientRect().top - base.top,
      above: base.top - 16,
      below: window.innerHeight - 16 - base.top,
    }
  }

  const dispatch = (event: FlyoutEvent) => {
    const previous = untrack(flyoutState)
    const next = transitionFlyout(previous, event)

    // Focus returns to the row before the list goes inert, so it never falls to the document.
    next.effects.forEach((effect) => {
      if (effect.type === "focus-row") rows[effect.service]?.focus()
    })

    if (next.state !== previous)
      commit(
        next.state,
        next.effects.some((effect) => effect.type === "snap-open"),
      )

    next.effects.forEach((effect) => {
      if (effect.type === "schedule-aim") {
        clearTimeout(aimTimer)
        aimTimer = setTimeout(
          () => dispatch({ type: "aim.due", attempt: effect.attempt, anchor: measure(effect.target) }),
          effect.delayMs,
        )
      }

      if (effect.type === "cancel-aim") clearTimeout(aimTimer)

      if (effect.type === "refresh") sources[effect.service].refresh()

      if (effect.type === "focus-pane") {
        const element = panes[effect.service]

        if (element) (focusables(element)[0] ?? element).focus()
      }
    })
  }

  // The first open lands beside its row at its list's height; later switches glide and resize.
  const commit = (state: FlyoutState, snap: boolean) => {
    if (!snap || !flyout || !surface) return void setFlyoutState(state)
    flyout.style.transition = "none"
    surface.style.transition = "none"
    setFlyoutState(state)
    void flyout.offsetHeight
    flyout.style.removeProperty("transition")
    surface.style.removeProperty("transition")
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

    const current = active()

    // A closed flyout opens when the pointer enters a row, so a pointer resting where Escape closed it stays put.
    if (!current) return
    const target = event.target

    const service =
      target instanceof Node ? services.find((item) => rows[item.type]?.contains(target))?.type : undefined

    const heading = !!service && service !== current && aiming(event)

    dispatch({
      type: "row.moved",
      service,
      aiming: heading,
      anchor: service && service !== current && !heading ? measure(service) : undefined,
    })
  }

  // Whether the pointer's last step points into the open flyout: inside the triangle from its previous position to
  // the flyout's near edge.
  const aiming = (event: PointerEvent) => {
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
        const service = services[row].type
        dispatch({ type: "row.activated", service, focus: true, shown: props.shown, anchor: measure(service) })
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
      event.preventDefault()
      const next = services[(row + (event.key === "ArrowDown" ? 1 : services.length - 1)) % services.length].type
      rows[next]?.focus()
      // An open flyout follows the focused row.
      dispatch({ type: "row.moved", service: next, aiming: false, anchor: active() ? measure(next) : undefined })

      return
    }

    const current = pane()
    const element = current ? panes[current] : undefined

    if (!element?.contains(target)) return

    if (event.key === back) {
      event.preventDefault()
      dispatch({ type: "close", focusRow: true })

      return
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const items = focusables(element)
    const index = items.findIndex((item) => item === target || item.contains(target))
    const step = event.key === "ArrowDown" ? 1 : -1
    items[index === -1 ? 0 : (index + step + items.length) % items.length]?.focus()
  }

  // Hiding the details closes the flyout, so a pending aim cannot reopen it and each list refreshes on the next open.
  createKeyed(
    () => props.shown,
    () => undefined,
    { otherwise: () => dispatch({ type: "hidden" }) },
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  // While a list is open: Escape closes only the flyout, before the details popover's own Escape handling sees it,
  // and scrolling or resizing measures the flyout's place again.
  createKeyed(
    () => active() !== undefined,
    () => {
      const remeasure = () => {
        const service = active()

        if (service) dispatch({ type: "remeasured", anchor: measure(service) })
      }

      const escape = (event: KeyboardEvent) => {
        const focused = document.activeElement

        if (event.key !== "Escape" || !focused || !flyout?.offsetParent?.contains(focused)) return
        event.preventDefault()
        event.stopPropagation()
        dispatch({ type: "close", focusRow: !!flyout?.contains(focused) })
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
      const element = service ? panes[service] : undefined
      const scroller = service ? scrollers[service] : undefined

      if (!service || !element || !scroller) return
      setSizes("heights", service, element.offsetHeight)
      setSizes("overflow", service, scroller.scrollHeight > scroller.clientHeight + 1)
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
                <div class="session-summary-card session-service-drawer" aria-busy={source.view.busy}>
                  <ServiceBody source={source}>
                    <source.Body />
                  </ServiceBody>
                  <ServiceFooter source={source} />
                </div>
              ))

              return (
                <button
                  type="button"
                  class="session-summary-row"
                  onClick={(event) => {
                    source.refresh()
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
        <div
          class="session-summary-rows"
          onPointerMove={hover}
          onPointerLeave={() => dispatch({ type: "aim.cancelled" })}
        >
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
                    if (event.pointerType === "touch" || active() !== undefined) return
                    dispatch({
                      type: "row.entered",
                      service: service.type,
                      shown: props.shown,
                      anchor: measure(service.type),
                    })
                  }}
                  onClick={(event) =>
                    dispatch({
                      type: "row.activated",
                      service: service.type,
                      focus: event.detail === 0,
                      shown: props.shown,
                      anchor: measure(service.type),
                    })
                  }
                >
                  <Icon name={service.icon} class="shrink-0 text-v2-icon-icon-muted" />
                  <span class="session-summary-label">{ctx.t(service.label)}</span>
                  <Show when={source.view.status === "ready"}>
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
        data-motion={motion() || undefined}
        inert={active() === undefined || undefined}
        style={{ transform: `translateY(${offset()}px)` }}
        onKeyDown={keydown}
        onPointerEnter={() => dispatch({ type: "aim.cancelled" })}
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
                    aria-busy={source.view.busy}
                    data-service={service.type}
                    data-active={pane() === service.type || undefined}
                    data-overflow={sizes.overflow[service.type] || undefined}
                    inert={pane() !== service.type || undefined}
                  >
                    <MenuScroll
                      class="min-h-0"
                      viewportClass="session-service-scroll"
                      viewportRef={(element) => (scrollers[service.type] = element)}
                    >
                      <div ref={(element) => observer.observe(element)} class="session-service-pane-content">
                        <ServiceBody source={source}>
                          <source.Body />
                        </ServiceBody>
                      </div>
                    </MenuScroll>
                    <ServiceFooter source={source} />
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

function useMcp(props: ServiceProps, controllers: McpControllers, close: () => void): ServiceSource {
  const ctx = usePlugin()
  const data = () => props.session.server.data
  const mcp = useMcpController(controllers, props.session.server, props.directory)

  const list = () => data().location.mcp.server.list({ directory: props.directory })

  // The list lives in the server's data store; the machine tracks only whether it loaded.
  const load = useServiceLoad(props, {
    cached: () => (list() === undefined ? undefined : true),
    retain: false,
    task: async () => {
      const current = data()
      const directory = props.directory

      current.location.mcp.server.invalidate({ directory })
      await current.location.mcp.server.sync({ directory })

      return true
    },
  })

  const servers = createMemo(() => (list() ?? []).toSorted((a, b) => a.name.localeCompare(b.name)))

  return {
    get view() {
      return load.view()
    },
    get count() {
      return servers().length
    },
    get failed() {
      return servers().some((server) => server.status.status === "failed")
    },
    refresh: load.refresh,
    retry: load.retry,
    Body: () => (
      <Show when={servers().length} fallback={<ServiceEmpty title={ctx.t("mcp.empty")} />}>
        <Index each={servers()}>
          {(server) => {
            const enabled = () => server().status.status !== "disabled"
            const view = createMemo(() => mcpRowView(mcp.state(), server().name, server().status.status))
            const pending = () => view().pending
            const busy = () => view().busy

            const failure = () => {
              const status = server().status

              return status.status === "failed" ? status.error : undefined
            }

            const signIn = () => server().status.status === "needs_auth" && !!server().integrationID

            // The dot shows the status; the words stay for assistive technology.
            const label = () => {
              const status = server().status.status

              if (status === "pending") return ctx.t("connecting")

              if (status === "needs_auth") return ctx.t("needsAuth")

              if (status === "failed") return ctx.t("failed")

              return ctx.t(status === "connected" ? "mcp.connected" : "mcp.disabled")
            }

            const change = (value: boolean) =>
              mcp.dispatch({
                type: "toggle.requested",
                name: server().name,
                enabled: value,
                status: server().status.status,
              })

            const showError = () => {
              const error = failure()

              if (error) mcp.dispatch({ type: "error.opened", name: server().name, error })
            }

            const follow = () => {
              if (failure()) return showError()
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
                    onClick={showError}
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
      </Show>
    ),
    Footer: () => (
      <Show when={servers().length} fallback={<ServiceEmptyFooter owner={props} service="mcp" />}>
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

type CatalogItem = {
  readonly name: string
  readonly status: string | undefined
  readonly error: string | undefined
  readonly path: string | undefined
}

function usePlugins(props: ServiceProps): ServiceSource {
  const load = useServiceLoad(props, {
    cached: () => undefined,
    // Only the machine holds the list, so a new data store keeps it on show while it loads again.
    retain: true,
    task: async (signal) => {
      const result = await props.session.server.client.plugin.list(
        { location: { directory: props.directory } },
        { signal },
      )

      return result.data
        .filter((plugin) => plugin.source.type !== "builtin")
        .map(
          (plugin): CatalogItem => ({
            name: pluginLabel(plugin),
            status: plugin.state.status,
            error: plugin.state.status === "failed" ? plugin.state.error : undefined,
            path: undefined,
          }),
        )
    },
  })

  return useCatalog(props, "plugins", load, () => load.view().value ?? [])
}

function useSkills(props: ServiceProps): ServiceSource {
  const data = () => props.session.server.data
  const list = () => data().location.skill.list({ directory: props.directory })

  // The list lives in the server's data store; the machine tracks only whether it loaded.
  const load = useServiceLoad(props, {
    cached: () => (list() === undefined ? undefined : true),
    retain: false,
    task: async () => {
      const current = data()
      const directory = props.directory

      current.location.skill.invalidate({ directory })
      await current.location.skill.sync({ directory })

      return true
    },
  })

  return useCatalog(props, "skills", load, () =>
    (list() ?? []).map(
      (skill): CatalogItem => ({ name: skill.name, status: undefined, error: undefined, path: skill.path }),
    ),
  )
}

function useCatalog(
  props: ServiceProps,
  service: "plugins" | "skills",
  load: ServiceLoad<unknown>,
  items: () => readonly CatalogItem[],
): ServiceSource {
  const ctx = usePlugin()
  const list = createMemo(() => items().toSorted((a, b) => a.name.localeCompare(b.name)))

  createKeyed(
    () => props.session.server.data,
    (current) =>
      onCleanup(
        current.on(service === "plugins" ? "plugin.updated" : "skill.updated", (event) => {
          if (event.location?.directory === props.directory) load.invalidate()
        }),
      ),
  )

  return {
    get view() {
      return load.view()
    },
    refresh: load.refresh,
    retry: load.retry,
    get count() {
      return list().length
    },
    get failed() {
      return list().some((item) => item.status === "failed")
    },
    Body: () => (
      <Show
        when={list().length}
        fallback={<ServiceEmpty title={ctx.t(service === "plugins" ? "plugins.empty" : "skills.empty")} />}
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
      </Show>
    ),
    Footer: () => (
      <Show when={list().length} fallback={<ServiceEmptyFooter owner={props} service={service} />}>
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
      when={props.source.view.status !== "loading"}
      fallback={
        <div class="session-service-message" role="status">
          {ctx.t("common.loading")}
        </div>
      }
    >
      <Show
        when={props.source.view.status === "ready"}
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

// Shown once the list is, as ServiceBody shows it.
function ServiceFooter(props: { source: ServiceSource }) {
  return (
    <Show when={props.source.view.status === "ready"}>
      <props.source.Footer />
    </Show>
  )
}

function ServiceConfigLink(props: { owner: ServiceProps; service: Service }) {
  const ctx = usePlugin()
  const system = ctx.system
  const local = () => props.owner.session.server.local
  const label = () => ctx.t(local() ? "configure" : "copyConfigPath")

  const action = useConfigAction(props.owner, async (signal) => {
    const session = props.owner.session

    const entries = await session.server.client.config.get(
      { location: { directory: props.owner.directory } },
      { signal },
    )

    const path = serviceConfigFile(entries, props.service)

    if (!path) throw new Error(ctx.t("configFileMissing"))
    signal.throwIfAborted()

    // A local file opens in a side tab beside the session, inside the workspace or not.
    if (local()) {
      if (ctx.links.open({ href: path, session })) return { type: "opened", close: true }
      await ctx.desktop?.reveal(path)

      return { type: "opened", close: false }
    }

    await system.copy(path)

    return { type: "copied" }
  })

  return (
    <Tooltip
      inactive={local()}
      value={ctx.t(action.view().copied ? "ui.message.copied" : "ui.message.copy")}
      placement="top"
      getAnchorRect={(anchor) => anchor?.querySelector("svg")?.getBoundingClientRect()}
      forceOpen={action.view().copied ? true : undefined}
      class="w-full"
    >
      <button
        type="button"
        class="session-service-config"
        disabled={action.view().disabled}
        onMouseDown={(event) => {
          if (!local()) event.preventDefault()
        }}
        onClick={action.activate}
      >
        <Icon
          name={local() ? "settings-gear" : action.view().copied ? "check" : "outline-copy"}
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

  const action = useConfigAction(props.owner, async (signal) => {
    const session = props.owner.session

    const entries = await session.server.client.config.get(
      { location: { directory: props.owner.directory } },
      { signal },
    )

    signal.throwIfAborted()
    ctx.layout.draft({
      server: session.server.id,
      directory: globalConfigDirectory(entries, props.owner.directory),
      prompt: ctx.t(`setup.${props.service}.prompt`),
    })

    return { type: "opened", close: true }
  })

  return (
    <button type="button" class="session-service-config" disabled={action.view().disabled} onClick={action.activate}>
      <Icon name="plus" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="session-summary-label">{ctx.t(`setup.${props.service}`)}</span>
    </button>
  )
}

type ServiceLoad<T> = {
  readonly view: Accessor<ServiceLoadView<T>>
  refresh: () => void
  retry: () => void
  /** The server announced a change to the list. */
  invalidate: () => void
}

// Loads a service's list through its machine while the popover or drawer shows it: one load at a time, bounded by a
// timeout, and ended when the list hides, the server's data store changes, or the list unmounts.
function useServiceLoad<T>(
  owner: ServiceProps,
  input: {
    /** The list the server's data store already holds, for a list that lives there. */
    cached: () => T | undefined
    /** Keeps the loaded list across a new data store, for a list that lives only in the machine. */
    retain: boolean
    task: (signal: AbortSignal) => Promise<T>
  },
): ServiceLoad<T> {
  const ctx = usePlugin()
  const [loadState, setLoadState] = createSignal<ServiceLoadState<T>>(initialServiceLoadState())
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()

  const dispatch = (event: ServiceLoadEvent<T>) => {
    const previous = untrack(loadState)
    const next = transitionServiceLoad(previous, event)

    if (next.state !== previous) setLoadState(() => next.state)
    next.effects.forEach(run)
  }

  const run = (effect: ServiceLoadEffect) => {
    if (effect.type === "run") {
      const attempt = effect.attempt
      const controller = new AbortController()

      runs.set(attempt, {
        controller,
        timer: setTimeout(() => dispatch({ type: "load.timed-out", attempt }), effect.timeoutMs),
      })
      void Promise.try(() => input.task(AbortSignal.any([ctx.signal, controller.signal]))).then(
        (value) => dispatch({ type: "load.succeeded", attempt, value }),
        () => dispatch({ type: "load.failed", attempt }),
      )

      return
    }

    const handle = runs.get(effect.attempt)
    runs.delete(effect.attempt)
    clearTimeout(handle?.timer)
    handle?.controller.abort()
  }

  // Follows whether the list shows, the server's data store, and whether that store already holds the list.
  createKeyed(
    () => ({ shown: owner.shown, source: owner.session.server.data, cached: input.cached() }),
    (current) =>
      dispatch({
        type: "context.changed",
        shown: current.shown,
        source: current.source,
        cached: current.cached,
        retain: input.retain,
      }),
    {
      equals: (previous, next) =>
        previous.shown === next.shown && previous.source === next.source && previous.cached === next.cached,
    },
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  return {
    view: createMemo(() => serviceLoadView(loadState())),
    refresh: () => dispatch({ type: "refresh.requested" }),
    retry: () => dispatch({ type: "retry.requested" }),
    invalidate: () => dispatch({ type: "invalidated" }),
  }
}

type ConfigActionResult = { readonly type: "opened"; readonly close: boolean } | { readonly type: "copied" }

// Runs a footer action through its machine: one run at a time, bounded by a timeout, and ended with the popover.
function useConfigAction(owner: ServiceProps, task: (signal: AbortSignal) => Promise<ConfigActionResult>) {
  const ctx = usePlugin()
  const [actionState, setActionState] = createSignal<ConfigActionState>(initialConfigActionState)
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  let reset: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: ConfigActionEvent) => {
    const previous = untrack(actionState)
    const next = transitionConfigAction(previous, event)

    if (next.state !== previous) setActionState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: ConfigActionEffect) => {
    if (effect.type === "run") {
      const attempt = effect.attempt
      const controller = new AbortController()

      runs.set(attempt, {
        controller,
        timer: setTimeout(() => dispatch({ type: "timed-out", attempt }), effect.timeoutMs),
      })
      void task(AbortSignal.any([ctx.signal, controller.signal])).then(
        (result) => dispatch({ ...result, attempt }),
        (error) => dispatch({ type: "failed", attempt, error: error instanceof Error ? error.message : String(error) }),
      )

      return
    }

    if (effect.type === "abort") {
      const handle = runs.get(effect.attempt)
      runs.delete(effect.attempt)
      clearTimeout(handle?.timer)
      handle?.controller.abort()

      return
    }

    if (effect.type === "schedule-reset") {
      const attempt = effect.attempt
      clearTimeout(reset)
      reset = setTimeout(() => dispatch({ type: "copied.expired", attempt }), effect.delayMs)

      return
    }

    if (effect.type === "cancel-reset") return clearTimeout(reset)

    if (effect.type === "close-owner") return owner.onClose?.()

    showToast({
      variant: "error",
      title: ctx.t("common.requestFailed"),
      description: effect.type === "toast-failed" ? effect.error : ctx.t("timedOut"),
    })
  }

  // Hiding the popover or drawer drops the copied mark, so its tooltip does not stay open over nothing.
  createKeyed(
    () => owner.shown,
    () => undefined,
    { otherwise: () => dispatch({ type: "hidden" }) },
  )
  onCleanup(() => dispatch({ type: "disposed" }))

  return { view: () => configActionView(actionState()), activate: () => dispatch({ type: "activate" }) }
}

function ServiceEmpty(props: { title: string }) {
  return (
    <div class="session-service-empty">
      <strong>{props.title}</strong>
    </div>
  )
}

function ServiceEmptyFooter(props: { owner: ServiceProps; service: Service }) {
  return (
    <div class="session-service-footer">
      <span class="session-service-config-separator" role="separator" />
      <ServiceSetup owner={props.owner} service={props.service} />
      <ServiceConfigLink owner={props.owner} service={props.service} />
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

type McpController = {
  readonly state: () => McpState
  dispatch: (event: McpEvent) => void
  /** Reports that an error dialog closed, by the user or by the controller. */
  dismiss: (attempt: number) => void
}

/**
 * The plugin instance's MCP controllers, by server and directory, so a popover or drawer that mounts again finds the
 * toggles and the error dialog the previous one left running.
 */
export type McpControllers = Map<string, McpController>

// The controller for the server and directory, shared with every other mount and the error dialog, for as long as
// this mount lives.
function useMcpController(controllers: McpControllers, server: ServerRef, directory: string) {
  const key = JSON.stringify([server.id, directory])
  const current = controllers.get(key)

  const mcp =
    current && untrack(current.state).status !== "disposed"
      ? current
      : createMcpController(server, directory, () => {
          if (controllers.get(key) === mcp) controllers.delete(key)
        })

  controllers.set(key, mcp)
  mcp.dispatch({ type: "mounted" })
  onCleanup(() => mcp.dispatch({ type: "unmounted" }))

  return mcp
}

// Connects, disconnects, or starts sign-in for one server's MCPs in one directory, like the app's MCP toggle, and shows
// their errors. It ends once no popover lists it, no toggle runs and no error dialog shows, or with the plugin.
function createMcpController(server: ServerRef, directory: string, release: () => void): McpController {
  const ctx = usePlugin()
  const [mcpState, setMcpState] = createSignal<McpState>(initialMcpState)
  const runs = new Map<number, { controller: AbortController; timer: ReturnType<typeof setTimeout> }>()
  const dialogs = new Map<number, { close: () => void }>()
  const dispose = () => dispatch({ type: "disposed" })

  const dispatch = (event: McpEvent) => {
    const previous = untrack(mcpState)
    const next = transitionMcp(previous, event)

    if (next.state !== previous) setMcpState(next.state)

    if (next.state.status === "disposed" && previous.status !== "disposed") {
      ctx.signal.removeEventListener("abort", dispose)
      release()
    }

    next.effects.forEach(run)
  }

  const mcp: McpController = {
    state: mcpState,
    dispatch,
    dismiss: (attempt) => {
      dialogs.delete(attempt)
      dispatch({ type: "error.dismissed", attempt })
    },
  }

  const run = (effect: McpEffect) => {
    if (effect.type === "run-toggle") {
      const name = effect.name
      const attempt = effect.attempt
      const controller = new AbortController()

      runs.set(attempt, {
        controller,
        timer: setTimeout(() => dispatch({ type: "toggle.timed-out", name, attempt }), effect.timeoutMs),
      })
      void toggle(effect, controller.signal).then(dispatch, (error) =>
        dispatch({
          type: "toggle.failed",
          name,
          attempt,
          error: error instanceof Error ? error.message : String(error),
          server: false,
        }),
      )

      return
    }

    if (effect.type === "abort-toggle") {
      const handle = runs.get(effect.attempt)
      runs.delete(effect.attempt)
      clearTimeout(handle?.timer)
      handle?.controller.abort()

      return
    }

    if (effect.type === "open-external") return ctx.system.openExternal(effect.url)

    if (effect.type === "open-sign-in") {
      const signIn = effect.signIn
      const ref = { directory }

      ctx.dialogs.open((dialog) => (
        <McpSignInDialog
          server={server}
          name={effect.name}
          integrationID={signIn.integrationID}
          attemptID={signIn.attemptID}
          url={signIn.url}
          lifetime={signIn.lifetime}
          directory={directory}
          onSync={async () => {
            const latest = server.data
            latest.location.mcp.server.invalidate(ref)
            latest.location.mcp.resource.invalidate(ref)
            await Promise.all([latest.location.mcp.server.sync(ref), latest.location.mcp.resource.sync(ref)])
          }}
          onClose={() => dialog.close()}
        />
      ))

      return
    }

    if (effect.type === "open-dialog") {
      dialogs.set(
        effect.attempt,
        ctx.dialogs.open(() => (
          <McpErrorDialog mcp={mcp} attempt={effect.attempt} name={effect.name} server={server} directory={directory} />
        )),
      )

      return
    }

    if (effect.type === "close-dialog") {
      const handle = dialogs.get(effect.attempt)
      dialogs.delete(effect.attempt)
      handle?.close()

      return
    }

    showToast({
      variant: "error",
      title: ctx.t("common.requestFailed"),
      description: effect.type === "toast-failed" ? effect.message : ctx.t("mcp.timedOut", { name: effect.name }),
    })
  }

  const toggle = async (effect: Extract<McpEffect, { type: "run-toggle" }>, signal: AbortSignal): Promise<McpEvent> => {
    const client = server.client
    const source = server.data
    const ref = { directory }
    const name = effect.name
    const attempt = effect.attempt
    const found = (await client.mcp.list({ location: ref }, { signal })).data.find((item) => item.name === name)

    if (!found) return { type: "toggle.succeeded", name, attempt }

    if (!effect.enabled) await client.experimental.mcp.disconnect({ server: name, location: ref }, { signal })

    if (effect.enabled && found.status.status !== "needs_auth")
      await client.experimental.mcp.connect({ server: name, location: ref }, { signal })

    source.location.mcp.server.invalidate(ref)
    await source.location.mcp.server.sync(ref)
    const current = source.location.mcp.server.list(ref)?.find((item) => item.name === name)
    const integrationID = current?.integrationID

    if (effect.enabled && current?.status.status === "needs_auth" && integrationID) {
      const integration = await client.integration.get({ integrationID, location: ref }, { signal })
      const method = integration.data?.methods.find((item) => item.type === "oauth" && !item.form?.length)

      if (!method || method.type !== "oauth") throw new Error(ctx.t("mcp.interactiveAuth", { name }))

      const started = await client.integration.oauth.connect(
        { integrationID, methodID: method.id, location: ref },
        { signal },
      )

      dispatch({
        type: "toggle.authorizing",
        name,
        attempt,
        url: started.data.url,
        signIn: started.data.paste
          ? {
              integrationID,
              attemptID: started.data.attemptID,
              url: started.data.url,
              lifetime: started.data.time.expires - started.data.time.created,
            }
          : undefined,
      })
    }

    source.location.mcp.resource.invalidate(ref)
    await source.location.mcp.resource.sync(ref)
    // A successful HTTP response can still leave the MCP connection in a failed state.
    const status = current?.status

    if (status?.status === "failed") return { type: "toggle.failed", name, attempt, error: status.error, server: true }

    return { type: "toggle.succeeded", name, attempt }
  }

  // The plugin's end ends the toggles and dialogs that outlived the popover.
  ctx.signal.addEventListener("abort", dispose, { once: true })

  return mcp
}

// The MCPs dialog's error view, for a server the popover lists. Its controller outlives the popover that opened it.
function McpErrorDialog(props: {
  mcp: McpController
  attempt: number
  name: string
  server: ServerRef
  directory: string
}) {
  const ctx = usePlugin()
  const list = () => props.server.data.location.mcp.server.list({ directory: props.directory })
  const status = () => list()?.find((item) => item.name === props.name)?.status
  const view = createMemo(() => mcpDialogView(props.mcp.state(), props.attempt, status()?.status))

  // Follows the server's status, which changes here and anywhere else: a reconnect or a removal closes the dialog, and
  // a new failure replaces its error.
  createKeyed(
    () => ({ loaded: list() !== undefined, status: status() }),
    (synced) =>
      props.mcp.dispatch({
        type: "server.synced",
        attempt: props.attempt,
        loaded: synced.loaded,
        status: synced.status,
      }),
    {
      equals: (previous, next) =>
        previous.loaded === next.loaded &&
        previous.status?.status === next.status?.status &&
        statusError(previous.status) === statusError(next.status),
    },
  )
  onCleanup(() => props.mcp.dismiss(props.attempt))

  const toggle = (enabled: boolean) =>
    props.mcp.dispatch({ type: "toggle.requested", name: props.name, enabled, status: status()?.status })

  const copy = (name: string, error: string) =>
    void ctx.system.copy(ctx.t("mcp.error.details", { name, error })).then(
      () => props.mcp.dispatch({ type: "error.copied", attempt: props.attempt, error }),
      (cause) =>
        showToast({
          variant: "error",
          title: ctx.t("mcp.error.copyFailed"),
          description: cause instanceof Error ? cause.message : String(cause),
        }),
    )

  return (
    <Show when={view()}>
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
                icon={current().copied ? "check" : "copy"}
                onClick={() => copy(current().name, current().error)}
              >
                {ctx.t(current().copied ? "common.copied" : "mcp.error.copy")}
              </Button>
              <Button variant="ghost" disabled={current().busy} onClick={() => toggle(false)}>
                {ctx.t("mcp.error.disable")}
              </Button>
              <Button variant="neutral" disabled={current().busy} onClick={() => toggle(true)}>
                {ctx.t("common.retry")}
              </Button>
            </ErrorDetails>
          </DialogBody>
        </Dialog>
      )}
    </Show>
  )
}

function statusError(status: McpServerStatus | undefined) {
  return status?.status === "failed" || status?.status === "needs_auth" ? status.error : undefined
}

// Waits for an MCP sign-in that also accepts the redirect URL pasted from the browser, for when the browser cannot
// reach the machine running the server (SSH, a remote desktop connection, a container). Like the app's MCPs dialog.
function McpSignInDialog(props: {
  server: ServerRef
  name: string
  integrationID: string
  attemptID: string
  url: string
  /** The attempt's lifetime in milliseconds, from the server's `time`; the two clocks may disagree. */
  lifetime: number
  directory: string
  /** Reloads the MCP server and resource lists once the sign-in succeeded. */
  onSync: () => Promise<void>
  onClose: () => void
}) {
  const ctx = usePlugin()
  const errorID = createUniqueId()

  const attempt = () => ({
    integrationID: props.integrationID,
    attemptID: props.attemptID,
    location: { directory: props.directory },
  })

  const initial = startMcpSignIn({ url: props.url, lifetimeMs: props.lifetime })
  const [signInState, setSignInState] = createSignal(initial.state)
  const view = createMemo(() => selectMcpSignInView(signInState()))

  let input: HTMLInputElement | undefined
  // The machine decides when each of these starts and stops; the driver only holds them.
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let pollController: AbortController | undefined
  let submitController: AbortController | undefined

  const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

  const dispatch = (event: McpSignInEvent) => {
    const previous = untrack(signInState)
    const next = transitionMcpSignIn(previous, event)

    if (next.state !== previous) setSignInState(next.state)
    next.effects.forEach((effect) => void Promise.try(() => run(effect)).catch((cause) => console.error(cause)))
  }

  const run = (effect: McpSignInEffect) => {
    if (effect.type === "deadline.start") {
      clearTimeout(deadlineTimer)
      deadlineTimer = setTimeout(() => dispatch({ type: "waiting.timed-out" }), effect.delayMs)

      return
    }

    if (effect.type === "deadline.clear") return clearTimeout(deadlineTimer)

    if (effect.type === "poll") {
      abortPoll()

      if (effect.delayMs <= 0) return poll(effect.pollAttempt)
      pollTimer = setTimeout(() => poll(effect.pollAttempt), effect.delayMs)

      return
    }

    if (effect.type === "poll.abort") return abortPoll()

    if (effect.type === "submit") {
      submitController?.abort()
      const controller = new AbortController()
      submitController = controller
      void props.server.client.integration.oauth
        .complete({ ...attempt(), code: effect.code }, { signal: controller.signal })
        .then(
          () => {
            if (!controller.signal.aborted) dispatch({ type: "submit.succeeded", submitAttempt: effect.submitAttempt })
          },
          (error) => {
            if (controller.signal.aborted) return
            dispatch({ type: "submit.failed", submitAttempt: effect.submitAttempt, message: message(error) })
          },
        )

      return
    }

    if (effect.type === "submit.abort") {
      submitController?.abort()
      submitController = undefined

      return
    }

    if (effect.type === "sync") {
      clearTimeout(syncTimer)
      syncTimer = setTimeout(
        () => dispatch({ type: "sync.timed-out", syncAttempt: effect.syncAttempt }),
        effect.timeoutMs,
      )
      void Promise.try(props.onSync).then(
        () => dispatch({ type: "sync.succeeded", syncAttempt: effect.syncAttempt }),
        (error) => dispatch({ type: "sync.failed", syncAttempt: effect.syncAttempt, message: message(error) }),
      )

      return
    }

    if (effect.type === "sync.clear") return clearTimeout(syncTimer)

    if (effect.type === "refresh") return void Promise.try(props.onSync).catch(() => undefined)

    if (effect.type === "open-external") return ctx.system.openExternal(effect.url)

    if (effect.type === "cancel")
      return void props.server.client.integration.oauth.cancel(attempt()).catch(() => undefined)

    props.onClose()
  }

  const poll = (pollAttempt: number) => {
    const controller = new AbortController()
    pollController = controller
    void props.server.client.integration.oauth.status(attempt(), { signal: controller.signal }).then(
      (response) => {
        if (controller.signal.aborted) return
        const status = response.data
        dispatch({
          type: "polled",
          pollAttempt,
          outcome: status.status === "failed" ? { status: "failed", message: status.message } : { status: status.status },
        })
      },
      (error) => {
        if (controller.signal.aborted) return
        dispatch({ type: "polled", pollAttempt, outcome: { status: "unreachable", message: message(error) } })
      },
    )
  }

  const abortPoll = () => {
    clearTimeout(pollTimer)
    pollController?.abort()
    pollController = undefined
  }

  const failure = (value: McpSignInFailure) => {
    if (value.type === "auth-expired") return ctx.t("mcp.signIn.failed", { error: ctx.t("mcp.signIn.expired") })

    if (value.type === "auth-failed") return ctx.t("mcp.signIn.failed", { error: value.message })

    if (value.type === "sync-failed") return value.message

    return ctx.t("mcp.timedOut", { name: props.name })
  }

  const entryError = () => {
    const error = view().entryError

    if (!error) return

    return error.type === "rejected" ? error.message : ctx.t("mcp.signIn.paste.required")
  }

  onMount(() => {
    input?.focus({ preventScroll: true })
    initial.effects.forEach(run)
  })
  onCleanup(() => dispatch({ type: "disposed" }))

  return (
    <Dialog>
      <DialogHeader>
        <DialogTitleGroup title={ctx.t("mcp.signIn.open", { name: props.name })} />
      </DialogHeader>
      <DialogBody>
        <div class="flex flex-col gap-5 px-3 pb-3 text-[13px] font-[440] leading-5 tracking-[-0.04px] text-v2-text-text-muted">
          <div>{ctx.t("mcp.signIn.description", { name: props.name })}</div>
          <Show
            when={view().failure}
            fallback={
              <div class="flex items-center gap-2">
                <Loader class="size-4 shrink-0 text-v2-icon-icon-muted" />
                <span>{ctx.t("mcp.signIn.waiting")}</span>
              </div>
            }
          >
            {(current) => (
              <div role="alert" class="text-v2-state-fg-danger">
                {failure(current())}
              </div>
            )}
          </Show>
          <Show when={view().showOpenBrowser || view().canRetry}>
            <div class="flex flex-wrap items-center gap-2">
              <Show when={view().showOpenBrowser}>
                <Button variant="neutral" icon="arrow-up-right" onClick={() => dispatch({ type: "browser.open" })}>
                  {ctx.t("mcp.signIn.openBrowser")}
                </Button>
              </Show>
              <Show when={view().canRetry}>
                <Button variant="neutral" onClick={() => dispatch({ type: "retry.requested" })}>
                  {ctx.t("common.retry")}
                </Button>
              </Show>
            </div>
          </Show>
          <Show when={view().showForm}>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                dispatch({ type: "paste.submitted" })
              }}
              class="flex flex-col items-start gap-5 self-stretch"
            >
              <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
                {ctx.t("mcp.signIn.paste.label")}
                <TextInput
                  ref={input}
                  class="!w-full"
                  name="redirect"
                  placeholder={ctx.t("mcp.signIn.paste.placeholder")}
                  value={view().value}
                  readOnly={view().locked}
                  invalid={entryError() !== undefined}
                  aria-describedby={entryError() ? errorID : undefined}
                  autocomplete="off"
                  spellcheck={false}
                  onInput={(event) => dispatch({ type: "paste.changed", value: event.currentTarget.value })}
                />
              </label>
              <Show when={entryError()}>
                {(error) => (
                  <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
                    {error()}
                  </div>
                )}
              </Show>
              <Button type="submit" variant="contrast" disabled={view().locked} aria-busy={view().submitting}>
                {ctx.t("common.continue")}
              </Button>
            </form>
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}
