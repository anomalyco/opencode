import { Checkbox } from "@opencode/ui/checkbox"
import { createVirtualizer } from "@tanstack/solid-virtual"
import { createMemo, createSignal, For, Show, untrack } from "solid-js"
import { createLatest, usePlugin } from "@opencode/plugin/gui"
import { choiceLabel, choiceValue, type Choice } from "./choices"
import type definition from "./index"
import { createProfileJobs } from "./jobs"
import { importedCookies } from "./jobs-machine"
import { matchSites } from "./site-search"

/** Rows of the site list, in CSS pixels: one line of text in a checkbox row. */
const ROW_HEIGHT = 32

/**
 * The import dialog: the sites a browser profile has cookies for, one row per registrable domain with how many cookies
 * it has, to import only the chosen ones. Nothing is chosen at first, because the person came here to choose; the
 * one-click import elsewhere still brings every site. Main reads the list from the cookies' hosts alone, and it lives
 * only while the dialog is open: neither the list nor the choice is stored.
 *
 * It runs its own import, so it keeps working whichever surface opened it, and stays open to add more sites; cookies
 * already imported stay. `imported` runs after an import that brought cookies, for the pane to load its page again.
 */
export function SiteChooser(props: {
  choices: readonly Choice[]
  initial: Choice
  imported?: () => void
  close: () => void
}) {
  const ctx = usePlugin<typeof definition>()
  const ui = ctx.ui

  const jobs = createProfileJobs({
    finished(finished) {
      if (importedCookies(finished.outcome) > 0) props.imported?.()
    },
  })

  const [profile, setProfile] = createSignal(choiceValue(props.initial))
  const [query, setQuery] = createSignal("")

  // The chosen sites of one profile: switching profiles starts from none.
  const [chosen, setChosen] = createSignal<{ profile: string; sites: ReadonlySet<string> }>({
    profile: profile(),
    sites: new Set(),
  })

  const choice = createMemo(() => props.choices.find((item) => choiceValue(item) === profile()) ?? props.initial)
  const sites = () => (chosen().profile === profile() ? chosen().sites : new Set<string>())

  const listed = createLatest(profile, (key, signal) => {
    const current = untrack(choice)

    return jobs.sites(current.source.id, current.profile.id, signal).then((result) => ({ key, result }))
  })

  // The previous profile's list never shows under another profile while the new one loads.
  const result = () => (listed.latest?.key === profile() ? listed.latest.result : undefined)

  const all = createMemo(() => {
    const current = result()

    return current?.type === "listed" ? current.sites : []
  })

  const shown = createMemo(() => matchSites(all(), query()))
  const browser = () => choice().source.name

  const status = () => {
    const current = result()

    if (listed.error !== undefined && !listed.loading) return { text: ctx.t("common.requestFailed"), error: true }

    if (!current) return { text: ctx.t("sites.loading", { browser: browser() }), error: false, loading: true }

    if (current.type === "failed" && current.reason === "locked")
      return { text: ctx.t("signins.failed.locked.named", { browser: browser() }), error: true }

    if (current.type === "failed") return { text: ctx.t(`signins.failed.${current.reason}`), error: true }

    if (current.sites.length === 0) return { text: ctx.t("sites.empty"), error: false }

    if (shown().length === 0) return { text: ctx.t("sites.unmatched"), error: false }
  }

  const choose = (change: (next: Set<string>) => void) => {
    const next = new Set(sites())
    change(next)
    setChosen({ profile: profile(), sites: next })
  }

  const toggle = (site: string, on: boolean) => choose((next) => (on ? next.add(site) : next.delete(site)))
  // Both act on the sites the search shows, so a search for one tool selects only its sites.
  const selectShown = () => choose((next) => shown().forEach((item) => next.add(item.site)))
  const clearShown = () => choose((next) => shown().forEach((item) => next.delete(item.site)))

  const start = () => {
    const current = choice()

    jobs.start({
      type: "import-browser",
      source: current.source.id,
      profile: current.profile.id,
      sites: all().flatMap((item) => (sites().has(item.site) ? [item.site] : [])),
    })
  }

  const busy = () => jobs.running() !== undefined
  const message = () => jobs.unsaved() ?? jobs.notice() ?? jobs.describe(jobs.last())
  const [scroller, setScroller] = createSignal<HTMLDivElement>()

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    get count() {
      return shown().length
    },
    getScrollElement: () => scroller() ?? null,
    initialRect: { width: 0, height: 8 * ROW_HEIGHT },
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    get getItemKey() {
      const list = shown()

      return (index: number) => list[index]?.site ?? index
    },
  })

  // Rows keep their element while they stay in view, so a focused checkbox keeps focus as the list scrolls.
  const placed = createMemo(() => new Map(virtualizer.getVirtualItems().map((row) => [String(row.key), row] as const)))
  const keys = createMemo(() => [...placed().keys()])

  return (
    <ui.Dialog
      title={ctx.t("sites.title")}
      description={ctx.t("sites.description")}
      size="large"
      footer={
        <>
          <ui.Button variant="ghost" onClick={props.close}>
            {ctx.t("common.close")}
          </ui.Button>
          <ui.Button
            variant="contrast"
            disabled={sites().size === 0 || !jobs.available() || busy() || jobs.unsaved() !== undefined}
            busy={busy()}
            onClick={start}
          >
            {ctx.plural("sites.import", sites().size)}
          </ui.Button>
        </>
      }
    >
      <div data-component="browser-site-chooser" class="flex h-full min-h-0 flex-col gap-3 pb-1">
        <div class="flex items-center gap-2">
          <ui.TextInput
            label={ctx.t("sites.search")}
            placeholder={ctx.t("sites.search")}
            type="search"
            size="large"
            autofocus
            value={query()}
            onInput={setQuery}
            class="min-w-0 flex-1"
          />
          <Show when={props.choices.length > 1}>
            <ui.Select
              label={ctx.t("sites.profile")}
              options={props.choices.map((item) => ({ value: choiceValue(item), label: choiceLabel(item) }))}
              value={profile()}
              disabled={busy()}
              onChange={setProfile}
            />
          </Show>
        </div>
        <div class="flex h-7 items-center gap-1">
          <span
            aria-live="polite"
            class="min-w-0 flex-1 truncate text-[13px] font-[440] leading-[var(--line-height-base)] text-v2-text-text-muted"
          >
            {ctx.t("sites.selected", { selected: sites().size, total: all().length })}
          </span>
          <ui.Button size="small" variant="ghost" disabled={shown().length === 0} onClick={selectShown}>
            {ctx.t("sites.all")}
          </ui.Button>
          <ui.Button size="small" variant="ghost" disabled={shown().length === 0} onClick={clearShown}>
            {ctx.t("sites.none")}
          </ui.Button>
        </div>
        <div
          ref={setScroller}
          role="group"
          aria-label={ctx.t("sites.list")}
          class="min-h-[248px] flex-1 overflow-y-auto rounded-[8px] bg-v2-background-bg-layer-01 shadow-[inset_0_0_0_0.5px_var(--v2-border-border-muted)]"
        >
          <Show
            when={status()}
            fallback={
              <div class="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                <For each={keys()}>
                  {(site) => (
                    <Show when={placed().get(site)}>
                      {(row) => (
                        <div
                          data-site={site}
                          class="absolute inset-x-0 top-0 flex items-center px-3"
                          style={{ height: `${ROW_HEIGHT}px`, transform: `translateY(${row().start}px)` }}
                        >
                          <Checkbox
                            appearance="compact"
                            class="w-full [&_[data-slot=checkbox-v2-label]]:w-full [&_[data-slot=checkbox-v2-text]]:flex-1"
                            checked={sites().has(site)}
                            onChange={(on: boolean) => toggle(site, on)}
                          >
                            <span class="flex w-full min-w-0 items-center gap-3">
                              <span class="min-w-0 flex-1 truncate" title={site}>
                                <bdi dir="ltr">{site}</bdi>
                              </span>
                              <span class="shrink-0 text-v2-text-text-muted">
                                {ctx.plural("sites.cookies", shown()[row().index]?.cookies ?? 0)}
                              </span>
                            </span>
                          </Checkbox>
                        </div>
                      )}
                    </Show>
                  )}
                </For>
              </div>
            }
          >
            {(current) => (
              <div class="flex h-full items-center justify-center gap-2 px-6 text-center">
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
            )}
          </Show>
        </div>
        <Show when={message()}>
          {(current) => (
            <p
              role={current().error ? "alert" : "status"}
              class="text-[13px] leading-[var(--line-height-base)]"
              classList={{ "text-v2-state-fg-danger": current().error, "text-v2-text-text-base": !current().error }}
            >
              {current().text}
            </p>
          )}
        </Show>
      </div>
    </ui.Dialog>
  )
}
