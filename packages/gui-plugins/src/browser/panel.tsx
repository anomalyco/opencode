import { Popover } from "@kobalte/core/popover"
import { Button } from "@opencode/ui/button"
import { Icon, newIcons } from "@opencode/ui/icon"
import type { IconName } from "@opencode/ui/icons/catalog"
import { IconButton } from "@opencode/ui/icon-button"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { Loader } from "@opencode/ui/loader"
import { Keybind } from "@opencode/ui/keybind"
import { Menu } from "@opencode/ui/menu"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { showToast } from "@opencode/ui/toast"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMemo, createSignal, For, onCleanup, Show, untrack, type Accessor, type JSX } from "solid-js"
import type { Browser } from "@opencode/plugin-browser/rpc"
import {
  createKeyed,
  usePlugin,
  usePanel,
  type PanelTab,
  type MountedSession,
  type SessionScreen,
} from "@opencode/plugin/gui"
import { addressParts, connection, loopback } from "./address"
import {
  ADDRESS_HINT_MAX_LENGTH,
  addressSuggestions,
  addressView,
  initialAddressState,
  nextAddressEpoch,
  transitionAddress,
  type AddressEpoch,
  type AddressEvent,
} from "./address-machine"
import { commentNote, pageNote } from "./comment"
import { bare, highlight, type Visit } from "./history"
import type { Model } from "./model"
import {
  capturesEscape,
  initialOverlayState,
  overlayComment,
  overlayNote,
  overlayView,
  transitionOverlay,
  type OverlayContext,
  type OverlayEvent,
} from "./overlay-machine"
import { PageIcon } from "./page-icon"
import {
  initialSiteState,
  SITE_CLEAR_TIMEOUT_MS,
  SITE_LOAD_TIMEOUT_MS,
  siteView,
  transitionSite,
  type SiteEffect,
  type SiteEvent,
} from "./site-machine"

const RECENT = 5

export default function SessionBrowserPane(props: {
  tab: Accessor<PanelTab>
  session: MountedSession
  screen: SessionScreen
  model: Model
}) {
  const plugin = usePlugin()
  const keybinds = plugin.keybinds
  const desktop = plugin.desktop
  const embeds = plugin.embeds
  const system = plugin.system
  const panel = usePanel()
  const visible = () => panel.visible()
  const state = () => props.model.tab(props.session, props.tab().id)
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError
  const suspended = () => props.model.suspended(props.session)
  const command = (action: Browser.Action) => props.model.command(props.session, action)

  const page = () => {
    const tab = state()

    return tab ? props.model.page(props.session, tab.id) : undefined
  }

  const [addressState, setAddressState] = createSignal(initialAddressState)
  const [size, setSize] = createSignal({ width: 0, height: 0 })
  const [overlay, setOverlay] = createSignal(initialOverlayState)

  // The page's reports, counted; a submitted address in the field ends at the next one.
  const epoch = createMemo((previous: AddressEpoch | undefined) =>
    nextAddressEpoch(previous, {
      tabID: state()?.id,
      url: address(),
      loading: !!state()?.loading,
      generation: state()?.generation ?? 0,
      error: props.model.error(props.session),
    }),
  )

  // Suggestions follow what the user typed; a focused address is not a query.
  const suggestions = createMemo(() => addressSuggestions(addressState(), props.model.visits()))
  const addressBar = createMemo(() => addressView(addressState(), epoch(), suggestions()))

  const dispatchAddress = (event: AddressEvent, domEvent?: Event) => {
    const next = transitionAddress(untrack(addressState), event)
    setAddressState(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "select-input") return input?.select()

      if (effect.type === "blur-input") return input?.blur()

      if (effect.type === "prevent-default") return domEvent?.preventDefault()
      command({ type: "navigate", tabID: effect.tabID, url: effect.url })
    })
  }

  const empty = () => !address() && !state()?.loading && !addressBar().navigating
  // The desktop page hides blank and loading documents itself; only hide here
  // while the pane shows its own empty or failed state over the embed.
  const shown = () => visible() && !empty() && !failed()

  const embed = () => {
    const tab = state()

    return tab ? props.model.embed(props.session, tab.id) : undefined
  }

  let root: HTMLElement | undefined
  let box: HTMLDivElement | undefined
  let input: HTMLInputElement | undefined
  let anchor: HTMLFormElement | undefined

  const error = () => props.model.error(props.session)

  const inspectable = () => !!address() && !failed() && !suspended()
  const overlayed = createMemo(() => overlayView(overlay(), props.session.key, state()?.id))
  const picking = () => overlayed().picking
  const comment = createMemo(() => overlayComment(overlay(), props.session.key, state()?.id))
  const note = createMemo(() => overlayNote(overlay(), props.session.key, state()?.id))

  // Where the pane is when an event happens; the overlay machine checks what it owns against it.
  const context = (): OverlayContext => ({
    sessionKey: props.session.key,
    tab: state(),
    visible: visible(),
    inspectable: inspectable(),
  })

  const dispatchOverlay = (event: OverlayEvent) => {
    const next = transitionOverlay(untrack(overlay), event)
    setOverlay(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "set-inspect")
        return props.model.inspect({ key: effect.sessionKey }, effect.tabID, effect.enabled)

      if (effect.type === "clear-highlight") return props.model.highlight({ key: effect.sessionKey }, effect.tabID)

      // The owning screen's composer serves the session the pane shows.
      if (effect.type === "attach-comment")
        return props.screen.composer.attach(
          commentNote({
            origin: plugin.id,
            tabID: effect.tabID,
            url: effect.url,
            subtitle: plugin.t("comment.annotation"),
            element: {
              ref: effect.live ? effect.element.ref : undefined,
              selector: effect.element.selector,
              label: effect.element.label,
              role: effect.element.role,
              name: effect.element.name,
              text: effect.element.text,
            },
            comment: effect.comment,
          }),
        )

      props.screen.composer.attach(
        pageNote({
          origin: plugin.id,
          tabID: effect.tabID,
          url: effect.url,
          title: effect.title,
          label: effect.title || addressParts(effect.url).host || effect.url,
          comment: effect.comment,
        }),
      )
    })
  }

  // The address field always shows the whole URL; at rest it draws the host emphasized.
  const parts = () => addressParts(addressBar().field)
  const site = () => !!addressBar().field && !addressBar().editing
  const recent = () => props.model.visits().slice(0, RECENT)

  // A loopback address opens on the machine that runs the server; the system browser here reaches it only when the
  // server runs here too.
  const reachable = () => {
    const url = address()

    if (!URL.canParse(url)) return false
    const parsed = new URL(url)

    if (parsed.protocol === "file:") return props.session.server.local

    return /^https?:$/.test(parsed.protocol) && (props.session.server.local || !loopback(parsed.hostname))
  }

  const closeOverlay = () => dispatchOverlay({ type: "overlay.cancelled" })
  const toggleInspect = () => dispatchOverlay({ type: "picker.toggled", context: context() })

  const focusAddress = () => {
    input?.focus()
    input?.select()
  }

  // Navigates the tab and keeps the address in the field until the page reports where it went. Ends editing here rather
  // than on blur: a click elsewhere, such as a recent page, may have blurred the field already.
  const go = (url: string) => dispatchAddress({ type: "navigated", url, epoch: epoch() })

  const submitOverlay = (value: string) => dispatchOverlay({ type: "overlay.submitted", value, context: context() })
  const openNote = () => dispatchOverlay({ type: "note.opened", context: context() })

  const zoomed = () => !!address() && (page()?.zoom ?? 1) !== 1

  const zoomPage = (direction: "in" | "out" | "reset") => {
    const tab = state()

    if (tab) props.model.zoom(props.session, tab.id, direction)
  }

  const copyLink = () => {
    const url = address()

    if (!url) return
    void system.copy(url).then(
      () => showToast({ title: plugin.t("common.copied") }),
      () => showToast({ title: plugin.t("common.requestFailed") }),
    )
  }

  // The picked element in surface pixels, and the editor anchored below it, above it, or over it.
  const spotlight = () => {
    const rect = comment()?.element.rect

    if (!rect) return
    const zoom = desktop?.zoom() ?? 1

    return { x: rect.x / zoom, y: rect.y / zoom, width: rect.width / zoom, height: rect.height / zoom }
  }

  const placement = () => {
    const rect = spotlight()

    if (!rect) return
    const gap = 8
    const width = Math.max(0, Math.min(320, size().width - gap * 2))
    // The editor scrolls rather than growing past the surface, so its actions stay reachable.
    const surfaceHeight = Math.max(0, size().height - gap * 2)
    // Pick the opening side from its first measurement, then grow upward from that bottom edge.
    const initialHeight = Math.min(comment()?.editorInitialHeight || 80, surfaceHeight)
    const left = Math.min(Math.max(gap, rect.x), Math.max(gap, size().width - width - gap))
    const below = rect.y + rect.height + gap
    const above = rect.y - gap - initialHeight

    const openingTop =
      below + initialHeight <= size().height - gap
        ? below
        : above >= gap
          ? above
          : Math.max(gap, size().height - initialHeight - gap)

    const bottom = Math.min(openingTop + initialHeight, size().height - gap)
    const maxHeight = Math.max(0, bottom - gap)
    const height = Math.min(comment()?.editorHeight || initialHeight, maxHeight)
    const top = Math.max(gap, bottom - height)

    return { left, top, width, maxHeight }
  }

  onCleanup(
    props.model.mount({
      visible,
      address,
      reload: () => {
        const tab = state()

        if (tab) command({ type: "reload", tabID: tab.id })
      },
      close: () => {
        const tab = state()

        if (tab) props.model.close(props.session, tab.id)
      },
      inspectable,
      inspect: toggleInspect,
      focusAddress,
      // Dispatched inside the pane, so keybinds scoped to it, such as closing the browser tab, apply.
      press: (event) => {
        if (!visible()) return
        root?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: event.key,
            code: event.code,
            ctrlKey: event.ctrl,
            metaKey: event.meta,
            shiftKey: event.shift,
            altKey: event.alt,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        )
      },
      // A focusin inside the pane, so the app's focus tracking sees the page's focus as the side panel's.
      focused: () => root?.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true })),
    }),
  )

  // The pane stays mounted when another session is routed; it listens to the routed session's picker.
  createKeyed(
    () => props.session.key,
    (sessionKey) =>
      onCleanup(
        props.model.onInspect({ key: sessionKey }, (event) =>
          dispatchOverlay({
            type: "inspect.reported",
            sessionKey,
            tabID: event.tabID,
            active: event.active,
            element: event.element,
            context: context(),
          }),
        ),
      ),
  )

  // A tab the user just opened starts in its address field, once its blank page is on screen. Syncs DOM focus.
  createKeyed(
    () => (visible() && empty() ? state()?.id : undefined),
    (tabID) => {
      if (props.model.opened(props.session, tabID)) focusAddress()
    },
  )

  // Syncs main's native picker and highlight with the page on screen: the overlay machine stops a picker whose tab was
  // switched away, hidden or made uninspectable, and closes a comment or note whose tab was switched away.
  createKeyed(
    () => ({ sessionKey: props.session.key, tabID: state()?.id, visible: visible(), inspectable: inspectable() }),
    () => dispatchOverlay({ type: "context.changed", context: context() }),
    {
      equals: (previous, next) =>
        previous.sessionKey === next.sessionKey &&
        previous.tabID === next.tabID &&
        previous.visible === next.visible &&
        previous.inspectable === next.inspectable,
    },
  )
  onCleanup(() => dispatchOverlay({ type: "disposed" }))
  // The page does not have focus while the picker waits for a hover, so Escape reaches the app.
  createEventListener(
    window,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !capturesEscape(untrack(overlay))) return
      event.preventDefault()
      event.stopPropagation()
      dispatchOverlay({ type: "escape.pressed" })
    },
    { capture: true },
  )
  createResizeObserver(
    () => box,
    (rect) => setSize({ width: rect.width, height: rect.height }),
  )

  // A restored tab has no page until the pane first shows it.
  createKeyed(
    () => {
      const tab = state()

      return tab && shown() && !embed() ? tab.id : undefined
    },
    (tabID) => props.model.load(props.session, tabID),
  )

  const tip = (label: string, keys?: readonly string[]): JSX.Element => (
    <div class="flex items-center gap-2">
      <span>{label}</span>
      <Show when={keys && keys.length > 0}>
        <Keybind keys={[...(keys ?? [])]} variant="neutral" />
      </Show>
    </div>
  )

  return (
    <aside
      ref={root}
      id="browser-panel"
      // A click on the pane's own surface, like its loading or error view, keeps focus here, so its shortcuts apply.
      tabIndex={-1}
      class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col outline-none"
    >
      <div
        data-component="browser-bar"
        class="h-11 shrink-0 flex items-center gap-2 px-3 border-b-[0.5px] border-v2-border-border-muted"
      >
        <div class="flex shrink-0 items-center">
          <For each={["back", "forward"] as const}>
            {(direction) => (
              <Tooltip placement="top" value={plugin.t(direction === "back" ? "common.goBack" : "common.goForward")}>
                <IconButton
                  variant="ghost-muted"
                  size="large"
                  disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
                  aria-label={plugin.t(direction === "back" ? "common.goBack" : "common.goForward")}
                  onClick={() => {
                    const tab = state()

                    if (tab) command({ type: direction, tabID: tab.id })
                  }}
                  icon={<Icon name={direction === "back" ? "outline-arrow-left" : "outline-arrow-right"} />}
                />
              </Tooltip>
            )}
          </For>
          <Tooltip
            placement="top"
            value={
              state()?.loading
                ? plugin.t("action.stop")
                : tip(plugin.t("action.reload"), keybinds.keybind("browser.reload"))
            }
          >
            <IconButton
              variant="ghost-muted"
              size="large"
              disabled={!state()?.loading && !address()}
              aria-label={plugin.t(state()?.loading ? "action.stop" : "action.reload")}
              onClick={() => {
                const tab = state()

                if (tab) command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
              }}
              icon={
                <Show when={state()?.loading} fallback={<Icon name="outline-rotate-clockwise" />}>
                  <Loader />
                </Show>
              }
            />
          </Tooltip>
        </div>
        <Popover
          open={addressBar().listed}
          anchorRef={() => anchor}
          placement="bottom-start"
          gutter={4}
          // The list overhangs the field by its 8px padding, so suggestion icons and text line up with the field's.
          shift={-8}
          modal={false}
        >
          <form
            ref={anchor}
            dir="ltr"
            data-component="browser-address"
            data-editing={addressBar().editing ? "" : undefined}
            data-site={site() ? "" : undefined}
            data-address={addressBar().editing && !addressBar().typed && addressBar().field ? "" : undefined}
            onPointerDown={(event) => {
              // The whole field focuses the input, as the site button and page actions handle their own clicks.
              if (event.target === event.currentTarget) {
                event.preventDefault()
                input?.focus()
              }
            }}
            onSubmit={(event) => {
              event.preventDefault()
              dispatchAddress({ type: "submitted", epoch: epoch(), visits: props.model.visits(), failed: failed() })
            }}
          >
            {/* Editing shows the icon of the page Enter would open: the page's own, or the chosen suggestion's. */}
            <Show
              when={site()}
              fallback={
                <PageIcon
                  icon={
                    addressBar().editing && addressBar().field
                      ? addressBar().typed
                        ? addressBar().chosen?.icon
                        : page()?.icon
                      : undefined
                  }
                  class="text-v2-icon-icon-muted"
                />
              }
            >
              {/* Site information describes one page: another tab or URL closes it, and opening it reads anew. */}
              <Show when={`${props.session.key}\n${state()?.id}\n${address()}`} keyed>
                <SiteInformation
                  url={address()}
                  server={props.session.server.local ? undefined : props.session.server.name}
                  site={() => {
                    const tab = state()

                    return tab ? props.model.site(props.session, tab.id) : undefined
                  }}
                  clear={() => {
                    const tab = state()

                    return tab ? props.model.clearSite(props.session, tab.id) : undefined
                  }}
                />
              </Show>
            </Show>
            <div data-slot="browser-address-text">
              <input
                ref={input}
                data-slot="browser-address-input"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={addressBar().listed}
                aria-controls={addressBar().listed ? "browser-suggestions" : undefined}
                aria-activedescendant={addressBar().chosen ? `browser-suggestion-${addressBar().active}` : undefined}
                spellcheck={false}
                autocomplete="off"
                value={addressBar().field}
                disabled={!state()}
                placeholder={plugin.t("address.search")}
                aria-label={plugin.t("address.label")}
                onFocus={() => dispatchAddress({ type: "focused", epoch: epoch() })}
                // Leaving the field without submitting cancels the edit; a submit already ended it. Focus that leaves
                // for the page or another window keeps the field as the document's focus, so the window's return would
                // focus it again and start an edit under the returning click, such as one on the site button.
                onBlur={(event) => {
                  dispatchAddress({ type: "blurred", epoch: epoch() })

                  if (!document.hasFocus()) event.currentTarget.blur()
                }}
                onInput={(event) =>
                  dispatchAddress({
                    type: "input.changed",
                    value: event.currentTarget.value,
                    deleting: event.inputType.startsWith("delete"),
                    visits: props.model.visits(),
                  })
                }
                onKeyDown={(event) => {
                  // Keys during IME composition pick and cancel candidates, not suggestions. Safari can report the
                  // composition-confirming keydown with isComposing false but keyCode 229.
                  if (event.isComposing || event.keyCode === 229) return

                  if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Escape")
                    dispatchAddress({ type: "key.pressed", key: event.key, visits: props.model.visits() }, event)
                }}
              />
              {/* At rest, draw the whole URL over the input's hidden text with its host emphasized. While editing, the
                  input shows its own text so selection and the caret need no mirror. */}
              <Show when={!addressBar().editing && addressBar().field}>
                <div aria-hidden="true" data-slot="browser-address-display">
                  <span data-slot="browser-address-url" data-host={parts().host ? "" : undefined}>
                    <span data-slot="browser-address-muted">{parts().scheme}</span>
                    <span data-slot="browser-address-host">{parts().host}</span>
                    {parts().rest}
                  </span>
                </div>
              </Show>
              {/* The suggestion Enter opens, after the typed text. Long text scrolls the input, which a mirror cannot
                  follow, so only a short query shows it. */}
              <Show
                when={
                  addressBar().editing && addressBar().query.length <= ADDRESS_HINT_MAX_LENGTH && addressBar().chosen
                }
              >
                {(visit) => (
                  <div aria-hidden="true" data-slot="browser-address-hint">
                    <span class="invisible shrink-0">{addressBar().query}</span>
                    <span class="ms-1.5 min-w-0 truncate">{`- ${bare(visit().url)}`}</span>
                  </div>
                )}
              </Show>
            </div>
            {/* Any zoom but 100% stays in sight, as the system browser shows it; a click resets it. */}
            <Show when={zoomed()}>
              <Tooltip placement="top" value={plugin.t("zoom.reset")}>
                <button
                  type="button"
                  data-slot="browser-address-zoom"
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => zoomPage("reset")}
                >
                  {plugin.t("zoom.percent", { percent: Math.round((page()?.zoom ?? 1) * 100) })}
                </button>
              </Tooltip>
            </Show>
            <Show when={address()}>
              <div data-slot="browser-address-actions">
                <Tooltip placement="top" value={plugin.t("page.add")}>
                  <IconButton
                    type="button"
                    variant="ghost-muted"
                    size="small"
                    aria-label={plugin.t("page.add")}
                    disabled={suspended() || failed()}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={openNote}
                    icon={<Icon name="outline-globe-plus" />}
                  />
                </Tooltip>
                <Tooltip placement="top" value={plugin.t(reachable() ? "external.open" : "external.unavailable")}>
                  <IconButton
                    type="button"
                    variant="ghost-muted"
                    size="small"
                    aria-label={plugin.t("external.open")}
                    disabled={!reachable()}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => system.openExternal(address())}
                    icon={<Icon name={newIcons() ? "outline-square-arrow" : "outline-arrow-up-right"} />}
                  />
                </Tooltip>
              </div>
            </Show>
          </form>
          <Popover.Portal>
            <Popover.Content
              data-component="browser-suggestions"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div id="browser-suggestions" role="listbox" aria-label={plugin.t("address.suggestions")}>
                <For each={suggestions()}>
                  {(visit, index) => (
                    <PageRow
                      visit={visit}
                      query={addressBar().query}
                      option={{ id: `browser-suggestion-${index()}`, selected: index() === addressBar().active }}
                      onClick={() => go(visit.url)}
                    />
                  )}
                </For>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
        <div class="flex shrink-0 items-center gap-1">
          <Tooltip placement="top" value={tip(plugin.t("inspect"), keybinds.keybind("browser.inspect"))}>
            {/* The ghost variant sets the button color, so the active accent needs precedence over it. */}
            <IconButton
              variant="ghost-muted"
              size="large"
              data-action="browser-inspect"
              disabled={!inspectable()}
              state={picking() ? "pressed" : undefined}
              classList={{ "!text-v2-icon-icon-accent": overlayed().accent }}
              aria-pressed={picking()}
              aria-label={plugin.t("inspect")}
              onClick={toggleInspect}
              icon={<Icon name="outline-browser-annotate" />}
            />
          </Tooltip>
          <Menu gutter={4} modal={false} placement="bottom-end">
            <Tooltip placement="top" value={plugin.t("options")}>
              <Menu.Trigger
                as={IconButton}
                variant="ghost-muted"
                size="large"
                disabled={!state()}
                icon={<Icon name="outline-dots" />}
                aria-label={plugin.t("options")}
              />
            </Tooltip>
            <Menu.Portal>
              <Menu.Content class="w-[172px]">
                {/* Zooming closes the menu: the page stays a still while the menu covers it, so a zoom would show
                    only once it closed. The address field shows any zoom but 100% afterwards. */}
                <Menu.Group>
                  <Menu.Item
                    disabled={!address()}
                    onSelect={() => zoomPage("in")}
                    shortcut={<Keybind keys={keybinds.keys("mod+plus").map(fullWidth)} variant="neutral" />}
                  >
                    {plugin.t("zoom.in")}
                  </Menu.Item>
                  <Menu.Item
                    disabled={!address()}
                    onSelect={() => zoomPage("out")}
                    shortcut={<Keybind keys={keybinds.keys("mod+-").map(fullWidth)} variant="neutral" />}
                  >
                    {plugin.t("zoom.out")}
                  </Menu.Item>
                  <Menu.Item disabled={!zoomed()} onSelect={() => zoomPage("reset")}>
                    {plugin.t("zoom.reset")}
                  </Menu.Item>
                </Menu.Group>
                <Menu.Separator />
                <Menu.Item disabled={!address()} onSelect={copyLink}>
                  {plugin.t("link.copy")}
                </Menu.Item>
                <Menu.Item disabled={!reachable()} onSelect={() => system.openExternal(address())}>
                  {plugin.t("external.menu")}
                </Menu.Item>
                <Menu.Separator />
                <Menu.Item disabled={props.model.visits().length === 0} onSelect={() => props.model.clearHistory()}>
                  {plugin.t("history.clear")}
                </Menu.Item>
              </Menu.Content>
            </Menu.Portal>
          </Menu>
        </div>
      </div>
      <Show when={error() && !failed()}>
        <div
          class="shrink-0 px-3 py-1.5 text-12-regular text-v2-state-fg-danger border-b border-v2-border-border-muted"
          role="alert"
          aria-live="assertive"
        >
          {error()}
        </div>
      </Show>
      <embeds.View
        id={embed()}
        visible={shown()}
        frozen={overlayed().frozen}
        // A navigation, in-page or not, or a reload starting is another page.
        page={JSON.stringify([state()?.id, state()?.generation, state()?.url, !!state()?.loading])}
        radius={10}
        class="relative min-h-0 flex-1 bg-v2-background-bg-base flex items-center justify-center"
      >
        <div ref={box} aria-hidden="true" class="pointer-events-none absolute inset-0" />
        <Show when={empty() && !failed() && !suspended()}>
          <div dir="auto" class="size-full overflow-y-auto">
            <Show
              when={recent().length > 0}
              fallback={
                <div class="mx-auto flex max-w-[360px] flex-col items-center gap-4 px-6 pt-20 text-center">
                  <Icon name="outline-globe" size="large" class="text-v2-icon-icon-muted" />
                  <div class="flex flex-col gap-2">
                    <div class="text-[13px] font-[530] leading-[var(--line-height-compact)] text-v2-text-text-base">
                      {plugin.t("home.title")}
                    </div>
                    <div class="text-[13px] font-[440] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                      {plugin.t("home.description")}
                    </div>
                  </div>
                </div>
              }
            >
              {/* The pages the browser showed last; the side panel's new tab view offers the other tabs. One visit is
                  enough to list; the list stops at a handful. */}
              <div class="mx-auto flex w-full max-w-[608px] flex-col gap-4 px-6 pt-12 pb-10">
                <div class="text-[13px] font-[440] leading-[var(--line-height-compact)] text-v2-text-text-muted">
                  {plugin.t("home.recent")}
                </div>
                <div class="flex flex-col gap-2">
                  <For each={recent()}>{(visit) => <PageRow visit={visit} onClick={() => go(visit.url)} />}</For>
                </div>
              </div>
            </Show>
          </div>
        </Show>
        <Show when={failed() && !suspended()}>
          {/* Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers. */}
          <div
            dir="auto"
            class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak"
          >
            <Icon name="globe" size="large" class="mb-2 shrink-0" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
              {plugin.t("failed.title")}
            </div>
            <div class="text-13-regular leading-[var(--line-height-base)]">{plugin.t("failed.description")}</div>
          </div>
        </Show>
        <Show when={suspended()}>
          <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
            {plugin.t("suspended")}
          </p>
        </Show>
        <Show when={comment()}>
          {(current) => (
            <div
              data-component="browser-comment"
              class="absolute inset-0 z-10"
              onPointerDown={(event) => {
                // A click beside the editor dismisses it unless it would discard a draft.
                if (event.target === event.currentTarget) dispatchOverlay({ type: "backdrop.pressed" })
              }}
            >
              <Show when={spotlight()}>
                {(rect) => (
                  <div
                    data-slot="browser-comment-spotlight"
                    class="pointer-events-none absolute rounded-[2px]"
                    style={{
                      left: `${rect().x}px`,
                      top: `${rect().y}px`,
                      width: `${rect().width}px`,
                      height: `${rect().height}px`,
                    }}
                  />
                )}
              </Show>
              <Show when={placement()}>
                {(position) => (
                  <div
                    ref={(element) =>
                      createResizeObserver(element, (rect) =>
                        dispatchOverlay({ type: "editor.resized", height: rect.height }),
                      )
                    }
                    data-slot="browser-comment-editor"
                    data-prevent-autofocus
                    class="absolute flex flex-col overflow-hidden rounded-[8px] shadow-[var(--v2-elevation-floating)]"
                    style={{
                      left: `${position().left}px`,
                      top: `${position().top}px`,
                      width: `${position().width}px`,
                      "max-height": `${position().maxHeight}px`,
                    }}
                  >
                    <MenuScroll class="min-h-0">
                      <LineCommentEditor
                        variant="compact"
                        label={plugin.t("comment.label")}
                        placeholder={plugin.t("comment.placeholder")}
                        cancelLabel={plugin.t("comment.cancel")}
                        submitLabel={plugin.t(current().draft.trim() ? "comment.submit" : "comment.attach")}
                        allowEmpty
                        style={{
                          "--line-comment-preview-lines": 2,
                          "--line-comment-max-height": `${position().maxHeight}px`,
                        }}
                        value={current().draft}
                        onInput={(value) => dispatchOverlay({ type: "draft.changed", value })}
                        onCancel={closeOverlay}
                        onSubmit={submitOverlay}
                        mention={{
                          items: (query) => props.screen.file.search(query, { kind: "any" }),
                        }}
                        selection={
                          <span>
                            <Tooltip
                              placement="top"
                              contentStyle={{ "pointer-events": "none" }}
                              value={
                                <span
                                  dir="ltr"
                                  style={{ "font-family": "var(--font-family-mono)", "unicode-bidi": "isolate" }}
                                >
                                  {current().element.selector || current().element.label}
                                </span>
                              }
                            >
                              <span
                                dir="ltr"
                                style={{
                                  "font-family": "var(--font-family-mono)",
                                  "unicode-bidi": "isolate",
                                  display: "-webkit-box",
                                  "-webkit-box-orient": "vertical",
                                  "-webkit-line-clamp": "var(--line-comment-preview-lines)",
                                  overflow: "hidden",
                                  "overflow-wrap": "anywhere",
                                }}
                              >
                                {current().element.selector || current().element.label}
                              </span>
                            </Tooltip>
                          </span>
                        }
                      />
                    </MenuScroll>
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
        <Show when={note()}>
          {(current) => (
            <div
              data-component="browser-comment"
              class="absolute inset-0 z-10"
              onPointerDown={(event) => {
                if (event.target === event.currentTarget) dispatchOverlay({ type: "backdrop.pressed" })
              }}
            >
              {/* Under the page actions at the address field's end, which opened it. */}
              <div
                data-slot="browser-comment-editor"
                data-prevent-autofocus
                class="absolute end-2 top-2 flex flex-col overflow-hidden rounded-[6px] shadow-[var(--v2-elevation-raised)]"
                style={{
                  width: `${Math.max(0, Math.min(400, size().width - 16))}px`,
                  "max-height": `${Math.max(0, size().height - 16)}px`,
                }}
              >
                <MenuScroll class="min-h-0">
                  <LineCommentEditor
                    value={current().draft}
                    onInput={(value) => dispatchOverlay({ type: "draft.changed", value })}
                    onCancel={closeOverlay}
                    onSubmit={submitOverlay}
                    placeholder={plugin.t("page.placeholder")}
                    mention={{
                      items: (query) => props.screen.file.search(query, { kind: "any" }),
                    }}
                    selection={
                      <span class="flex min-w-0 items-center gap-1" dir="ltr">
                        <Icon name="outline-globe" size="small" class="shrink-0" />
                        <span class="min-w-0 truncate leading-[var(--line-height-tight)]">
                          {current().title || addressParts(current().url).host || current().url}
                        </span>
                      </span>
                    }
                  />
                </MenuScroll>
              </div>
            </div>
          )}
        </Show>
      </embeds.View>
      <p class="sr-only" role="status" aria-live="polite">
        {picking() ? plugin.t("inspect.active") : ""}
      </p>
    </aside>
  )
}

/** A page in the suggestions or the new tab page: its icon, title and address, with the query's matches drawn. */
function PageRow(props: {
  visit: Visit
  query?: string
  /** Set for a suggestion: an option of the address field's list, which keeps keyboard focus in the field. */
  option?: { id: string; selected: boolean }
  onClick: () => void
}) {
  const body = () => (
    <>
      <PageIcon icon={props.visit.icon} class="text-v2-icon-icon-muted" />
      <span data-slot="browser-page-row-text">
        <Show when={props.visit.title}>
          <span data-slot="browser-page-row-title">
            <Marked text={props.visit.title} query={props.query ?? ""} />
          </span>
          <span>-</span>
        </Show>
        <span data-slot="browser-page-row-url">
          <Marked text={bare(props.visit.url)} query={props.query ?? ""} />
        </span>
      </span>
    </>
  )

  return (
    <Show
      when={props.option}
      fallback={
        <button type="button" data-component="browser-page-row" dir="ltr" onClick={() => props.onClick()}>
          {body()}
        </button>
      }
    >
      {(option) => (
        <div
          id={option().id}
          role="option"
          aria-selected={option().selected}
          data-component="browser-page-row"
          dir="ltr"
          // The address field keeps focus, so a click does not end editing before it opens the page.
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => props.onClick()}
        >
          {body()}
        </div>
      )}
    </Show>
  )
}

function Marked(props: { text: string; query: string }) {
  return (
    <For each={highlight(props.text, props.query)}>
      {(part) => (
        <Show when={part.match} fallback={part.text}>
          <mark>{part.text}</mark>
        </Show>
      )}
    </For>
  )
}

const connections = {
  secure: { icon: "lock", title: "site.secure", description: undefined },
  insecure: { icon: "outline-hexagonal-warning", title: "site.insecure", description: "site.insecure.description" },
  local: { icon: "monitor", title: "site.local", description: "site.local.description" },
  file: { icon: "folder", title: "site.file", description: "site.file.description" },
} as const

/**
 * What the page can do and what can reach it, under the site button at the address field's start: its connection,
 * its stored data, the permissions it never gets, the agent's access, and the network it loads through.
 */
function SiteInformation(props: {
  url: string
  server: string | undefined
  /** The page's cookie count; undefined while the pane cannot answer. */
  site: () => Promise<{ cookies: number }> | undefined
  clear: () => Promise<void> | undefined
}) {
  const plugin = usePlugin()
  const [siteState, setSiteState] = createSignal(initialSiteState)
  // Whether a pointer opened the popover, so closing it returns focus without a focus ring.
  const [pointer, setPointer] = createSignal(false)
  const view = createMemo(() => siteView(siteState()))
  let timer: ReturnType<typeof setTimeout> | undefined
  let trigger: HTMLButtonElement | undefined

  const dispatch = (event: SiteEvent) => {
    const next = transitionSite(siteState(), event)
    setSiteState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SiteEffect) => {
    if (effect.type === "notify-clear-failed") return showToast({ title: plugin.t("common.requestFailed") })
    const attempt = effect.attempt
    const phase = effect.type === "load" ? "loading" : "clearing"
    clearTimeout(timer)
    timer = setTimeout(
      () => dispatch({ type: "timeout", phase, attempt }),
      effect.type === "load" ? SITE_LOAD_TIMEOUT_MS : SITE_CLEAR_TIMEOUT_MS,
    )

    if (effect.type === "load") {
      const pending = props.site()

      if (!pending) return dispatch({ type: "load.failed", attempt })
      void pending.then(
        (value) => dispatch({ type: "load.succeeded", attempt, cookies: value.cookies }),
        () => dispatch({ type: "load.failed", attempt }),
      )

      return
    }

    const pending = props.clear()

    if (!pending) return dispatch({ type: "clear.failed", attempt })
    void pending.then(
      () => dispatch({ type: "clear.succeeded", attempt }),
      () => dispatch({ type: "clear.failed", attempt }),
    )
  }

  onCleanup(() => {
    clearTimeout(timer)
    dispatch({ type: "disposed" })
  })

  const kind = () => {
    const value = connection(props.url)

    return value ? connections[value] : undefined
  }

  // Only web pages have cookies and ask for permissions; a workspace file has neither.
  const web = () => {
    const value = connection(props.url)

    return !!value && value !== "file"
  }

  const cookieDetail = () => {
    const current = view()

    if (current.failed) return plugin.t("common.requestFailed")

    return current.cookies === undefined ? undefined : plugin.plural("site.cookies.count", current.cookies)
  }

  return (
    <Popover
      open={view().open}
      placement="bottom-start"
      gutter={8}
      shift={-10}
      modal={false}
      onOpenChange={(open) => dispatch({ type: "open.changed", open })}
    >
      <Tooltip placement="top" value={plugin.t("site.info")}>
        <Popover.Trigger
          ref={trigger}
          as={IconButton}
          type="button"
          onPointerDown={() => setPointer(true)}
          onKeyDown={() => setPointer(false)}
          variant="ghost-muted"
          size="small"
          aria-label={plugin.t("site.info")}
          icon={<Icon name="outline-sliders" />}
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          data-component="browser-site"
          // The panel takes focus itself rather than its close button, so a pointer opening shows no focus ring there.
          onOpenAutoFocus={(event: Event) => {
            event.preventDefault()

            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus()
          }}
          // Focus returns to the trigger on close, which Chromium rings after Escape; a pointer opening keeps it unringed.
          onCloseAutoFocus={(event: Event) => {
            if (!pointer()) return
            event.preventDefault()
            const active = document.activeElement

            // An outside press already moved focus where it belongs.
            if (active && active !== document.body && !active.closest('[data-component="browser-site"]')) return
            trigger?.focus({ preventScroll: true, focusVisible: false })
          }}
        >
          <div data-slot="browser-site-row">
            <span data-slot="browser-site-icon">
              <Icon name="outline-globe" />
            </span>
            <Popover.Title data-slot="browser-site-host" dir="ltr">
              {addressParts(props.url).host || props.url}
            </Popover.Title>
          </div>
          <div data-slot="browser-site-separator" aria-hidden="true" />
          <Show when={kind()}>
            {(value) => (
              <SiteRow
                icon={value().icon}
                title={plugin.t(value().title)}
                detail={value().description ? plugin.t(value().description ?? "") : undefined}
              />
            )}
          </Show>
          <Show when={web()}>
            <SiteRow icon="outline-cookie" title={plugin.t("site.cookies")} detail={cookieDetail()}>
              <Button
                size="small"
                variant="neutral"
                disabled={view().actionDisabled}
                onClick={() => dispatch(view().failed ? { type: "retry" } : { type: "clear.clicked" })}
              >
                {plugin.t(view().failed ? "common.retry" : "site.cookies.clear")}
              </Button>
            </SiteRow>
            <SiteRow
              icon="outline-eye-slash"
              title={plugin.t("site.permissions")}
              detail={plugin.t("site.permissions.description")}
            />
          </Show>
          <SiteRow icon="select-element" title={plugin.t("site.agent")} detail={plugin.t("site.agent.description")} />
          <Show when={props.server}>
            {(server) => <SiteRow icon="server" title={plugin.t("site.network", { server: server() })} />}
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

// The zoom shortcuts draw their plus and minus at the width of a letter key.
function fullWidth(key: string) {
  if (key === "+") return "＋"

  if (key === "-") return "－"

  return key
}

function SiteRow(props: { icon: IconName; title: string; detail?: string; children?: JSX.Element }) {
  return (
    <div data-slot="browser-site-row">
      <span data-slot="browser-site-icon">
        <Icon name={props.icon} />
      </span>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span>{props.title}</span>
        <Show when={props.detail}>{(detail) => <span data-slot="browser-site-detail">{detail()}</span>}</Show>
      </div>
      {props.children}
    </div>
  )
}
