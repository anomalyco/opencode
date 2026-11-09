import { createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createMediaQuery } from "@solid-primitives/media"
import { Option } from "effect"
import { Button } from "@opencode/ui/button"
import { usePlugin } from "@opencode/plugin/gui"
import { Meta, Visual } from "./beta-dialog"
import { allBetaNotes, betaHistory, decodeEmbeddedNotes, type BetaNote, type EmbeddedNotes } from "./beta-notes"
import type definition from "./index"

/** Settings > What's new in beta: every change this build carries, in the host's settings list markup. */
export default function BetaNotesPage() {
  const ctx = usePlugin<typeof definition>()

  return (
    <BetaNotesView
      embedded={Option.getOrUndefined(decodeEmbeddedNotes(import.meta.env.OPENCODE_BETA_NOTES))}
      open={(href) => ctx.system.openExternal(href)}
    />
  )
}

export function BetaNotesView(props: { embedded: EmbeddedNotes | undefined; open: (href: string) => void }) {
  const ctx = usePlugin<typeof definition>()
  // Below 640px a row's control slot wraps under its title, so narrow windows leave the visuals to the dialog.
  const wide = createMediaQuery("(min-width: 640px)")
  const watch = createWatch()

  return (
    <Show when={props.embedded}>
      {(embedded) => {
        const notes = allBetaNotes(embedded())

        return (
          <>
            <div class="settings-tab-header">
              <div class="settings-tab-header-row">
                <div class="flex min-w-0 flex-col gap-1">
                  <h2 class="settings-tab-title">{ctx.t("beta.title")}</h2>
                  <span class="text-11-regular text-v2-text-text-muted">{ctx.t("beta.page.description")}</span>
                </div>
                <div class="settings-tab-header-actions">
                  <Button
                    type="button"
                    variant="ghost-muted"
                    class="whitespace-nowrap"
                    onClick={() => props.open(betaHistory(embedded()))}
                  >
                    {ctx.t("beta.github")}
                  </Button>
                </div>
              </div>
            </div>
            <div class="settings-tab-body settings-tab-body--sectioned">
              <Notes title={ctx.t("beta.added")} notes={notes.added} open={props.open} wide={wide()} watch={watch} />
              <Notes title={ctx.t("beta.fixed")} notes={notes.fixed} open={props.open} wide={wide()} watch={watch} />
            </div>
          </>
        )
      }}
    </Show>
  )
}

type Watch = (element: Element, inView: (value: boolean) => void) => () => void

function Notes(props: {
  title: string
  notes: readonly BetaNote[]
  open: (href: string) => void
  wide: boolean
  watch: Watch
}) {
  return (
    <Show when={props.notes.length > 0}>
      <section class="settings-section" aria-label={props.title}>
        <h3 class="settings-section-title">{props.title}</h3>
        <div data-component="settings-list" data-variant="catalog">
          <For each={props.notes}>
            {(note) => (
              <div data-component="settings-row">
                <div data-slot="settings-row-copy">
                  <div data-slot="settings-row-title" class="[overflow-wrap:anywhere]">
                    {note.summary}
                  </div>
                  <Show when={note.author || note.pr}>
                    <div data-slot="settings-row-description">
                      <Meta note={note} open={props.open} class="" />
                    </div>
                  </Show>
                </div>
                <Show when={props.wide && note.visual}>
                  {(visual) => <RowVisual visual={visual()} label={note.description} watch={props.watch} />}
                </Show>
              </div>
            )}
          </For>
        </div>
      </section>
    </Show>
  )
}

/** A row's visual in its control slot, mounted only while the row is near the viewport so off-screen loops stop. */
function RowVisual(props: { visual: NonNullable<BetaNote["visual"]>; label?: string; watch: Watch }) {
  const [visible, setVisible] = createSignal(false)
  let slot!: HTMLDivElement

  onMount(() => onCleanup(props.watch(slot, setVisible)))

  return (
    // Inline, so the host's unlayered control-slot width cannot collapse the space before the visual mounts.
    <div ref={slot} data-slot="settings-row-control" style={{ width: "120px", height: "36px" }}>
      <Show when={visible()}>
        <Visual visual={props.visual} label={props.label} />
      </Show>
    </div>
  )
}

/** One IntersectionObserver for every row on the page; each watched element hears when it nears or leaves the viewport. */
function createWatch(): Watch {
  const rows = new Map<Element, (value: boolean) => void>()

  const observer = new IntersectionObserver(
    (entries) => entries.forEach((entry) => rows.get(entry.target)?.(entry.isIntersecting)),
    { rootMargin: "200px 0px" },
  )

  onCleanup(() => observer.disconnect())

  return (element, inView) => {
    rows.set(element, inView)
    observer.observe(element)

    return () => {
      rows.delete(element)
      observer.unobserve(element)
    }
  }
}
