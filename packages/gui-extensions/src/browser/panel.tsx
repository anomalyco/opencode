import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { LineCommentEditor } from "@opencode/ui/line-comment"
import { Loader } from "@opencode/ui/loader"
import { Keybind } from "@opencode/ui/keybind"
import { Tooltip } from "@opencode/ui/tooltip"
import { createEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createEffect, For, on, onCleanup, Show, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { App, Native, Surfaces, useExtension, usePanel, type PanelTab, type SessionView } from "../sdk"
import { commentNote } from "./comment"
import type { Model } from "./model"
import type { PaneElement } from "./remote"

export default function SessionBrowserPane(props: { tab: Accessor<PanelTab>; session: SessionView; model: Model }) {
  const extension = useExtension()
  const app = extension.use(App)
  const native = extension.use(Native)
  const surfaces = extension.use(Surfaces)
  const panel = usePanel()
  const visible = () => panel.visible()
  const state = () => props.model.tab(props.session, props.tab().id)
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError
  const suspended = () => props.model.suspended(props.session)
  const command = (action: Browser.Action) => props.model.command(props.session, action)
  const button = { variant: "ghost", size: "large" } as const
  const [store, setStore] = createStore({
    address: "",
    editing: false,
    submitted: false,
    // A submitted navigation the browser has not reported yet; keeps the empty state hidden meanwhile.
    navigating: false,
    // The tab whose element picker is on.
    picking: undefined as Browser.TabID | undefined,
    // A picked element awaiting its comment. The page stays frozen as a still until it closes.
    comment: undefined as
      | {
          tabID: Browser.TabID
          url: string
          // The tab's navigation count at the pick; the element's ref dies when it changes.
          generation: number
          element: PaneElement
          draft: string
        }
      | undefined,
    size: { width: 0, height: 0 },
    editorHeight: 0,
  })
  const empty = () => !address() && !state()?.loading && !store.navigating
  // The desktop page hides blank and loading documents itself; only hide here
  // while the pane shows its own empty or failed state over the surface.
  const shown = () => visible() && !empty() && !failed()
  const surface = () => {
    const tab = state()
    return tab ? props.model.surface(props.session, tab.id) : undefined
  }
  let addressDisplay: HTMLDivElement | undefined
  let box: HTMLDivElement | undefined
  const scheme = () => store.address.match(/^https?:\/\//i)?.[0] ?? ""
  const error = () => {
    const value = props.model.error(props.session)
    if (value === "browser.pane.replaced") return extension.t("replaced")
    if (value === "browser.pane.unsupported") return extension.t("unsupported")
    return value
  }
  const inspectable = () => !!address() && !failed() && !suspended()
  const picking = () => !!state() && store.picking === state()?.id
  // A comment on a picked element freezes the page so its editor can float above it.
  const commenting = () => !!store.comment && store.comment.tabID === state()?.id
  const setPicking = (tabID: Browser.TabID, enabled: boolean) => {
    props.model.inspect(props.session, tabID, enabled)
    setStore("picking", enabled ? tabID : undefined)
  }
  const closeComment = () => {
    const current = store.comment
    if (!current) return
    props.model.highlight(props.session, current.tabID)
    setStore("comment", undefined)
  }
  const toggleInspect = () => {
    const tab = state()
    if (!tab || !inspectable()) return
    if (store.comment) closeComment()
    setPicking(tab.id, !picking())
  }
  const submitComment = (value: string) => {
    const current = store.comment
    if (!current) return
    const tab = state()
    // The draft outlives a reload or agent navigation, but the ref no longer names anything.
    const live = tab?.id === current.tabID && tab.generation === current.generation
    props.session.composer.attach(
      commentNote({
        origin: extension.id,
        tabID: current.tabID,
        url: current.url,
        element: {
          ...(live ? { ref: current.element.ref } : {}),
          selector: current.element.selector,
          label: current.element.label,
          ...(current.element.role ? { role: current.element.role } : {}),
          ...(current.element.name ? { name: current.element.name } : {}),
          ...(current.element.text ? { text: current.element.text } : {}),
        },
        comment: value,
      }),
    )
    closeComment()
  }
  // The picked element in surface pixels, and the editor anchored below it, above it, or over it.
  const spotlight = () => {
    const rect = store.comment?.element.rect
    if (!rect) return
    const zoom = native?.zoom() ?? 1
    return { x: rect.x / zoom, y: rect.y / zoom, width: rect.width / zoom, height: rect.height / zoom }
  }
  const placement = () => {
    const rect = spotlight()
    if (!rect) return
    const gap = 8
    const width = Math.max(0, Math.min(400, store.size.width - gap * 2))
    // The editor scrolls rather than growing past the surface, so its actions stay reachable.
    const maxHeight = Math.max(0, store.size.height - gap * 2)
    // Until the editor has been measured once, assume its default three-row height.
    const height = Math.min(store.editorHeight || 176, maxHeight)
    const left = Math.min(Math.max(gap, rect.x), Math.max(gap, store.size.width - width - gap))
    const below = rect.y + rect.height + gap
    const above = rect.y - gap - height
    const top =
      below + height <= store.size.height - gap
        ? below
        : above >= gap
          ? above
          : Math.max(gap, store.size.height - height - gap)
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
      inspectable,
      inspect: toggleInspect,
    }),
  )

  createEffect(() => {
    onCleanup(
      props.model.onInspect(props.session, (event) => {
        if (event.active) {
          setStore("picking", event.tabID)
          return
        }
        if (store.picking === event.tabID) setStore("picking", undefined)
        if (!event.element) return
        const tab = state()
        if (tab?.id !== event.tabID || !visible()) {
          props.model.highlight(props.session, event.tabID)
          return
        }
        setStore("comment", {
          tabID: tab.id,
          url: tab.url,
          generation: tab.generation,
          element: event.element,
          draft: "",
        })
      }),
    )
  })
  // A picker or comment belongs to the page on screen; switching tabs or hiding the pane ends it.
  createEffect(
    on([() => state()?.id, visible], ([id, shown]) => {
      const tabID = untrack(() => store.picking)
      if (tabID && (tabID !== id || !shown)) setPicking(tabID, false)
      if (untrack(() => store.comment)?.tabID !== id) closeComment()
    }),
  )
  // The page does not have focus while the picker waits for a hover, so Escape reaches the app.
  createEventListener(
    window,
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !store.picking) return
      event.preventDefault()
      event.stopPropagation()
      setPicking(store.picking, false)
    },
    { capture: true },
  )
  createResizeObserver(
    () => box,
    (rect) => setStore("size", { width: rect.width, height: rect.height }),
  )

  // A restored tab has no page until the pane first shows it.
  createEffect(() => {
    const tab = state()
    if (!tab || !shown() || surface()) return
    props.model.load(props.session, tab.id)
  })
  createEffect(on([() => state()?.id, address], () => !store.editing && setStore("address", address())))
  // Any reported movement, including a rejected or blocked request, ends the submitted navigation.
  createEffect(
    on(
      [() => state()?.id, () => state()?.generation, () => state()?.loading, () => props.model.error(props.session)],
      () => setStore("navigating", false),
      { defer: true },
    ),
  )
  // A blocked or rejected submission leaves the page where it was; show that page's URL again.
  createEffect(
    on(
      () => props.model.error(props.session),
      (error) => {
        if (error && !store.editing) setStore("address", address())
      },
      { defer: true },
    ),
  )

  return (
    <aside id="browser-panel" class="relative size-full min-w-0 overflow-hidden bg-v2-background-bg-base flex flex-col">
      <div class="h-10 shrink-0 flex items-center gap-1 px-3 border-b border-v2-border-border-muted">
        <For each={["back", "forward"] as const}>
          {(direction) => (
            <Tooltip placement="top" value={extension.t(direction === "back" ? "common.goBack" : "common.goForward")}>
              <IconButton
                {...button}
                disabled={!state()?.[direction === "back" ? "canGoBack" : "canGoForward"]}
                aria-label={extension.t(direction === "back" ? "common.goBack" : "common.goForward")}
                onClick={() => {
                  const tab = state()
                  if (tab) command({ type: direction, tabID: tab.id })
                }}
                icon={
                  <Icon
                    name={direction === "back" ? "chevron-left" : "chevron-right"}
                    size="small"
                    class="rtl:rotate-180"
                  />
                }
              />
            </Tooltip>
          )}
        </For>
        <Tooltip
          placement="top"
          value={
            <div class="flex items-center gap-2">
              <span>{extension.t(state()?.loading ? "action.stop" : "action.reload")}</span>
              <Show when={!state()?.loading}>
                <Keybind keys={[...app.keybind("browser.reload")]} variant="neutral" />
              </Show>
            </div>
          }
        >
          <IconButton
            {...button}
            disabled={!state()?.loading && !address()}
            aria-label={extension.t(state()?.loading ? "action.stop" : "action.reload")}
            onClick={() => {
              const tab = state()
              if (tab) command({ type: tab.loading ? "stop" : "reload", tabID: tab.id })
            }}
            icon={
              <Show when={state()?.loading} fallback={<Icon name="refresh" size="small" />}>
                <Loader />
              </Show>
            }
          />
        </Tooltip>
        <Tooltip
          placement="top"
          value={
            <div class="flex flex-col gap-1">
              <div class="flex items-center gap-2">
                <span>{extension.t("inspect")}</span>
                <Show when={app.keybind("browser.inspect").length > 0}>
                  <Keybind keys={[...app.keybind("browser.inspect")]} variant="neutral" />
                </Show>
              </div>
              {/* The page claims Chromium's picker chord itself; the app leaves it to the terminal. */}
              <div class="flex items-center gap-2">
                <span>{extension.t("inspect.pageShortcut")}</span>
                <Keybind keys={[...app.keys("mod+shift+c")]} variant="neutral" />
              </div>
            </div>
          }
        >
          {/* The ghost variant sets the button color, so the active accent needs precedence over it. */}
          <IconButton
            {...button}
            data-action="browser-inspect"
            disabled={!inspectable()}
            state={picking() ? "pressed" : undefined}
            classList={{ "!text-v2-icon-icon-accent": picking() || !!store.comment }}
            aria-pressed={picking()}
            aria-label={extension.t("inspect")}
            onClick={toggleInspect}
            icon={<Icon name="select-element" size="small" />}
          />
        </Tooltip>
        <form
          dir="ltr"
          class="relative min-w-0 flex-1 h-7 rounded-md hover:bg-v2-overlay-simple-overlay-hover focus-within:bg-v2-overlay-simple-overlay-hover text-12-regular"
          onSubmit={(event) => {
            event.preventDefault()
            const tab = state()
            const url = store.address.trim()
            if (!tab) return
            if (url || failed()) {
              setStore({ submitted: true, address: url, navigating: true })
              command({ type: "navigate", tabID: tab.id, url: url || "about:blank" })
            }
            event.currentTarget.querySelector("input")?.blur()
          }}
        >
          <input
            class="w-full h-full px-2 rounded-md border border-transparent bg-transparent text-transparent caret-v2-text-text-base placeholder:text-v2-text-text-faint outline-none focus:border-v2-border-border-focus"
            spellcheck={false}
            autocomplete="off"
            value={store.address}
            disabled={!state()}
            placeholder={extension.t("address.placeholder")}
            aria-label={extension.t("address.label")}
            onFocus={(event) => {
              setStore("editing", true)
              event.currentTarget.select()
            }}
            onClick={(event) => event.currentTarget.select()}
            onBlur={() =>
              setStore({ editing: false, address: store.submitted ? store.address : address(), submitted: false })
            }
            onInput={(event) => setStore("address", event.currentTarget.value)}
            onScroll={(event) => {
              if (addressDisplay) addressDisplay.scrollLeft = event.currentTarget.scrollLeft
            }}
          />
          {/* Keep native input editing and selection while coloring the scheme, including during editing. */}
          <div
            aria-hidden="true"
            class="absolute inset-0 flex items-center px-2 border border-transparent pointer-events-none"
          >
            <div ref={addressDisplay} class="w-full overflow-hidden whitespace-pre text-v2-text-text-base">
              <span class="text-v2-text-text-muted">{scheme()}</span>
              {store.address.slice(scheme().length)}
            </div>
          </div>
        </form>
      </div>
      <Show when={error() && !failed()}>
        <div
          class="shrink-0 px-3 py-1.5 text-12-regular text-text-danger-base border-b border-v2-border-border-muted"
          role="alert"
          aria-live="assertive"
        >
          {error()}
        </div>
      </Show>
      <surfaces.View
        id={surface()}
        visible={shown()}
        frozen={commenting()}
        radius={10}
        class="relative min-h-0 flex-1 bg-v2-background-bg-base flex items-center justify-center"
      >
        <div ref={box} aria-hidden="true" class="pointer-events-none absolute inset-0" />
        <Show when={(empty() || failed()) && !suspended()}>
          {/* Add the 40px toolbar to the file empty state's 160px bottom padding to align their centers. */}
          <div
            dir="auto"
            class="flex size-full flex-col items-center justify-center gap-2 p-6 pb-[200px] text-center text-text-weak"
          >
            <Icon name="globe" size="large" class="mb-2 shrink-0" />
            <div class="text-[13px] font-medium leading-[var(--line-height-compact)] text-text-strong">
              {extension.t(failed() ? "failed.title" : "empty.title")}
            </div>
            <div class="text-13-regular leading-[var(--line-height-base)]">
              {extension.t(failed() ? "failed.description" : "empty.description")}
            </div>
          </div>
        </Show>
        <Show when={suspended()}>
          <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
            {extension.t("suspended")}
          </p>
        </Show>
        <Show when={commenting() && store.comment}>
          {(current) => (
            <div
              data-component="browser-comment"
              class="absolute inset-0 z-10"
              onPointerDown={(event) => {
                // A click beside the editor dismisses it unless it would discard a draft.
                if (event.target === event.currentTarget && !current().draft.trim()) closeComment()
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
                      createResizeObserver(element, (rect) => setStore("editorHeight", Math.ceil(rect.height)))
                    }
                    data-slot="browser-comment-editor"
                    data-prevent-autofocus
                    class="absolute overflow-y-auto rounded-[6px] shadow-[var(--v2-elevation-raised)]"
                    style={{
                      left: `${position().left}px`,
                      top: `${position().top}px`,
                      width: `${position().width}px`,
                      "max-height": `${position().maxHeight}px`,
                    }}
                  >
                    <LineCommentEditor
                      value={current().draft}
                      onInput={(value) => setStore("comment", "draft", value)}
                      onCancel={closeComment}
                      onSubmit={submitComment}
                      mention={{ items: (query) => props.session.file.search(query, { kind: "any" }) }}
                      selection={
                        <span class="flex min-w-0 items-center gap-1" dir="ltr">
                          <Icon name="select-element" size="small" class="shrink-0" />
                          <span class="min-w-0 truncate leading-[var(--line-height-tight)]">
                            {current().element.label}
                          </span>
                        </span>
                      }
                    />
                  </div>
                )}
              </Show>
            </div>
          )}
        </Show>
      </surfaces.View>
      <p class="sr-only" role="status" aria-live="polite">
        {picking() ? extension.t("inspect.active") : ""}
      </p>
    </aside>
  )
}
