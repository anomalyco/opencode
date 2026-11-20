import { Button } from "@opencode/ui/button"
import { Checkbox } from "@opencode/ui/checkbox"
import { Icon } from "@opencode/ui/icon"
import { MenuScroll } from "@opencode/ui/menu-scroll"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { createVirtualizer, defaultRangeExtractor } from "@tanstack/solid-virtual"
import { createMemo, createSignal, createUniqueId, For, onCleanup, onMount, Show, untrack } from "solid-js"
import { createStore } from "solid-js/store"
import { createKeyed, createLatest, usePlugin } from "@opencode/plugin/gui"
import { choiceLabel, choiceValue, profileChoices, type Choice } from "./choices"
import type definition from "./index"
import { createProfileJobs, type ProfileJobs } from "./jobs"
import { importedCookies, importLoss, type Job } from "./jobs-machine"
import type { SiteList } from "./profile/ipc"
import { siteListMove, siteTypeAhead } from "./site-keys"
import { exactSite, matchSites } from "./site-search"

/** One row of the site list, in CSS pixels. */
const ROW_HEIGHT = 32

/** Keys typed within this many milliseconds of the last one extend the type-ahead. */
const TYPE_AHEAD_MS = 700

/**
 * The import dialog, "Import from <browser>": what comes over, as two ticked boxes, "Sign-ins" and "Browsing history",
 * and "Import". A quiet "Choose sites" reveals, in place under the boxes, the sites the browser profile has cookies
 * for, one row per registrable domain, every one ticked until the person changes that; the button then names how many
 * sites it brings. Main reads the list from the cookies' hosts alone. Lists stay only while the dialog is open, so
 * switching back to a profile does not read it again; neither the lists nor any choice is stored: an import is a
 * one-off, and each starts from everything.
 *
 * The import runs as a job of `jobs`, the surface that opened the dialog, which reports how it ended in its own place
 * (a Settings row, the pane's offer). A clean import closes the dialog; a partial or failed one keeps it open and says
 * why. `reveal` opens it with the list shown. `site` opens it with the list shown and searched for a page's
 * registrable domain, as a passkey request's, on the first browser profile that lists exactly that site; with
 * `choose`, that site alone is chosen there, and without it nothing is. A site that only contains it, such as
 * `github.com` for `hub.com`, is shown but never chosen. Opened so, the dialog is about one site's sign-in: it
 * shows no boxes and brings sign-ins only.
 */
export function SiteChooser(props: {
  choices: readonly Choice[]
  initial: Choice
  jobs: ProfileJobs
  site?: { name: string; choose: boolean }
  reveal?: boolean
  close: () => void
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui
  const id = createUniqueId()
  // Lists read while the dialog is open, by profile; a failure is not kept, so Try again reads again.
  const lists = new Map<string, SiteList>()
  const elements: ChooserElements = {}

  // The list's viewport mounts when "Choose sites" reveals the list or its loading ends, either of which can come after
  // the sites did. The virtualizer follows it as a signal, or it would never see the list scroll.
  const [viewport, setViewport] = createSignal<HTMLDivElement>()

  // A new element belongs to no window until it is in the page, and the virtualizer needs its window to watch it.
  const followViewport = (element: HTMLDivElement) => {
    onMount(() => setViewport(element))
    onCleanup(() => setViewport(undefined))
  }

  const numbers = createMemo(() => new Intl.NumberFormat(ctx.locale.locale()))
  const number = (value: number) => numbers().format(value)

  const [state, setState] = createStore<ChooserState>({
    profile: choiceValue(props.initial),
    query: props.site?.name ?? "",
    chosen: { profile: choiceValue(props.initial), sites: new Set() },
    active: 0,
    focused: false,
    attempt: 0,
    typed: { text: "", at: 0 },
    seeking: !!props.site,
    revealed: !!props.site || !!props.reveal,
    custom: !!props.site,
    signins: true,
    history: true,
  })

  // The import this dialog started, compared by identity with the jobs' own, which a store would wrap in a proxy.
  const [job, setJob] = createSignal<Job>()
  const [composing, setComposing] = createSignal(false)

  const choice = createMemo(() => props.choices.find((item) => choiceValue(item) === state.profile) ?? props.initial)

  const sites = () => {
    if (!state.custom) return everySite()

    return state.chosen.profile === state.profile ? state.chosen.sites : new Set<string>()
  }

  // The import brings every site: nothing was changed, or everything is ticked again.
  const everything = () => !state.custom || (all().length > 0 && sites().size === all().length)

  const listed = createLatest(
    () => `${state.profile}\n${state.attempt}`,
    async (key, signal) => {
      const current = untrack(choice)
      const known = lists.get(choiceValue(current))
      const result = known ?? (await props.jobs.sites(current.source.id, current.profile.id, signal))

      if (result.type === "listed") lists.set(choiceValue(current), result)

      if (!signal.aborted && untrack(() => state.seeking)) seek(current, result)

      return { key, result }
    },
  )

  // The previous profile's list never shows under another profile while the new one loads.
  const result = () => (listed.latest?.key === `${state.profile}\n${state.attempt}` ? listed.latest.result : undefined)

  const all = createMemo(() => {
    const current = result()

    return current?.type === "listed" ? current.sites : []
  })

  // Every site of the profile, which is what comes over until the person changes the choice.
  const everySite = createMemo(() => new Set(all().map((item) => item.site)))
  const shown = createMemo(() => matchSites(all(), state.query))
  const ready = () => result()?.type === "listed" && all().length > 0
  const browser = () => choice().source.name
  const busy = () => props.jobs.running() !== undefined
  const shownChosen = createMemo(() => shown().filter((item) => sites().has(item.site)).length)

  // Searched for a page's site that this profile has no cookies for: the list says so, and chooses nothing.
  const missing = () => {
    const site = props.site?.name

    if (!site || state.query.trim().toLowerCase() !== site || result()?.type !== "listed" || exactSite(all(), site)) return

    return ctx.t("sites.missing", { site, browser: browser() })
  }

  const status = () => {
    const current = result()

    if (listed.error !== undefined && !listed.loading) return { text: ctx.t("sites.failed"), error: true, retry: true }

    if (!current || state.seeking) return { text: ctx.t("sites.loading", { browser: browser() }), error: false, loading: true }

    if (current.type === "failed" && current.reason === "locked")
      return { text: ctx.t("signins.failed.locked.named", { browser: browser() }), error: true, retry: true }

    if (current.type === "failed") return { text: ctx.t(`signins.failed.${current.reason}`), error: true, retry: true }

    if (current.sites.length === 0) return { text: ctx.t("sites.empty"), error: false }

    if (shown().length === 0) return { text: missing() ?? ctx.t("sites.unmatched"), error: false }
  }

  // The import this dialog started, once it ended; a clean one closes the dialog, and its surface says so.
  const finished = createMemo(() => {
    const last = props.jobs.last()

    return job() && last?.job === job() ? last : undefined
  })

  const clean = () => {
    const outcome = finished()?.outcome

    if (outcome?.type !== "imported" || outcome.result.type !== "imported" || importLoss(outcome.result)) return false

    return outcome.result.imported > 0 || !!outcome.result.pages
  }

  // Closes the dialog host's dialog, outside Solid, once the import it started ended cleanly.
  createKeyed(
    () => (clean() ? finished() : undefined),
    () => props.close(),
  )

  const message = () => {
    if (job() && props.jobs.running() === job()) return props.jobs.notice()

    return props.jobs.unsaved() ?? (finished() && !clean() ? props.jobs.describe(finished()) : undefined)
  }

  // The virtualizer keeps its own offset, which it gives the next list's viewport when one mounts; this one's scroll
  // event may never come, as the list makes way for the next one's loading, so both start over here.
  const toTop = () => {
    setState("active", 0)
    virtualizer.scrollOffset = 0

    const list = viewport()

    if (list) list.scrollTop = 0
  }

  const search = (query: string) => {
    setState("query", query)
    toTop()
  }

  const switchProfile = (profile: string) => {
    setState({ profile, seeking: false, custom: false })
    toTop()
  }

  // Opened for a site, the dialog moves on to the next browser profile until one lists exactly that site, and back to
  // the first if none does.
  const seek = (current: Choice, list: SiteList) => {
    const site = props.site

    // The site the page belongs to is chosen already where the person asked, so importing it is one click.
    if (site && list.type === "listed" && exactSite(list.sites, site.name))
      return setState({ seeking: false, custom: true, chosen: { profile: choiceValue(current), sites: new Set(site.choose ? [site.name] : []) } })
    const index = props.choices.findIndex((item) => choiceValue(item) === choiceValue(current))
    const next = props.choices[index + 1]

    setState(next ? { profile: choiceValue(next) } : { profile: choiceValue(props.initial), seeking: false })
  }

  const choose = (change: (next: Set<string>) => void) => {
    const next = new Set(sites())
    change(next)
    setState({ custom: true, chosen: { profile: state.profile, sites: next } })
  }

  const toggle = (site: string) => choose((next) => (next.has(site) ? next.delete(site) : next.add(site)))
  // Both act on the sites the search shows, which is every site without a search.
  const selectShown = () => choose((next) => shown().forEach((item) => next.add(item.site)))
  const clearShown = () => choose((next) => shown().forEach((item) => next.delete(item.site)))

  // Importing everything needs no list: it works while the list is still being read, as the one-click import does.
  const canImport = () =>
    (!!props.site || state.signins || state.history) &&
    (state.custom ? sites().size > 0 : result()?.type !== "listed" || all().length > 0) &&
    props.jobs.available() &&
    !busy() &&
    props.jobs.unsaved() === undefined

  const start = () => {
    if (!canImport()) return
    const current = choice()

    const next: Job = {
      type: "import-browser",
      source: current.source.id,
      profile: current.profile.id,
      sites: everything() ? undefined : all().flatMap((item) => (sites().has(item.site) ? [item.site] : [])),
      // Opened for a page's site, the import is that site's sign-in and no history.
      signins: !!props.site || state.signins,
      history: !props.site && state.history,
    }

    setJob(next)
    props.jobs.start(next)
  }

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return shown().length
    },
    getScrollElement: () => viewport() ?? null,
    initialRect: { width: 0, height: 10 * ROW_HEIGHT },
    estimateSize: () => ROW_HEIGHT,
    // The list's inset above its first row and below its last, which a row moved to keeps too, so its focus ring stays
    // off the list's edge.
    paddingStart: 4,
    paddingEnd: 4,
    scrollPaddingStart: 4,
    scrollPaddingEnd: 4,
    overscan: 12,
    get getItemKey() {
      const list = shown()

      return (index: number) => list[index]?.site ?? index
    },
    // The active row stays rendered while it scrolls out of view, so the listbox can name it.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const active = state.active

      return indexes.includes(active) || active >= shown().length ? indexes : [...indexes, active].toSorted((a, b) => a - b)
    },
  })

  // Rows keep their element while they stay in view.
  const placed = createMemo(() => new Map(virtualizer.getVirtualItems().map((row) => [String(row.key), row] as const)))
  const keys = createMemo(() => [...placed().keys()])
  const optionID = (site: string) => `${id}-${site}`
  const activeSite = () => shown()[Math.min(state.active, shown().length - 1)]?.site

  const moveTo = (index: number) => {
    setState("active", index)
    virtualizer.scrollToIndex(index, { align: "auto" })
  }

  const onListKey = (event: KeyboardEvent) => {
    const page = Math.floor((viewport()?.clientHeight ?? 0) / ROW_HEIGHT)
    const move = siteListMove(event.key, state.active, shown().length, page)

    if (move !== undefined && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault()

      return moveTo(move)
    }

    if (event.key === " ") {
      event.preventDefault()
      const site = activeSite()

      return site ? toggle(site) : undefined
    }

    if (event.key === "Enter") {
      event.preventDefault()

      return start()
    }

    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return
    const typed = event.timeStamp - state.typed.at < TYPE_AHEAD_MS ? state.typed.text + event.key : event.key
    setState("typed", { text: typed, at: event.timeStamp })
    const found = siteTypeAhead(shown().map((item) => item.site), state.active, typed)

    if (found !== undefined) moveTo(found)
  }

  const profileOptions = createMemo(() => props.choices.map((item) => ({ value: choiceValue(item), label: choiceLabel(item) })))

  return (
    <ui.Dialog
      title={ctx.t("signins.import", { browser: choiceLabel(choice()) })}
      size={state.revealed ? "large" : "fit"}
      footer={
        <>
          {/* Quiet, at the start of the footer: most people import everything and never open it. */}
          <Button type="button" variant="ghost-muted" flush="start" class="me-auto" aria-expanded={state.revealed} onClick={() => setState("revealed", (shown) => !shown)}>
            {ctx.t("settings.import.choose")}
            <Icon name={state.revealed ? "outline-chevron-down" : "outline-chevron-right"} size="small" class="rtl:-scale-x-100" />
          </Button>
          <ui.Button variant="neutral" onClick={props.close}>
            {ctx.t("common.cancel")}
          </ui.Button>
          <ui.Button variant="contrast" disabled={!canImport()} busy={!!job() && props.jobs.running() === job()} onClick={start}>
            {everything() ? ctx.t("signins.action") : ctx.plural("import.some", sites().size, { number: number(sites().size) })}
          </ui.Button>
        </>
      }
    >
      <div data-component="browser-site-chooser" class="flex h-full min-h-0 flex-col">
        {/* What comes over: both, until the person unticks one. The rows are the first thing in the body with or without
            the list, so they stay where they are when "Choose sites" opens it. Each box sits 6px inside its 28px row,
            which keeps its focus ring inside the body's clip. Enter on a box imports, as it does on the list. */}
        <Show when={!props.site}>
        <div
          class="flex shrink-0 flex-col"
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            start()
          }}
        >
          <div class="flex h-7 items-center">
            <Checkbox
              appearance="compact"
              surface={state.revealed ? "base" : "layer-1"}
              checked={state.signins}
              disabled={busy()}
              onChange={(signins) => setState("signins", signins)}
            >
              {ctx.t("import.signins")}
            </Checkbox>
          </div>
          <div class="flex h-7 items-center">
            <Checkbox
              appearance="compact"
              surface={state.revealed ? "base" : "layer-1"}
              checked={state.history}
              disabled={busy()}
              onChange={(history) => setState("history", history)}
            >
              {ctx.t("import.history")}
            </Checkbox>
          </div>
        </div>
        </Show>
        <Show when={state.revealed}>
        {/* The dialog's body scrolls, so it clips at its edges. The search field and the profile select draw their edge
            and their focus ring just outside their box, and the list's frame its edge just inside the body's end: the
            padding keeps them inside the clip. Under the boxes the search field starts 8px lower. */}
        <div class="flex min-h-0 flex-1 flex-col gap-3 pb-1" classList={{ "pt-2": !props.site, "pt-1": !!props.site }}>
        <div class="flex items-center gap-2">
          <TextInput
            appearance="large"
            role="searchbox"
            aria-label={ctx.t("sites.search")}
            placeholder={ctx.t("sites.search")}
            autofocus
            autocomplete="off"
            spellcheck={false}
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            showClearButton={!!state.query}
            onClearClick={() => search("")}
            value={state.query}
            onInput={(event) => search(event.currentTarget.value)}
            // With text in it, Escape clears the search; once empty, it closes the dialog. During an input method's
            // composition it is the composition's.
            data-owns-escape={state.query || composing() ? "" : undefined}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onKeyDown={(event) => {
              // Keys that end or move inside an input method's composition belong to it; Escape does not reach the
              // dialog either.
              if (event.isComposing || event.keyCode === 229) {
                if (event.key === "Escape") event.preventDefault()

                return
              }

              if (event.key === "Escape" && state.query) {
                event.preventDefault()
                search("")
              }

              // The active row comes into view, which a scroll with the mouse may have left.
              if (event.key === "ArrowDown" && ready() && shown().length > 0) {
                event.preventDefault()
                elements.listbox?.focus({ preventScroll: true })
                moveTo(Math.min(state.active, shown().length - 1))
              }
            }}
            class="min-w-40 flex-1"
          />
          <Show when={props.choices.length > 1}>
            {/* The profile gives way before the search on a narrow window. */}
            <div class="min-w-28 shrink-[3] basis-52">
              <Select
                appearance="large"
                aria-label={ctx.t("sites.profile")}
                options={profileOptions()}
                current={profileOptions().find((option) => option.value === state.profile)}
                value={(option) => option.value}
                label={(option) => option.label}
                disabled={busy()}
                placement="bottom-end"
                gutter={6}
                class="!w-full"
                onSelect={(option) => option && switchProfile(option.value)}
              />
            </div>
          </Show>
        </div>
        <div class="flex h-7 items-center gap-1" classList={{ invisible: !ready() }} aria-hidden={!ready()}>
          {/* The count alone is announced, so Select all and Select none say what they did. */}
          <span
            aria-live="polite"
            class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted"
          >
            <Show
              when={shown().length > 0 && missing()}
              fallback={
                <bdi dir="auto">
                  {state.query
                    ? ctx.t("sites.selected.shown", { shown: number(shown().length), selected: number(sites().size) })
                    : ctx.t("sites.selected", { selected: number(sites().size), total: number(all().length) })}
                </bdi>
              }
            >
              {(text) => <bdi dir="auto">{text()}</bdi>}
            </Show>
          </span>
          <Button size="small" variant="ghost" disabled={shownChosen() === shown().length} onClick={selectShown}>
            {state.query ? ctx.t("sites.all.shown", { count: number(shown().length) }) : ctx.t("sites.all")}
          </Button>
          {/* The last label lies on the dialog's right edge, as the list and the field do. */}
          <Button size="small" variant="ghost" flush="end" disabled={shownChosen() === 0} onClick={clearShown}>
            {state.query ? ctx.t("sites.none.shown", { count: number(shown().length) }) : ctx.t("sites.none")}
          </Button>
        </div>
        <div class="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)]">
          <Show
            when={status()}
            fallback={
              <MenuScroll class="min-h-0 flex-1" viewportClass="min-h-0 flex-1 px-1" viewportRef={followViewport}>
                <div
                  ref={(element) => (elements.listbox = element)}
                  id={`${id}-list`}
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label={ctx.t("sites.list")}
                  aria-activedescendant={activeSite() ? optionID(activeSite() ?? "") : undefined}
                  tabIndex={0}
                  class="relative w-full outline-none"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                  onKeyDown={onListKey}
                  onFocus={() => setState("focused", true)}
                  onBlur={() => setState("focused", false)}
                >
                  <For each={keys()}>
                    {(site) => (
                      <Show when={placed().get(site)}>
                        {(row) => {
                          const active = () => activeSite() === site

                          return (
                            <div
                              id={optionID(site)}
                              role="option"
                              aria-selected={sites().has(site)}
                              aria-setsize={shown().length}
                              aria-posinset={row().index + 1}
                              data-site={site}
                              data-active={active() ? "" : undefined}
                              class="absolute inset-x-0 top-0 flex cursor-default items-center gap-2 rounded-[6px] px-2 hover:bg-[var(--v2-overlay-simple-overlay-hover)]"
                              classList={{
                                "bg-[var(--v2-overlay-simple-overlay-hover)]": active() && state.focused,
                                "shadow-[inset_0_0_0_1px_var(--v2-border-border-focus)]": active() && state.focused,
                              }}
                              style={{ height: `${ROW_HEIGHT}px`, transform: `translateY(${row().start}px)` }}
                              onClick={() => {
                                setState("active", row().index)
                                toggle(site)
                              }}
                            >
                              <Checkbox appearance="compact" surface="layer-1" presentation checked={sites().has(site)} />
                              {/* A long name loses its start, so the registrable domain at its end stays in view. */}
                              <span
                                class="min-w-0 flex-1 truncate text-[13px] leading-[var(--line-height-base)] text-v2-text-text-base [direction:rtl] ltr:text-left rtl:text-right"
                                title={site}
                              >
                                <bdi dir="ltr">{site}</bdi>
                              </span>
                            </div>
                          )
                        }}
                      </Show>
                    )}
                  </For>
                </div>
              </MenuScroll>
            }
          >
            {(current) => (
              <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <div class="flex items-center gap-2">
                  <Show when={current().loading}>
                    <ui.Loader size="small" />
                  </Show>
                  <p
                    role={current().error ? "alert" : "status"}
                    class="text-[13px] font-[440] leading-[var(--line-height-base)]"
                    classList={{ "text-v2-state-fg-danger": current().error, "text-v2-text-text-muted": !current().error }}
                  >
                    {current().text}
                  </p>
                </div>
                <Show when={current().retry}>
                  <ui.Button size="small" variant="neutral" onClick={() => setState("attempt", (attempt) => attempt + 1)}>
                    {ctx.t("common.retry")}
                  </ui.Button>
                </Show>
              </div>
            )}
          </Show>
        </div>
        </div>
        </Show>
        <Show when={message()}>
          {(current) => (
            <p
              role={current().error ? "alert" : "status"}
              class="shrink-0 py-1 text-[13px] leading-[var(--line-height-base)]"
              classList={{ "text-v2-state-fg-danger": current().error, "text-v2-text-text-muted": !current().error }}
            >
              {current().text}
            </p>
          )}
        </Show>
      </div>
    </ui.Dialog>
  )
}

/**
 * The dialog's state: the profile shown and the search; the chosen sites of one profile, so switching profiles starts
 * from none; the active row and whether the list has the keyboard; how often the list was read again; what the
 * type-ahead has so far; whether it still looks for the profile that has the searched site; and what comes over.
 */
type ChooserState = {
  profile: string
  query: string
  chosen: { profile: string; sites: ReadonlySet<string> }
  active: number
  focused: boolean
  attempt: number
  typed: { text: string; at: number }
  seeking: boolean
  /** The site list shows; the dialog opens without it. */
  revealed: boolean
  /** The person changed which sites come over, or the dialog opened for one site; before that, every site does. */
  custom: boolean
  /** The sign-ins come over; ticked until the person unticks it. */
  signins: boolean
  /** The browsing history comes over; ticked until the person unticks it. */
  history: boolean
}

/** The list's scrolling viewport and the listbox in it, once they mount. */
type ChooserElements = { listbox?: HTMLDivElement }

/**
 * The import dialog with jobs of its own, for a surface that has none, such as a page's passkey notice: it lists the
 * browsers itself and opens on the one used last. `imported` runs after an import that brought cookies.
 */
export function SiteChooserDialog(props: {
  site?: { name: string; choose: boolean }
  /** Opens with the site list shown, for a surface where the person asked to choose. */
  reveal?: boolean
  imported: () => void
  close: () => void
}) {
  const ctx = usePlugin<typeof definition>()

  const jobs = createProfileJobs({
    finished(finished) {
      if (importedCookies(finished.outcome) > 0) props.imported()
    },
  })

  const choices = createMemo(() => profileChoices(jobs.sources()))

  return (
    <Show
      when={choices()[0]}
      fallback={
        <ctx.ui.Dialog
          title={ctx.t("settings.import.title")}
          size="fit"
          footer={
            <ctx.ui.Button variant="neutral" onClick={props.close}>
              {ctx.t("common.cancel")}
            </ctx.ui.Button>
          }
        >
          <Show when={jobs.sourcesLoaded()} fallback={<ctx.ui.Loader size="small" />}>
            <p class="text-[13px] leading-[var(--line-height-base)] text-v2-text-text-muted">
              {ctx.t("settings.import.none")}
            </p>
          </Show>
        </ctx.ui.Dialog>
      }
    >
      {(first) => <SiteChooser choices={choices()} initial={first()} jobs={jobs} site={props.site} reveal={props.reveal} close={props.close} />}
    </Show>
  )
}
