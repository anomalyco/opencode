import { Popover } from "@kobalte/core/popover"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Keybind } from "@opencode/ui/keybind"
import { Loader } from "@opencode/ui/loader"
import { Tooltip } from "@opencode/ui/tooltip"
import { createMemo, createSignal, createUniqueId, For, onCleanup, Show, untrack, type Accessor, type JSX } from "solid-js"
import type { Browser } from "@opencode/plugin-browser/rpc"
import { createKeyed, usePlugin } from "@opencode/plugin/gui"
import { addressParts } from "./address"
import {
  addressRows,
  addressView,
  initialAddressState,
  nextAddressEpoch,
  transitionAddress,
  type AddressEpoch,
  type AddressEvent,
  type AddressPage,
  type AddressRow,
} from "./address-machine"
import { hostDisplay } from "./host-display"
import type { HistoryPage } from "./history/ipc"
import { markMatches, parseQuery, type Query } from "./history/match"
import { bare } from "./history/page"
import type definition from "./index"
import type { Model } from "./model"
import { PageIcon } from "./page-icon"

/** What the owner of an address field can ask of it. */
export type AddressControls = {
  /** Focuses the field and selects its text, as ⌘L does. */
  focus(): void
  /** Opens `url` as a row of the list does, and keeps it in the field until the page reports where it went. */
  go(url: string): void
  /** A submitted address the page has not reported yet. */
  navigating(): boolean
}

/**
 * The browser bar's address field with its list of suggestions: the browser pane's, for the tab on screen, and the side
 * panel's New tab page's, which has no tab and opens what the person enters in a new one.
 */
export function AddressField(props: {
  model: Model
  /** The page the field shows; on the New tab page, a blank page without a tab. */
  page: Accessor<AddressPage>
  /** The page's own icon, which a focused field shows before the person types. */
  icon: Accessor<string | undefined>
  /** The page failed to load, where an empty address opens a blank page. */
  failed: Accessor<boolean>
  disabled: Accessor<boolean>
  /** Opens what the person entered or chose: in the page's tab, or without one in a new tab. */
  navigate(url: string, tabID: Browser.TabID | undefined): void
  /** Drawn before the address at rest, in place of the page's icon, such as the site information. */
  site?: () => JSX.Element
  /** The page has nothing for `site` to show. */
  siteless?: Accessor<boolean>
  /** After the address, such as the zoom reset. */
  end?: JSX.Element
  controls?: (controls: AddressControls) => void
}) {
  const plugin = usePlugin<typeof definition>()
  const list = createUniqueId()
  const [addressState, setAddressState] = createSignal(initialAddressState)

  // The page's reports, counted; a submitted address in the field ends at the next one.
  const epoch = createMemo((previous: AddressEpoch | undefined) => nextAddressEpoch(previous, props.page()))

  // The list follows what the user typed; a focused address is not a query.
  const rows = createMemo(() => addressRows(addressState(), props.model.visits()))
  const addressBar = createMemo(() => addressView(addressState(), epoch(), rows()))
  // The typed words, whose matches each page of the list draws.
  const query = createMemo(() => parseQuery(addressBar().query))

  // Ends the questions to main's history that are still out when the field goes.
  const asking = new AbortController()
  onCleanup(() => asking.abort())

  let input: HTMLInputElement | undefined
  let anchor: HTMLFormElement | undefined

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

      props.navigate(effect.url, effect.tabID)
    })
  }

  // A field focused while its tab was still blank shows the page's address once the page has one.
  createKeyed(
    () => epoch().followed,
    () => dispatchAddress({ type: "page.followed", epoch: untrack(epoch) }),
  )

  // Editing shows the icon of what Enter would open: the chosen page's once the person typed, else the page's own.
  const fieldIcon = () => {
    const bar = addressBar()

    if (!bar.editing || !bar.field) return undefined

    if (!bar.typed) return props.icon()

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

  // The address field always shows the whole URL; at rest it draws the host emphasized.
  const webParts = createMemo(() => hostDisplay(addressBar().field))
  const parts = () => webParts() ?? addressParts(addressBar().field)
  const site = () => !!props.site && !!addressBar().field && !addressBar().editing && !props.siteless?.()

  // Navigates and keeps the address in the field until the page reports where it went. Ends editing here rather than
  // on blur: a click elsewhere, such as a recent page, may have blurred the field already.
  const go = (url: string) => dispatchAddress({ type: "navigated", url, epoch: epoch() })

  props.controls?.({
    focus() {
      input?.focus()
      input?.select()
    },
    go,
    navigating: () => addressBar().navigating,
  })

  return (
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
          dispatchAddress({ type: "submitted", epoch: epoch(), visits: props.model.visits(), failed: props.failed() })
        }}
      >
        {/* Editing shows the icon of what Enter would open: the page's own, or the chosen row's. */}
        <Show
          when={site()}
          fallback={<RowIcon search={addressBar().chosen?.type === "search"} icon={fieldIcon()} />}
        >
          {props.site?.()}
        </Show>
        <div data-slot="browser-address-text">
          <input
            ref={input}
            data-slot="browser-address-input"
            role="combobox"
            aria-autocomplete="both"
            aria-expanded={addressBar().listed}
            aria-controls={addressBar().listed ? list : undefined}
            aria-activedescendant={addressBar().chosen ? `${list}-${addressBar().active}` : undefined}
            spellcheck={false}
            autocomplete="off"
            value={addressBar().field}
            disabled={props.disabled()}
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
        {props.end}
      </form>
      <Popover.Portal>
        <Popover.Content
          data-component="browser-suggestions"
          data-browser-popup
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div id={list} role="listbox" aria-label={plugin.t("address.suggestions")}>
            <For each={rows()}>
              {(row, index) => (
                <PageRow
                  search={row.type === "search"}
                  icon={row.type === "page" ? row.page.icon : undefined}
                  title={rowTitle(row)}
                  detail={rowDetail(row)}
                  // Only a page draws the typed words: the other rows are the typed text itself.
                  query={row.type === "page" ? query() : undefined}
                  option={{ id: `${list}-${index()}`, selected: index() === addressBar().active }}
                  onClick={() => go(row.url)}
                />
              )}
            </For>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  )
}

/** The browser bar's back, forward and reload, which stops a page that is loading. */
export function BrowserNavigation(props: {
  back: boolean
  forward: boolean
  loading: boolean
  /** The page has an address to load again. */
  reloadable: boolean
  go(direction: "back" | "forward"): void
  /** Reloads, or stops a page that is loading; Shift reloads without the cache. */
  reload(ignoreCache: boolean): void
}) {
  const plugin = usePlugin<typeof definition>()
  const reloadKeys = () => plugin.keybinds.keybind("browser.reload")

  return (
    <div class="flex shrink-0 items-center gap-1">
      <For each={["back", "forward"] as const}>
        {(direction) => (
          <Tooltip placement="top" value={plugin.t(direction === "back" ? "common.goBack" : "common.goForward")}>
            <IconButton
              variant="ghost-muted"
              size="large"
              disabled={!props[direction]}
              aria-label={plugin.t(direction === "back" ? "common.goBack" : "common.goForward")}
              onClick={() => props.go(direction)}
              icon={<Icon name={direction === "back" ? "chevron-left" : "chevron-right"} />}
            />
          </Tooltip>
        )}
      </For>
      <Tooltip
        placement="top"
        value={
          props.loading ? (
            plugin.t("action.stop")
          ) : (
            <div class="flex items-center gap-2">
              <span>{plugin.t("action.reload")}</span>
              <Show when={reloadKeys().length > 0}>
                <Keybind keys={[...reloadKeys()]} variant="neutral" />
              </Show>
            </div>
          )
        }
      >
        <IconButton
          variant="ghost-muted"
          size="large"
          disabled={!props.loading && !props.reloadable}
          aria-label={plugin.t(props.loading ? "action.stop" : "action.reload")}
          onClick={(event) => props.reload(event.shiftKey)}
          icon={
            <Show when={props.loading} fallback={<Icon name="outline-rotate-clockwise" />}>
              <Loader />
            </Show>
          }
        />
      </Tooltip>
    </div>
  )
}

/**
 * A row of the address field's list or of a list of recent pages: an icon, a title and, after it, a page's address or
 * what a search row searches with. A page draws the query's matches.
 */
export function PageRow(props: {
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
