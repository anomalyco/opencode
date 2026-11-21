import { Popover } from "@kobalte/core/popover"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
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
import { debounce } from "@solid-primitives/scheduled"
import {
  createMemo,
  createSignal,
  createUniqueId,
  For,
  getOwner,
  Index,
  onCleanup,
  onMount,
  runWithOwner,
  Show,
  untrack,
  type Accessor,
  type JSX,
  type ParentProps,
} from "solid-js"
import type { Browser } from "@opencode/plugin-browser/rpc"
import {
  createKeyed,
  usePlugin,
  usePanel,
  type ComposerNote,
  type PanelTab,
  type MountedSession,
  type SessionScreen,
} from "@opencode/plugin/gui"
import { addressParts, connection, externalAction, externalPage, loopback } from "./address"
import { hostDisplay } from "./host-display"
import { FileSource } from "../file/contract"
import { remotePath, workspacePrefix } from "./remote-address"
import {
  addressRows,
  addressView,
  initialAddressState,
  nextAddressEpoch,
  transitionAddress,
  type AddressEpoch,
  type AddressEvent,
  type AddressRow,
} from "./address-machine"
import { commentNote, pageNote } from "./comment"
import { Glyph } from "./choices"
import type { HistoryPage } from "./history/ipc"
import { markMatches, parseQuery, type Query } from "./history/match"
import { bare } from "./history/page"
import { SignInOffer } from "./import-prompt"
import { SiteChooserDialog } from "./site-chooser"
import type definition from "./index"
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
import { loadFailure } from "./failure"
import { FailureBar, FailurePage } from "./failure-view"
import { FindBar } from "./find-bar"
import { RefusalBar } from "./refusal-bar"
import type { FindAction, PromptAnswer } from "./ipc"
import { blocking, PromptBar, PromptDialog } from "./prompts"
import { BrowserProfile, type ProfileExtension } from "./profile/ipc"
import { ViewportControls } from "./viewport-controls"
import {
  initialViewportToolbar,
  transitionViewportToolbar,
  viewportToolbarAvailable,
  viewportToolbarView,
  type ViewportToolbarEvent,
} from "./viewport-toolbar-machine"
import { viewportLayout } from "./viewport-layout"
import { ViewportHandles } from "./viewport-handles"
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

/** How long a notice about a command that did not work stays before it goes by itself. */
const FAILURE_NOTICE_MS = 8_000

const sendLabels = { send: "comment.send", steer: "comment.steer", queue: "comment.queue" } as const

const mac = /(Mac|iPhone|iPad)/.test(navigator.platform)

/** An element a component reads after render, such as a button a native view anchors to. */
type ElementRef = { element?: HTMLElement }

/** The site information's two controls that lead to its other view; each takes the keyboard when the view changes. */
type SiteViews = { open?: HTMLButtonElement; back?: HTMLButtonElement }

export default function SessionBrowserPane(props: {
  tab: Accessor<PanelTab>
  session: MountedSession
  screen: SessionScreen
  model: Model
}) {
  const plugin = usePlugin<typeof definition>()
  const keybinds = plugin.keybinds
  const desktop = plugin.desktop
  const embeds = plugin.embeds
  const system = plugin.system
  const panel = usePanel()
  const visible = () => panel.visible()
  const state = () => props.model.tab(props.session, props.tab().id)
  const address = () => (state()?.url === "about:blank" ? "" : (state()?.url ?? ""))
  const failed = () => !!state()?.loadError

  // The page that did not load, as the page area explains it.
  const loadFailed = createMemo(() => {
    const error = state()?.loadError

    return error === undefined ? undefined : loadFailure(error)
  })

  const serverFile = () => /^(workspace|artifact):/.test(address())
  const offline = () => serverFile() && !props.session.server.connected
  const suspended = () => offline() || props.model.suspended(props.session)
  const command = (action: Browser.Action) => props.model.command(props.session, action)
  const profile = plugin.use(BrowserProfile)
  const fileSource = plugin.use(FileSource)

  const sourcePath = () => {
    const url = address()

    if (!url.startsWith("file:///")) {
      const prefix = workspacePrefix(props.session.id ?? "")

      return remotePath(url, prefix) ? url.slice(prefix.length).split(/[?#]/, 1)[0] : undefined
    }

    return url
  }

  const source = () => {
    const provider = fileSource()
    const path = sourcePath()

    return provider.status === "active" && path ? () => provider.value.open(props.session, path) : undefined
  }

  // The pane offers to import sign-ins until the user imports or declines once, and keeps the offer's confirmation of
  // an import until the user closes it.
  const [confirming, setConfirming] = createSignal(false)
  const offering = () => !plugin.stores.preferences.value.welcomed || confirming()

  const extensions = () => {
    const current = profile()

    return current.status === "active" ? (current.value.state()?.extensions ?? []) : []
  }

  // The extensions button, which an extension's popup opens under.
  const extensionsButton: ElementRef = {}

  // An extension's button opens its popup or tells it of the click; one without a button opens its options page.
  const chooseExtension = (extension: ProfileExtension) => {
    if (!visible()) return
    const current = profile()
    const rect = extensionsButton.element?.getBoundingClientRect()
    // Where the page area starts, under the toolbar and any bar below it: a popup starts there too, as in every
    // browser. A device viewport sits inside that area, smaller and inset, and the popup belongs to the button in
    // the toolbar, not to the device: it stays under the bars and may cover the device's page.
    const pageTop = preview?.getBoundingClientRect().top
    const binding = props.model.binding(props.session)
    const tab = state()

    const fallback = () => {
      const page = extension.options ?? extension.popup

      if (page) props.model.openURL(props.session, page)
    }

    if (current.status !== "active" || !rect || pageTop === undefined || !binding || !tab) return fallback()
    const anchor = { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    // In a right-to-left layout the button is at the left end of the bar, and the popup opens to its right.
    const rtl = !!extensionsButton.element?.matches(":dir(rtl)")
    void current.value.click({ id: extension.id, binding, tabID: tab.id, anchor, pageTop, rtl }).then((handled) => {
      if (!handled) fallback()
    }, fallback)
  }

  const page = () => {
    const tab = state()

    return tab ? props.model.page(props.session, tab.id) : undefined
  }

  const [addressState, setAddressState] = createSignal(initialAddressState)
  const [available, setAvailable] = createSignal({ width: 0, height: 0 })
  const [toolbar, setToolbar] = createSignal(initialViewportToolbar)
  const [pointerFocusedToggle, setPointerFocusedToggle] = createSignal(false)
  const viewportID = createUniqueId()
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

  // The list follows what the user typed; a focused address is not a query.
  const rows = createMemo(() => addressRows(addressState(), props.model.visits()))
  const addressBar = createMemo(() => addressView(addressState(), epoch(), rows()))
  // The typed words, whose matches each page of the list draws.
  const query = createMemo(() => parseQuery(addressBar().query))

  // Ends the questions to main's history that are still out when the pane goes.
  const asking = new AbortController()
  onCleanup(() => asking.abort())

  const dispatchAddress = (event: AddressEvent, domEvent?: Event) => {
    const next = transitionAddress(untrack(addressState), event)
    setAddressState(next.state)
    // The field's text is the machine's. After a key the input holds only what was typed, while the machine may show
    // a completed address after it, or a row's text; the same text as before is not written by the binding.
    const field = untrack(addressBar).field

    if (input && input.value !== field) input.value = field
    next.effects.forEach((effect) => {
      if (effect.type === "select-input") return input?.select()

      // The caret stays after the typed text, as Chrome's does, so the next key replaces the completed part.
      if (effect.type === "select-completion") return input?.setSelectionRange(effect.start, input.value.length, "backward")

      if (effect.type === "blur-input") return input?.blur()

      if (effect.type === "prevent-default") return domEvent?.preventDefault()

      if (effect.type === "forget") return props.model.forgetPage(effect.url)

      if (effect.type === "prepare") return props.model.prepareHistory()

      if (effect.type === "ask") {
        // The field already shows what was typed and what the window knows; main's pages join when they come. A
        // question main cannot answer, as on the web, is answered with none.
        const answer = (pages: readonly HistoryPage[]) => {
          if (!asking.signal.aborted) dispatchAddress({ type: "answered", attempt: effect.attempt, pages, visits: props.model.visits() })
        }

        return void props.model.searchHistory(effect.query, asking.signal).then(answer, () => answer([]))
      }

      command({ type: "navigate", tabID: effect.tabID, url: effect.url })
    })
  }

  // Editing shows the icon of what Enter would open: the chosen page's once the person typed, else the page's own.
  const fieldIcon = () => {
    const bar = addressBar()

    if (!bar.editing || !bar.field) return undefined

    if (!bar.typed) return page()?.icon

    return bar.chosen?.type === "page" ? bar.chosen.page.icon : undefined
  }

  // After a row's title: a page's address, what a search row searches with, or the typed address itself.
  const rowDetail = (row: AddressRow) => {
    if (row.type === "search") return plugin.t("address.search.web")

    return row.type === "page" ? bare(row.url) : row.text
  }

  // A caret or a selection that leaves the end of the text ends completing, as in Chrome: the completed address
  // becomes part of the text, and no later answer completes text the person is working inside.
  const caretMoved = () => {
    const bar = untrack(addressBar)

    if (!input || !bar.completing) return
    const end = input.value.length

    if (input.selectionStart === bar.field.length - bar.completion.length && input.selectionEnd === end) return

    dispatchAddress({
      type: "input.changed",
      value: input.value,
      completing: input.selectionStart === end && input.selectionEnd === end,
      visits: props.model.visits(),
    })
  }

  const empty = () => !address() && !state()?.loading && !addressBar().navigating
  // The desktop page hides blank and loading documents itself; only hide here
  // while the pane shows its own empty or failed state over the embed.
  const shown = () => visible() && !empty() && !failed() && !suspended()

  const embed = () => {
    const tab = state()

    return tab ? props.model.embed(props.session, tab.id) : undefined
  }

  let root: HTMLElement | undefined
  let toolbarToggle: HTMLButtonElement | undefined
  let input: HTMLInputElement | undefined
  let anchor: HTMLFormElement | undefined
  let findInput: HTMLInputElement | undefined

  // `tabID` is the tab whose find bar took the key or click, which answers for no other tab.
  const find = (action: FindAction, tabID = state()?.id) => {
    const tab = state()

    // Nothing to search while a dialog blocks the page; the bar would also sit beside the dialog's focus trap.
    if (!tab || tab.id !== tabID || (action.type !== "close" && promptKey(true))) return

    if (action.type === "open" && findInput?.isConnected) {
      findInput.focus()
      findInput.select()

      return
    }

    void props.model.find(props.session, tab.id, action).catch(() => showToast({ title: plugin.t("find.failed") }))
  }

  // A command that did not work, or an address the pane refused. With no page to keep, it shows where the page would
  // be; otherwise as a line above the page, which goes by itself unless it is a refusal the person should read.
  const failure = createMemo(() => {
    const tab = state()

    return tab ? props.model.failure(props.session, tab.id) : undefined
  })

  const pageFailure = () => {
    const current = failure()

    return current && !current.lasting && empty() && !suspended() ? current : undefined
  }

  const barFailure = () => (pageFailure() ? undefined : failure())

  createKeyed(
    () => {
      const current = barFailure()

      return current && !current.lasting ? current.id : undefined
    },
    (id) => {
      const timer = setTimeout(() => props.model.dismissFailure(props.session, id), FAILURE_NOTICE_MS)
      onCleanup(() => clearTimeout(timer))
    },
  )

  // What the tab on screen waits on the user for: a bar above a page that keeps working, or a dialog over the still of
  // a page it blocks. Each prompt mounts afresh, so its fields start from its own values.
  const prompt = () => {
    const tab = state()

    return tab && !suspended() ? props.model.prompt(props.session, tab.id) : undefined
  }

  // A prompt is its tab's: each tab counts its prompts from 1, so without the tab the first prompt of two tabs would
  // be one prompt here, and a bar would stay mounted, with its input protection spent, when the tab on screen changes.
  const promptKey = (modal: boolean) => {
    const tab = state()
    const current = prompt()

    return tab && current && blocking(current) === modal ? `${tab.id}:${current.ask.kind}:${current.id}` : undefined
  }

  const drawn = () => shown() && prompt()?.ask.kind !== "dialog"
  createKeyed(() => visible() && state()?.id, id => props.model.seen(props.session, id))
  const revealGuard = () => props.model.revealGuard(props.session, props.tab().id)
  // One computation under the pane's owner. Written inline as the embed's prop, the condition compiles to a getter that
  // makes a new one on every read, and the embed reads it from callbacks that have no owner to dispose them.
  const pageVisible = createMemo(() => drawn() && revealGuard() === undefined)
  // An agent's show request put this tab under the person's pointer. Until the guard ends, the page is hidden and the
  // tab's bars, notices and dialogs answer no click or key. The keyboard stays where it is: an inert pane would drop
  // it, and what the person was typing in the address field would go to the composer and from there to the agent.
  const guarded = createMemo(() => revealGuard() !== undefined)

  // The guard's delay starts when the person can see this tab: the pane shows it, in a window that is not hidden.
  createKeyed(() => visible() && props.model.windowShown() && revealGuard(), (token) => props.model.revealDrawn(props.session, token))

  // Focus moves to a prompt only when the user was in the pane or its page, never from the composer, and never to the
  // prompt of a tab an agent has just shown: the keyboard stays where the person was typing.
  const promptFocus = () => !guarded() && (!!prompt()?.focus || !!root?.contains(document.activeElement))

  // What a prompt that just mounted under `promptKey` answers: the request it was drawn for, in its session and tab,
  // whichever tab is on screen by the time the press arrives.
  const answer = () => {
    const session = untrack(() => props.session)
    const tab = untrack(state)
    const current = untrack(prompt)

    if (!tab || !current) return () => undefined

    return (value: PromptAnswer) =>
      void props.model.answer(session, tab.id, current.id, value).catch(() => showToast({ title: plugin.t("prompt.failed") }))
  }

  const inspectable = () => !!address() && !failed() && !suspended()
  const windowZoom = () => desktop?.zoom() ?? 1

  const fixedViewport = () => {
    const viewport = page()?.viewport

    return inspectable() && viewport?.mode === "fixed" ? viewport : undefined
  }

  const fit = createMemo(() => {
    const viewport = fixedViewport()
    const area = available()

    if (!viewport || area.width <= 0 || area.height <= 0) return

    return viewportLayout(viewport, area, windowZoom())
  })

  const size = () => fit() ?? available()
  // One computation, as `pageVisible` is: a fixed device viewport shows its page only once it has a place.
  const embedVisible = createMemo(() => pageVisible() && (!fixedViewport() || !!fit()))
  const tabID = createMemo(() => state()?.id)

  // A new visit to the same tab must not receive the old visit's failure toast.
  const toolbarTarget = createMemo(() => {
    const id = tabID()

    return id ? { sessionKey: props.session.key, tabID: id } : undefined
  })

  const toolbarContext = () => ({ target: toolbarTarget(), available: visible() && inspectable(), page: page() })
  const toolbarView = createMemo(() => viewportToolbarView(toolbar(), toolbarContext()))
  const toolbarVisible = () => toolbarView().visible
  const notice = () => toolbarView().notice

  const toggleTimeout = debounce(
    (attempt: number) => dispatchToolbar({ type: "timeout", attempt, context: toolbarContext() }),
    10_000,
  )

  const dispatchToolbar = (event: ViewportToolbarEvent) => {
    const next = transitionViewportToolbar(untrack(toolbar), event)
    setToolbar(next.state)
    const effect = next.effect

    if (!effect) return

    if (effect.type === "notify-failed") return showToast({ title: plugin.t("viewport.error") })
    const { attempt, target, open } = effect
    toggleTimeout(attempt)
    void props.model.toggleViewport({ key: target.sessionKey }, target.tabID, open).then(
      () => dispatchToolbar({ type: "succeeded", attempt }),
      () => dispatchToolbar({ type: "failed", attempt, context: toolbarContext() }),
    )
  }

  const toggleToolbar = () => dispatchToolbar({ type: "toggled", context: toolbarContext() })
  onCleanup(() => dispatchToolbar({ type: "disposed" }))

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

  const attach = (send: boolean, note: ComposerNote) => {
    props.screen.composer.attach(note)

    if (send) props.screen.composer.send(note.commentID)
  }

  const dispatchOverlay = (event: OverlayEvent) => {
    const next = transitionOverlay(untrack(overlay), event)
    setOverlay(next.state)
    next.effects.forEach((effect) => {
      if (effect.type === "set-inspect")
        return props.model.inspect({ key: effect.sessionKey }, effect.tabID, effect.enabled)

      if (effect.type === "clear-highlight") return props.model.highlight({ key: effect.sessionKey }, effect.tabID)

      // The owning screen's composer serves the session the pane shows.
      if (effect.type === "attach-comment")
        return attach(
          effect.send,
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

      attach(
        effect.send,
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
  const webParts = createMemo(() => hostDisplay(addressBar().field))
  const parts = () => webParts() ?? addressParts(addressBar().field)
  const site = () => !!addressBar().field && !addressBar().editing && !page()?.retryOnly
  const recent = () => props.model.visits().slice(0, RECENT)

  const pageTarget = () => {
    const tab = state()
    const session = props.session
    const url = tab?.url ?? ""
    const id = tab?.id
    const generation = tab?.generation
    const failed = () => plugin.toast.show({ variant: "error", title: plugin.t("menu.failed") })
    const current = () => props.session.key === session.key && state()?.id === id && state()?.generation === generation && state()?.url === url

    return {
      source: source(),
      serverFile: serverFile(),
      open: externalPage(url, session.server.local) && (!tab?.loadError || externalAction(url, session.server.local) === "browser"),
      reveal: externalAction(url, session.server.local) === "reveal",
      openPage() {
        if (!id || !current()) return failed()
        void props.model.openPage(session, id, url).catch(failed)
      },
      revealFile() {
        if (!id || !current()) return failed()
        void props.model.revealFile(session, id)?.catch(failed)
      },
    }
  }

  const [menuPage, setMenuPage] = createSignal<ReturnType<typeof pageTarget>>()

  const closeOverlay = () => dispatchOverlay({ type: "overlay.cancelled" })
  const toggleInspect = () => dispatchOverlay({ type: "picker.toggled", context: context() })

  const focusAddress = () => {
    input?.focus()
    input?.select()
  }

  // Navigates the tab and keeps the address in the field until the page reports where it went. Ends editing here rather
  // than on blur: a click elsewhere, such as a recent page, may have blurred the field already.
  const go = (url: string) => dispatchAddress({ type: "navigated", url, epoch: epoch() })

  // Cookies came in: the offer stays to say so, and the page loads again with them, so a signed-out site opens signed
  // in.
  const imported = () => {
    const tab = state()
    setConfirming(true)

    if (tab && address()) command({ type: "reload", tabID: tab.id })
  }

  // A passkey sign-in this browser cannot do: the import opens on the page's site, chosen already only in a tab of the
  // person's. The notice stays until an import brought cookies, which then load the page again; a cancelled import
  // leaves it, to try again.
  const owner = getOwner()

  const importSignIn = (tabID: Browser.TabID, passkey: { site?: string; choose: boolean }) =>
    runWithOwner(owner, () =>
      plugin.dialogs.open((dialog) => (
        <SiteChooserDialog
          site={passkey.site ? { name: passkey.site, choose: passkey.choose } : undefined}
          imported={() => {
            void props.model.answerNotice(props.session, tabID, true).catch(() => undefined)
            command({ type: "reload", tabID })
          }}
          close={() => dialog.close()}
        />
      )),
    )

  const submitOverlay = (value: string) => dispatchOverlay({ type: "overlay.submitted", value, context: context() })

  const sendOverlay = createMemo(() => {
    const delivery = props.screen.composer.delivery()

    return {
      label: plugin.t(sendLabels[delivery ?? "send"]),
      keys: [mac ? "⌘" : plugin.t("common.key.ctrl"), "⏎"],
      disabled: delivery === undefined,
      onSubmit: (value: string) =>
        dispatchOverlay({ type: "overlay.submitted", value, context: context(), send: true }),
    }
  })

  const openNote = () => dispatchOverlay({ type: "note.opened", context: context() })

  const zoomed = () => !!address() && (page()?.zoom ?? 1) !== 1

  // Keep the grip gutters in the measured layout while an annotation freezes the page.
  const resizable = () => toolbarVisible() && !zoomed() && embed()

  const dimensions = () => ({
    width: Math.round((available().width * windowZoom()) / (page()?.zoom ?? 1)),
    height: Math.round((available().height * windowZoom()) / (page()?.zoom ?? 1)),
  })

  const viewportMessage = () => {
    if (notice() === "failed") return plugin.t("viewport.fitFailed")

    if (notice() === "zoom") return plugin.t("viewport.zoomExit")

    if (zoomed()) return plugin.t("viewport.zoomPrompt")
  }

  const zoomPage = (direction: "in" | "out" | "reset") => {
    const tab = state()

    if (tab) props.model.zoom(props.session, tab.id, direction)
  }

  const copyLink = () => {
    const url = address()

    if (!url || serverFile()) return
    void system.copy(url).then(
      () => showToast({ title: plugin.t("common.copied") }),
      () => showToast({ title: plugin.t("link.copyFailed") }),
    )
  }

  // What can help on the error page: loading again, and for a certificate problem on this computer's own address the
  // system browser, where a development certificate is often trusted.
  const failureActions = () => {
    const view = loadFailed()
    const tab = state()

    if (!view || !tab) return []
    const url = address()
    const local = view.kind === "insecure" && URL.canParse(url) && loopback(new URL(url).hostname)

    return [
      ...(view.reload ? [{ label: plugin.t("action.reload"), run: () => command({ type: "reload", tabID: tab.id }) }] : []),
      ...(local && pageTarget().open ? [{ label: plugin.t("external.open"), run: () => pageTarget().openPage() }] : []),
    ]
  }

  // Snapshot the surface in native DIPs at pick time so the spotlight scales with the still.
  const pickedRect = createMemo(() => comment()?.element.rect)

  const capture = createMemo(() => {
    const rect = pickedRect()

    if (!rect) return
    const surface = untrack(size)
    const zoom = untrack(windowZoom)

    return { rect, width: surface.width * zoom, height: surface.height * zoom }
  })

  const spotlight = () => {
    const original = capture()

    if (!original?.width || !original.height) return
    const rect = original.rect
    const x = size().width / original.width
    const y = size().height / original.height

    return { x: rect.x * x, y: rect.y * y, width: rect.width * x, height: rect.height * y }
  }

  // The page area under the toolbar and its bars. An extension's popup opens at its top edge.
  let preview: HTMLDivElement | undefined
  let backdrop: HTMLDivElement | undefined
  const [origin, setOrigin] = createSignal({ x: 0, y: 0 })

  // The spotlight scrolls with the still. Translate its page coordinates to the visible pane for the editor.
  const trackPage = (surface: HTMLDivElement) => {
    const port = preview

    if (!port) return

    const measure = () => {
      if (!backdrop) return
      const page = surface.getBoundingClientRect()
      const pane = backdrop.getBoundingClientRect()

      setOrigin({ x: page.left - pane.left, y: page.top - pane.top })
    }

    onMount(measure)
    createResizeObserver([surface, port], measure)
    createEventListener(port, "scroll", measure, { passive: true })
  }

  const placement = () => {
    const rect = spotlight()

    if (!rect) return
    const pane = available()
    const gap = 8
    const width = Math.max(0, Math.min(320, pane.width - gap * 2))
    // The editor scrolls rather than growing past the surface, so its actions stay reachable.
    const surfaceHeight = Math.max(0, pane.height - gap * 2)
    // Pick the opening side from its first measurement, then grow upward from that bottom edge.
    const initialHeight = Math.min(comment()?.editorInitialHeight || 80, surfaceHeight)
    const y = origin().y + rect.y
    const left = Math.min(Math.max(gap, origin().x + rect.x), Math.max(gap, pane.width - width - gap))
    const below = Math.max(gap, y + rect.height + gap)
    const above = y - gap - initialHeight

    const openingTop =
      below + initialHeight <= pane.height - gap
        ? below
        : above >= gap
          ? above
          : Math.max(gap, pane.height - initialHeight - gap)

    const bottom = Math.min(openingTop + initialHeight, pane.height - gap)
    const maxHeight = Math.max(0, bottom - gap)
    const height = Math.min(comment()?.editorHeight || initialHeight, maxHeight)
    const top = Math.max(gap, bottom - height)

    return { left, top, width, maxHeight }
  }

  onCleanup(
    props.model.mount({
      visible,
      address,
      reload: (ignoreCache) => {
        const tab = state()

        if (tab) command({ type: "reload", tabID: tab.id, ignoreCache })
      },
      close: () => {
        const tab = state()

        if (tab) props.model.close(props.session, tab.id)
      },
      inspectable,
      inspect: toggleInspect,
      toggleToolbar: () => {
        toggleToolbar()
        setPointerFocusedToggle(false)
        toolbarToggle?.focus({ preventScroll: true, focusVisible: true })
      },
      focusAddress,
      find: () => find({ type: "open" }),
      findMatch: (type) => find({ type }),
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
    () => preview,
    (rect) => setAvailable({ width: rect.width, height: rect.height }),
  )

  // The outer box anchors the editors while the preview grid scrolls underneath.
  const Preview = (view: ParentProps) => (
    <div class="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={preview}
        data-component="browser-preview"
        data-fixed={fixedViewport() ? "" : undefined}
        data-resizable={resizable() ? "" : undefined}
        data-manual={fixedViewport()?.scale ? "" : undefined}
        data-embed-clip={fixedViewport()?.scale ? "" : undefined}
        style={{
          "grid-template-columns": fit() ? `${size().width}px` : "minmax(0, 1fr)",
          "grid-template-rows": fit() ? `${size().height}px` : "minmax(0, 1fr)",
        }}
      >
        {view.children}
        <Show when={resizable()} keyed>
          {(id) => (
            <ViewportHandles
              disabled={overlayed().frozen}
              size={fixedViewport() ?? dimensions()}
              ratio={windowZoom() / (fit()?.scale ?? 1)}
              centered={{ width: size().width <= available().width, height: size().height <= available().height }}
              resize={({ width, height }) => {
                const tab = state()

                if (!tab || embed() !== id) return
                void props.model
                  .setViewport(props.session, tab.id, { mode: "fixed", width, height, scale: fixedViewport()?.scale })
                  .catch(() => {
                    if (embed() === id && !page()?.viewportNotice) showToast({ title: plugin.t("viewport.error") })
                  })
              }}
            />
          )}
        </Show>
      </div>
    </div>
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
        <div class="flex shrink-0 items-center gap-1">
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
                  icon={<Icon name={direction === "back" ? "arrow-left" : "arrow-right"} />}
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
              onClick={(event) => {
                const tab = state()

                if (!tab) return
                command(tab.loading ? { type: "stop", tabID: tab.id } : { type: "reload", tabID: tab.id, ignoreCache: event.shiftKey })
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
            {/* Editing shows the icon of what Enter would open: the page's own, or the chosen row's. */}
            <Show
              when={site()}
              fallback={<RowIcon search={addressBar().chosen?.type === "search"} icon={fieldIcon()} />}
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
                  clearCache={() => {
                    const tab = state()

                    return tab ? props.model.clearCache(props.session, tab.id, address()) : undefined
                  }}
                />
              </Show>
            </Show>
            <div data-slot="browser-address-text">
              <input
                ref={input}
                data-slot="browser-address-input"
                role="combobox"
                aria-autocomplete="both"
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
                    // Only text typed at the end completes an address: not a deletion, a paste or a drop, and not
                    // text an IME is still composing, which a changed value would break.
                    completing:
                      (event.inputType === "insertText" || event.inputType === "insertCompositionText") &&
                      !event.isComposing &&
                      event.currentTarget.selectionStart === event.currentTarget.value.length,
                    visits: props.model.visits(),
                  })
                }
                onKeyDown={(event) => {
                  // Keys during IME composition pick and cancel candidates, not rows. Safari can report the
                  // composition-confirming keydown with isComposing false but keyCode 229.
                  if (event.isComposing || event.keyCode === 229) return
                  const modified = event.ctrlKey || event.altKey || event.metaKey

                  // Shift with an arrow selects text, and a modified Tab is a shortcut of the app's.
                  if (((event.key === "ArrowDown" || event.key === "ArrowUp") && !event.shiftKey && !modified) || event.key === "Escape")
                    dispatchAddress({ type: "key.pressed", key: event.key, epoch: epoch(), visits: props.model.visits() }, event)

                  if (event.key === "Tab" && !modified)
                    dispatchAddress({ type: "key.pressed", key: event.shiftKey ? "Shift+Tab" : "Tab", epoch: epoch(), visits: props.model.visits() }, event)

                  // Shift+Delete forgets the chosen row's page, as in other browsers; on any other row it is the field's.
                  if (event.key === "Delete" && event.shiftKey) dispatchAddress({ type: "forget.pressed", visits: props.model.visits() }, event)
                }}
                onKeyUp={caretMoved}
                onPointerUp={caretMoved}
              />
              {/* At rest, draw the whole URL over the input's hidden text with its host emphasized. While editing, the
                  input shows its own text so selection and the caret need no mirror. */}
              <Show when={!addressBar().editing && addressBar().field}>
                <div aria-hidden="true" data-slot="browser-address-display">
                  <span data-slot="browser-address-url" data-host={parts().host ? "" : undefined} data-web={webParts() ? "" : undefined} dir="ltr">
                    <span data-slot="browser-address-authority"><span data-slot="browser-address-muted">{parts().scheme}</span>
                    <span data-slot="browser-address-host" title={parts().host}><bdi dir="ltr">{parts().host}</bdi></span></span>
                    <span data-slot="browser-address-rest">{parts().rest}</span>
                  </span>
                </div>
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
          </form>
          <Popover.Portal>
            <Popover.Content
              data-component="browser-suggestions"
              data-browser-popup
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}
            >
              <div id="browser-suggestions" role="listbox" aria-label={plugin.t("address.suggestions")}>
                <For each={rows()}>
                  {(row, index) => (
                    <PageRow
                      search={row.type === "search"}
                      icon={row.type === "page" ? row.page.icon : undefined}
                      title={rowTitle(row)}
                      detail={rowDetail(row)}
                      // Only a page draws the typed words: the other rows are the typed text itself.
                      query={row.type === "page" ? query() : undefined}
                      option={{ id: `browser-suggestion-${index()}`, selected: index() === addressBar().active }}
                      onClick={() => go(row.url)}
                    />
                  )}
                </For>
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
        <div class="flex shrink-0 items-center gap-1">
          {/* Extensions load into the profile, where pages of a server on this computer browse. */}
          {/* Keyed by the tab: when an agent's show request changes the tab on screen, an open menu closes rather than
              act on the other tab. */}
          <Show when={props.session.server.local && extensions().length > 0 && props.tab().id} keyed>
            <Menu gutter={4} modal={false} placement="bottom-end">
              <Tooltip placement="top" value={plugin.t("extensions.menu")}>
                <Menu.Trigger
                  as={IconButton}
                  ref={(element: HTMLElement) => {
                    extensionsButton.element = element
                  }}
                  variant="ghost-muted"
                  size="large"
                  data-action="browser-extensions"
                  // A browser extension's own mark, not the one for OpenCode's extensions.
                  icon={<Icon name="puzzle" />}
                  aria-label={plugin.t("extensions.menu")}
                />
              </Tooltip>
              <Menu.Portal>
                <Menu.Content class="w-[220px]" data-browser-popup>
                  <Index each={extensions()}>
                    {(extension) => (
                      <Menu.Item
                        disabled={
                          !extension().enabled ||
                          extension().action?.enabled === false ||
                          !(extension().action ?? extension().popup ?? extension().options)
                        }
                        onSelect={() => chooseExtension(extension())}
                      >
                        <Glyph image={extension().action?.icon ?? extension().icon} fallback="puzzle" class="!size-4" />
                        <span class="min-w-0 flex-1 truncate">{extension().action?.title ?? extension().name}</span>
                        <Show when={extension().action?.badge}>
                          {(badge) => (
                            <span
                              class="shrink-0 rounded-[3px] px-1 text-[10px] font-[530] leading-[14px]"
                              classList={{ "text-v2-text-text-muted": !extension().action?.badgeColor }}
                              style={{
                                "background-color": extension().action?.badgeColor,
                                color: extension().action?.badgeColor ? (extension().action?.badgeTextColor ?? "#ffffff") : undefined,
                              }}
                            >
                              {badge()}
                            </span>
                          )}
                        </Show>
                      </Menu.Item>
                    )}
                  </Index>
                  <Menu.Separator />
                  <Menu.Item onSelect={() => plugin.layout.settings("browser")}>
                    {plugin.t("extensions.manage")}
                  </Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </Show>
          <Show when={viewportToolbarAvailable(plugin.app.channel)}>
            <Tooltip
              placement="top"
              value={tip(plugin.t("command.toggleToolbar"), keybinds.keybind("browser.toggleToolbar"))}
            >
              <IconButton
                ref={toolbarToggle}
                variant="ghost-muted"
                size="large"
                classList={{ "!outline-none": pointerFocusedToggle() }}
                onPointerDown={() => setPointerFocusedToggle(true)}
                onBlur={() => setPointerFocusedToggle(false)}
                onKeyDown={() => setPointerFocusedToggle(false)}
                aria-label={plugin.t("command.toggleToolbar")}
                aria-expanded={toolbarVisible()}
                aria-controls={toolbarVisible() ? viewportID : undefined}
                disabled={!inspectable()}
                state={toolbarVisible() ? "pressed" : undefined}
                onClick={toggleToolbar}
                icon={
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M1 12.5H8M13.5 4V2.5H3.49997V12M14.5 5.5H9.5C9.5 8.0362 9.5 10.9638 9.5 13.5H14.5C14.5 10.9638 14.5 8.0362 14.5 5.5Z"
                      stroke="currentColor"
                    />
                  </svg>
                }
              />
            </Tooltip>
          </Show>
          {/* Keyed by the tab, as the extensions menu is: an open menu is of the tab it opened on, and closes with it. */}
          <Show when={props.tab().id} keyed>
            <Menu gutter={4} modal={false} placement="bottom-end" onOpenChange={open => setMenuPage(open ? pageTarget() : undefined)}>
              <Tooltip placement="top" value={plugin.t("options")}>
                {/* The comment tool lives in this menu, so the button shows it while it waits for a pick. */}
                <Menu.Trigger
                  as={IconButton}
                  variant="ghost-muted"
                  size="large"
                  disabled={!state()}
                  classList={{ "!text-v2-icon-icon-accent": overlayed().accent }}
                  icon={<Icon name="outline-dots" />}
                  aria-label={plugin.t("options")}
                />
              </Tooltip>
              <Menu.Portal>
                <Menu.Content class="w-[220px]" data-browser-popup>
                  {/* What most people reach for comes first; the rest is one step away under "More tools". */}
                  <Menu.Item
                    disabled={!inspectable()}
                    onSelect={() => find({ type: "open" })}
                    shortcut={<Keybind keys={[...keybinds.keybind("browser.find")]} variant="neutral" />}
                  >
                    {plugin.t("find.open")}
                  </Menu.Item>
                  {/* One row: out, the zoom itself (which resets it), in. Zooming closes the menu: the page stays a
                      still while the menu covers it, so a zoom would show only once it closed. */}
                  <Menu.ItemRow label={plugin.t("zoom.label")}>
                    <Menu.Item disabled={!address()} aria-label={plugin.t("zoom.out")} onSelect={() => zoomPage("out")}>
                      <Icon name="minus" size="small" />
                    </Menu.Item>
                    <Menu.Item disabled={!zoomed()} aria-label={plugin.t("zoom.reset")} onSelect={() => zoomPage("reset")}>
                      {plugin.t("zoom.percent", { percent: Math.round((page()?.zoom ?? 1) * 100) })}
                    </Menu.Item>
                    <Menu.Item disabled={!address()} aria-label={plugin.t("zoom.in")} onSelect={() => zoomPage("in")}>
                      <Icon name="plus" size="small" />
                    </Menu.Item>
                  </Menu.ItemRow>
                  {/* A disabled item takes no pointer events, so a tooltip never shows: its reason is a line below it. */}
                  <Menu.Group>
                    <Menu.Item disabled={!address() || serverFile()} onSelect={copyLink}>
                      {plugin.t("link.copy")}
                    </Menu.Item>
                    <Show when={menuPage()?.serverFile}>
                      <Menu.GroupLabel class="!h-auto !pb-1.5 !pt-0">
                        <span dir="auto" class="break-words leading-4">{plugin.t("menu.privateAddress")}</span>
                      </Menu.GroupLabel>
                    </Show>
                  </Menu.Group>
                  <Menu.Item disabled={!address() || suspended() || failed()} onSelect={openNote}>
                    {plugin.t("page.add")}
                  </Menu.Item>
                  <Show when={menuPage()?.source}>
                    {(open) => <Menu.Item onSelect={() => open()()}>{plugin.t("preview.source")}</Menu.Item>}
                  </Show>
                  <Menu.Separator />
                  <Menu.Sub gutter={4} overflowPadding={16} overlap>
                    <Menu.SubTrigger>{plugin.t("menu.more")}</Menu.SubTrigger>
                    <Menu.Portal>
                      <Menu.SubContent class="w-max min-w-[220px] max-w-[calc(100vw-32px)]" aria-label={plugin.t("menu.more")} data-browser-popup>
                        <Menu.Item
                          disabled={!inspectable()}
                          onSelect={toggleInspect}
                          shortcut={<Keybind keys={[...keybinds.keybind("browser.inspect")]} variant="neutral" />}
                        >
                          {plugin.t("inspect")}
                        </Menu.Item>
                        <Menu.Group>
                          <Menu.Item disabled={!menuPage()?.open} onSelect={() => menuPage()?.openPage()}>
                            {plugin.t("menu.openPage")}
                          </Menu.Item>
                          <Show when={!menuPage()?.open}>
                            <Menu.GroupLabel class="!h-auto !pb-1.5 !pt-0">
                              <span dir="auto" class="break-words leading-4">{plugin.t("menu.pageUnavailable")}</span>
                            </Menu.GroupLabel>
                          </Show>
                        </Menu.Group>
                        <Show when={menuPage()?.reveal}>
                          <Menu.Item onSelect={() => menuPage()?.revealFile()}>{plugin.t("external.reveal")}</Menu.Item>
                        </Show>
                        <Menu.Item
                          disabled={!address()}
                          onSelect={() => {
                            const tab = state()

                            if (tab) command({ type: "reload", tabID: tab.id, ignoreCache: true })
                          }}
                          shortcut={<Keybind keys={[...keybinds.keybind("browser.hardReload")]} variant="neutral" />}
                        >
                          {plugin.t("menu.hardReload")}
                        </Menu.Item>
                        <Menu.Item
                          disabled={!props.model.historyClearable()}
                          // The list empties at once; a history main could not clear is said, and the item stays to try again.
                          onSelect={() =>
                            void props.model.clearHistory().then((cleared) => {
                              if (!cleared) plugin.toast.show({ variant: "error", title: plugin.t("history.clear.failed") })
                            })
                          }
                        >
                          {plugin.t("history.clear")}
                        </Menu.Item>
                      </Menu.SubContent>
                    </Menu.Portal>
                  </Menu.Sub>
                  <Menu.Separator />
                  <Menu.Item onSelect={() => plugin.layout.settings("browser")}>{plugin.t("settings.open")}</Menu.Item>
                </Menu.Content>
              </Menu.Portal>
            </Menu>
          </Show>
        </div>
      </div>
      {/*
        The bars above the page, always in this order: the sign-in offer, the site's permission request, the tab's
        notice, a command that did not work, then find. A page that did not load is never a bar: the page area says so. A dialog that blocks the page sits over the page area alone, never over a bar; find, which
        would search the page behind it, closes while it shows.
      */}
      {/* Above a page, where a signed-out site is the reason to import; the new tab page shows the offer as a card. */}
      <Show when={offering() && !empty() && !suspended()}>
        <SignInOffer variant="bar" imported={imported} closed={() => setConfirming(false)} />
      </Show>
      <Show when={promptKey(false)} keyed>
        {(key) => (
          <Show when={key ? prompt() : undefined}>
            {(view) => <PromptBar view={view()} answer={answer()} focus={untrack(promptFocus)} held={guarded()} />}
          </Show>
        )}
      </Show>
      <Show when={state()?.id} keyed>
        {(id) => (
          <>
            <Show when={props.model.notice(props.session, id)}>
              {(notice) => (
                <RefusalBar
                  notice={notice()}
                  held={guarded()}
                  answer={async (dismiss, copy) => {
                    const passkey = notice().passkey

                    if (dismiss || !passkey) return props.model.answerNotice(props.session, id, dismiss, copy)

                    if (passkey.newTab !== undefined) {
                      props.model.openURL(props.session, passkey.newTab)

                      return props.model.answerNotice(props.session, id, true)
                    }

                    importSignIn(id, passkey)
                  }}
                />
              )}
            </Show>
            <Show when={barFailure()}>
              {(current) => (
                <FailureBar
                  text={current().text}
                  retry={current().retry}
                  dismiss={() => props.model.dismissFailure(props.session, current().id)}
                />
              )}
            </Show>
            <Show when={!suspended() && !promptKey(true) && props.model.search(props.session, id)}>
              {(view) => <FindBar view={view()} input={(el) => { findInput = el }} run={(action) => find(action, id)} />}
            </Show>
          </>
        )}
      </Show>
      <Show when={toolbarVisible()}>
        <section id={viewportID} data-component="browser-viewport" aria-label={plugin.t("viewport.label")}>
          <Show when={state()?.id} keyed>
            {(tabID) => (
              <Show when={props.session.key} keyed>
                <ViewportControls
                  viewport={page()?.viewport}
                  autoWidth={dimensions().width}
                  autoHeight={dimensions().height}
                  effectiveScale={fit()?.scale ?? 1}
                  zoomed={zoomed()}
                  apply={(viewport) => props.model.setViewport(props.session, tabID, viewport)}
                />
              </Show>
            )}
          </Show>
          <Show when={viewportMessage()}>
            <div data-slot="browser-viewport-message" role="status">
              {viewportMessage()}
              <Show when={zoomed()}>
                <Button size="small" variant="ghost" onClick={() => zoomPage("reset")}>
                  {plugin.t("zoom.reset")}
                </Button>
              </Show>
              <Show when={notice()}>
                <Button
                  size="small"
                  variant="ghost-muted"
                  onClick={() => dispatchToolbar({ type: "notice.dismissed", context: toolbarContext() })}
                >
                  {plugin.t("common.dismiss")}
                </Button>
              </Show>
            </div>
          </Show>
        </section>
      </Show>
      <Preview>
        <embeds.View
          id={embed()}
          // A page blocked in a JavaScript dialog draws no frame, so Chromium cannot capture a still of it: its dialog
          // sits over the dimmed, empty page area at once. "Leave site?" and a sign-in leave the page drawing.
          visible={embedVisible()}
          frozen={overlayed().frozen || !!promptKey(true)}
          // A navigation, in-page or not, a reload starting or a layout viewport change is another page.
          page={JSON.stringify([
            state()?.id,
            state()?.generation,
            state()?.url,
            !!state()?.loading,
            fixedViewport()?.width,
            fixedViewport()?.height,
            fixedViewport()?.scale,
          ])}
          radius={fixedViewport() ? 0 : 10}
          class="relative min-h-0 min-w-0 overflow-hidden bg-v2-background-bg-base flex items-center justify-center"
        >
          <Show when={promptKey(true)} keyed>
            {(key) => (
              <Show when={key ? prompt() : undefined}>
                {(view) => (
                  <PromptDialog view={view()} answer={answer()} focus={untrack(promptFocus)} leave={focusAddress} held={guarded()} />
                )}
              </Show>
            )}
          </Show>
          <Show when={empty() && !failed() && !suspended() && !pageFailure()}>
            <div dir="auto" data-scrollable class="size-full overflow-y-auto">
              <Show when={offering()}>
                <SignInOffer variant="card" imported={imported} closed={() => setConfirming(false)} />
              </Show>
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
                    <For each={recent()}>
                      {(visit) => <PageRow icon={visit.icon} title={visit.title} detail={bare(visit.url)} onClick={() => go(visit.url)} />}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={suspended() ? undefined : loadFailed()}>
            {(view) => (
              <FailurePage
                title={plugin.t(view().title)}
                description={plugin.t(view().description)}
                warning={view().kind === "insecure"}
                actions={failureActions()}
                code={view().code}
              />
            )}
          </Show>
          <Show when={failed() ? undefined : pageFailure()}>
            {(current) => (
              <FailurePage
                title={current().text}
                description={plugin.t("failed.command.description")}
                actions={[
                  ...(current().retry ? [{ label: plugin.t("common.retry"), run: () => current().retry?.() }] : []),
                  { label: plugin.t("common.close"), run: () => props.model.dismissFailure(props.session, current().id) },
                ]}
              />
            )}
          </Show>
          <Show when={suspended()}>
            <p class="px-6 text-center text-13-regular text-v2-text-text-subtle" role="status">
              {plugin.t(offline() ? "preview.offline" : "suspended")}
            </p>
          </Show>
          <Show when={spotlight()}>
            {(rect) => (
              <div ref={trackPage} class="pointer-events-none absolute inset-0 overflow-hidden">
                <div
                  data-slot="browser-comment-spotlight"
                  class="absolute rounded-[2px]"
                  style={{
                    left: `${rect().x}px`,
                    top: `${rect().y}px`,
                    width: `${rect().width}px`,
                    height: `${rect().height}px`,
                  }}
                />
              </div>
            )}
          </Show>
        </embeds.View>
        <Show when={comment()}>
          {(current) => (
            <div
              ref={backdrop}
              data-component="browser-comment"
              class="absolute start-0 top-0 z-10"
              style={{ width: `${available().width}px`, height: `${available().height}px` }}
              onPointerDown={(event) => {
                // A click beside the editor dismisses it unless it would discard a draft.
                if (event.target === event.currentTarget) dispatchOverlay({ type: "backdrop.pressed" })
              }}
            >
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
                        alternateSubmit={sendOverlay()}
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
              class="absolute start-0 top-0 z-10"
              style={{ width: `${available().width}px`, height: `${available().height}px` }}
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
                  width: "min(400px, calc(100% - 16px))",
                  "max-height": "calc(100% - 16px)",
                }}
              >
                <MenuScroll class="min-h-0">
                  <LineCommentEditor
                    value={current().draft}
                    onInput={(value) => dispatchOverlay({ type: "draft.changed", value })}
                    onCancel={closeOverlay}
                    onSubmit={submitOverlay}
                    alternateSubmit={sendOverlay()}
                    placeholder={plugin.t("page.placeholder")}
                    mention={{
                      items: (query) => props.screen.file.search(query, { kind: "any" }),
                    }}
                    selection={
                      <span class="flex min-w-0 items-center gap-1" dir="ltr">
                        <Icon name="globe" class="shrink-0" />
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
      </Preview>
      <p class="sr-only" role="status" aria-live="polite">
        {picking() ? plugin.t("inspect.active") : ""}
      </p>
    </aside>
  )
}

/** The title of a row of the address field's list: a page's own, or the text a search row searches for. */
function rowTitle(row: AddressRow) {
  if (row.type === "page") return row.page.title

  return row.type === "search" ? row.text : ""
}

/** The icon of a row of the address field's list, and of the field while that row is chosen: the search glyph, or a page's own. */
function RowIcon(props: { search: boolean; icon: string | undefined }) {
  return (
    <Show when={props.search} fallback={<PageIcon icon={props.icon} class="text-v2-icon-icon-muted" />}>
      <Icon name="magnifying-glass" class="pointer-events-none size-4 shrink-0 text-v2-icon-icon-muted" />
    </Show>
  )
}

/**
 * A row of the address field's list or of the new tab page: an icon, a title and, after it, a page's address or what
 * a search row searches with. A page draws the query's matches.
 */
function PageRow(props: {
  search?: boolean
  icon: string | undefined
  title: string
  detail: string
  query?: Query
  /** Set for a row of the address field's list: an option, which keeps keyboard focus in the field. */
  option?: { id: string; selected: boolean }
  onClick: () => void
}) {
  const body = () => (
    <>
      <RowIcon search={!!props.search} icon={props.icon} />
      <span data-slot="browser-page-row-text">
        <Show when={props.title}>
          <span data-slot="browser-page-row-title">
            <Marked text={props.title} query={props.query} />
          </span>
          <span>-</span>
        </Show>
        <span data-slot="browser-page-row-url">
          <Marked text={props.detail} query={props.query} />
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

function Marked(props: { text: string; query: Query | undefined }) {
  return (
    <For each={markMatches(props.text, props.query)}>
      {(part) => (
        <Show when={part.match} fallback={part.text}>
          <mark>{part.text}</mark>
        </Show>
      )}
    </For>
  )
}

const connections = {
  secure: { icon: "lock", title: "site.secure", description: "site.secure.description" },
  insecure: { icon: "outline-hexagonal-warning", title: "site.insecure", description: "site.insecure.description" },
  local: { icon: "monitor", title: "site.local", description: "site.local.description" },
  file: { icon: "folder", title: "site.file", description: "site.file.description" },
  workspace: { icon: "folder", title: "preview.workspace", description: "site.file.description" },
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
  clearCache: () => Promise<void> | undefined
}) {
  const plugin = usePlugin()
  const [siteState, setSiteState] = createSignal(initialSiteState)
  // Whether a pointer opened the popover, so closing it returns focus without a focus ring.
  const [pointer, setPointer] = createSignal(false)
  const view = createMemo(() => siteView(siteState()))
  // The second view, "Site settings"; the popover opens on the first.
  const [detailed, setDetailed] = createSignal(false)
  // The control that leads to the other view, which takes the keyboard when the view changes.
  const views: SiteViews = {}
  let timer: ReturnType<typeof setTimeout> | undefined
  let trigger: HTMLButtonElement | undefined

  const showDetails = (shown: boolean) => {
    setDetailed(shown)
    queueMicrotask(() => (shown ? views.back : views.open)?.focus({ preventScroll: true }))
  }

  const dispatch = (event: SiteEvent) => {
    const next = transitionSite(siteState(), event)
    setSiteState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: SiteEffect) => {
    if (effect.type === "notify-clear-failed") return showToast({ title: plugin.t("site.clearFailed") })
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

    const pending = effect.type === "clear-cache" ? props.clearCache() : props.clear()

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

    return !!value && value !== "file" && value !== "workspace"
  }

  const cookieDetail = () => {
    const current = view()

    if (current.failed) return plugin.t("site.cookies.failed")

    return current.cookies === undefined ? undefined : plugin.plural("site.cookies.count", current.cookies)
  }

  return (
    <Popover
      open={view().open}
      placement="bottom-start"
      gutter={8}
      shift={-10}
      modal={false}
      onOpenChange={(open) => {
        if (!open) setDetailed(false)
        dispatch({ type: "open.changed", open })
      }}
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
          icon={<Icon name="sliders" />}
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Content
          data-component="browser-site"
          // Escape leaves "Site settings" for the first view before it closes the popover.
          onEscapeKeyDown={(event: KeyboardEvent) => {
            if (!detailed()) return
            event.preventDefault()
            showDetails(false)
          }}
          data-browser-popup
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
          {/* Two views in one popover: what a person wants to know first, then everything else one step away. */}
          <Show
            when={detailed()}
            fallback={
              <>
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
                  {(value) => <SiteRow icon={value().icon} title={plugin.t(value().title)} detail={plugin.t(value().description)} />}
                </Show>
                <button
                  ref={views.open}
                  type="button"
                  data-slot="browser-site-row"
                  data-action="browser-site-settings"
                  onClick={() => showDetails(true)}
                >
                  <span data-slot="browser-site-icon">
                    <Icon name="outline-sliders" />
                  </span>
                  <span class="min-w-0 flex-1 text-start">{plugin.t("site.settings")}</span>
                  <span data-slot="browser-site-icon" class="rtl:-scale-x-100">
                    <Icon name="outline-chevron-right" />
                  </span>
                </button>
              </>
            }
          >
            <div data-slot="browser-site-row">
              {/* The back control stands in the icon column and the heading in the text column, as in every row. */}
              <span data-slot="browser-site-icon">
                <IconButton
                  ref={views.back}
                  type="button"
                  variant="ghost-muted"
                  size="small"
                  class="rtl:-scale-x-100"
                  aria-label={plugin.t("site.back")}
                  onClick={() => showDetails(false)}
                  icon={<Icon name="outline-arrow-left" />}
                />
              </span>
              <span class="flex min-w-0 flex-1 items-baseline gap-2">
                <Popover.Title class="m-0 shrink-0" style={{ font: "inherit" }}>{plugin.t("site.settings")}</Popover.Title>
                <span data-slot="browser-site-detail" dir="ltr" class="min-w-0 flex-1 truncate text-end">
                  {addressParts(props.url).host}
                </span>
              </span>
            </div>
            <div data-slot="browser-site-separator" aria-hidden="true" />
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
              {/* What it does not do stands under it, so nobody fears losing a sign-in. */}
              <SiteRow icon="file-document" title={plugin.t("site.cache")} detail={plugin.t("site.clearCache.description")}>
                <Button
                  size="small"
                  variant="neutral"
                  aria-label={plugin.t("site.clearCache")}
                  disabled={view().actionDisabled || view().failed}
                  onClick={() => dispatch({ type: "clear-cache.clicked" })}
                >
                  {plugin.t("site.cookies.clear")}
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
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
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
