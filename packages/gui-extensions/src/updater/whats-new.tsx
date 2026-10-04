import { createSignal, Index, Show } from "solid-js"
import { Effect, Option, Predicate, Schema } from "effect"
import { Button } from "@opencode/ui/button"
import { Dialog } from "@opencode/ui/dialog"
import { useExtension, type DialogHandle, type SetupContext } from "../sdk"
import type definition from "./index"

const CHANGELOG_URL = "https://opencode.ai/changelog.json"

type Highlight = {
  title: string
  description: string
  media?: { type: "image" | "video"; src: string; alt?: string }
}

/** An optional field that reads as absent when it holds anything else, as the changelog is read leniently. */
function lenient<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const field = Schema.optional(schema)

  return Schema.catchDecoding<typeof field>(() => Effect.succeed(Option.none()))(field)
}

/** A list entry that reads as undefined when it is malformed, so the rest of the list still counts. */
function entry<S extends Schema.ConstraintCodec<unknown, unknown>>(schema: S) {
  const item = Schema.UndefinedOr(schema)

  return Schema.catchDecoding<typeof item>(() => Effect.succeed(Option.some(undefined)))(item)
}

const Text = lenient(Schema.Union([Schema.String, Schema.Number]))

const Media = Schema.Struct({ type: Text, src: Text, url: Text })

const Item = Schema.Struct({ title: Text, description: Text, shortDescription: Text, media: lenient(Media) })

const Group = Schema.Struct({ ...Item.fields, source: Text, items: lenient(Schema.Array(entry(Item))) })

const Release = Schema.Struct({
  tag: Text,
  tag_name: Text,
  name: Text,
  highlights: lenient(Schema.Array(entry(Group))),
})

const Releases = Schema.Array(entry(Release))

const Changelog = Schema.Union([Releases, Schema.Struct({ releases: Releases })])

const decodeChangelog = Schema.decodeUnknownOption(Changelog)

/**
 * Shows the desktop highlights of the releases since `previous` once the changelog loads, and remembers the current
 * version as seen. A changelog without highlights only remembers the version; a failed request leaves it for the next
 * start.
 */
export function showWhatsNew(
  ctx: SetupContext<typeof definition>,
  input: { readonly previous: string; readonly current: string; readonly markSeen: () => void },
) {
  const timers = new Set<ReturnType<typeof setTimeout>>()

  ctx.signal.addEventListener("abort", () => timers.forEach(clearTimeout))

  fetch(CHANGELOG_URL, { signal: ctx.signal, headers: { Accept: "application/json" } })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((json) => {
      if (!json) return

      const highlights = Option.match(decodeChangelog(json), {
        onNone: () => [],
        onSome: (changelog) => sliceHighlights(releases(changelog), input.current, input.previous),
      })

      if (ctx.signal.aborted) return

      if (highlights.length === 0) return input.markSeen()

      timers.add(
        setTimeout(() => {
          input.markSeen()
          ctx.dialogs.open((dialog) => <DialogReleaseNotes highlights={highlights} dialog={dialog} />, {
            replace: true,
          })
        }, 500),
      )
    })
    .catch(() => undefined)
}

function releases(changelog: typeof Changelog.Type) {
  return ("releases" in changelog ? changelog.releases : changelog).flatMap((release) => {
    if (!release) return []

    const groups = release.highlights ?? []

    return [
      {
        tag: text(release.tag) ?? text(release.tag_name) ?? text(release.name),
        highlights: groups.flatMap((group) => {
          const source = text(group?.source)

          if (!group || !source?.toLowerCase().includes("desktop")) return []

          if (group.items) return group.items.flatMap((item) => (item ? Option.toArray(highlight(item)) : []))

          return Option.toArray(highlight(group))
        }),
      },
    ]
  })
}

function highlight(item: typeof Item.Type): Option.Option<Highlight> {
  const title = text(item.title)
  const description = text(item.description) ?? text(item.shortDescription)

  if (!title || !description) return Option.none()

  return Option.some({ title, description, media: media(item.media, title) })
}

function media(value: typeof Media.Type | undefined, alt: string): Highlight["media"] {
  const type = text(value?.type)?.toLowerCase()
  const src = text(value?.src) ?? text(value?.url)

  if (!src) return

  if (type !== "image" && type !== "video") return

  return { type, src, alt }
}

/** A trimmed, non-empty string, or a number written out. */
function text(value: string | number | undefined) {
  if (Predicate.isNumber(value)) return String(value)

  return value?.trim() || undefined
}

function normalizeVersion(value: string | undefined) {
  const text = value?.trim()

  if (!text) return

  return text.startsWith("v") || text.startsWith("V") ? text.slice(1) : text
}

function sliceHighlights(list: { tag?: string; highlights: Highlight[] }[], current: string, previous: string) {
  const now = normalizeVersion(current)
  const before = normalizeVersion(previous)

  const start = (() => {
    if (!now) return 0

    const index = list.findIndex((release) => normalizeVersion(release.tag) === now)

    return index === -1 ? 0 : index
  })()

  const end = (() => {
    if (!before) return list.length

    const index = list.findIndex((release, i) => i >= start && normalizeVersion(release.tag) === before)

    return index === -1 ? list.length : index
  })()

  const seen = new Set<string>()

  return list
    .slice(start, end)
    .flatMap((release) => release.highlights)
    .filter((item) => {
      const key = [item.title, item.description, item.media?.type ?? "", item.media?.src ?? ""].join("\n")

      if (seen.has(key)) return false

      seen.add(key)

      return true
    })
    .slice(0, 5)
}

function DialogReleaseNotes(props: { highlights: Highlight[]; dialog: DialogHandle }) {
  const ctx = useExtension<typeof definition>()
  const [index, setIndex] = createSignal(0)

  const total = () => props.highlights.length
  const last = () => Math.max(0, total() - 1)
  const feature = () => props.highlights[index()] ?? props.highlights[last()]
  const isFirst = () => index() === 0
  const isLast = () => index() >= last()
  const paged = () => total() > 1

  function handleNext() {
    if (isLast()) return

    setIndex(index() + 1)
  }

  function handleClose() {
    props.dialog.close()
  }

  function handleDisable() {
    ctx.stores.releaseNotes.update((draft) => {
      draft.enabled = false
    })
    handleClose()
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault()
      handleClose()

      return
    }

    if (!paged()) return

    if (e.key === "ArrowLeft" && !isFirst()) {
      e.preventDefault()
      setIndex(index() - 1)
    }

    if (e.key === "ArrowRight" && !isLast()) {
      e.preventDefault()
      setIndex(index() + 1)
    }
  }

  return (
    <Dialog
      size="large"
      fit
      class="w-[min(calc(100vw-40px),720px)] h-[min(calc(100vh-40px),400px)] -mt-20 min-h-0 overflow-hidden"
    >
      <div class="flex flex-1 min-w-0 min-h-0" tabIndex={0} autofocus onKeyDown={handleKeyDown}>
        {/* Left side - Text content */}
        <div class="flex flex-col flex-1 min-w-0 p-8">
          {/* Top section - feature content (fixed position from top) */}
          <div class="flex flex-col gap-2 pt-22">
            <div class="flex items-center gap-2">
              <h1 class="text-16-medium text-text-strong">{feature()?.title ?? ""}</h1>
            </div>
            <p class="text-14-regular text-text-base">{feature()?.description ?? ""}</p>
          </div>

          {/* Spacer to push buttons to bottom */}
          <div class="flex-1" />

          {/* Bottom section - buttons and indicators (fixed position) */}
          <div class="flex flex-col gap-12">
            <div class="flex flex-col items-start gap-3">
              <Show
                when={isLast()}
                fallback={
                  <Button variant="neutral" size="large" onClick={handleNext}>
                    {ctx.t("releaseNotes.action.next")}
                  </Button>
                }
              >
                <Button variant="contrast" size="large" onClick={handleClose}>
                  {ctx.t("releaseNotes.action.getStarted")}
                </Button>
              </Show>

              <Button variant="ghost" size="small" onClick={handleDisable}>
                {ctx.t("releaseNotes.action.hideFuture")}
              </Button>
            </div>

            <Show when={paged()}>
              <div class="flex items-center gap-1.5 -my-2.5">
                <Index each={props.highlights}>
                  {(_, i) => (
                    <button
                      type="button"
                      class="h-6 flex items-center cursor-pointer bg-transparent border-none p-0 transition-all duration-200"
                      classList={{
                        "w-8": i === index(),
                        "w-3": i !== index(),
                      }}
                      onClick={() => setIndex(i)}
                    >
                      <div
                        class="w-full h-0.5 rounded-[1px] transition-colors duration-200"
                        classList={{
                          "bg-icon-strong-base": i === index(),
                          "bg-icon-weak-base": i !== index(),
                        }}
                      />
                    </button>
                  )}
                </Index>
              </div>
            </Show>
          </div>
        </div>

        {/* Right side - Media content (edge to edge) */}
        <Show when={feature()?.media}>
          {(media) => (
            <div class="flex-1 min-w-0 bg-surface-base overflow-hidden rounded-r-xl">
              <Show
                when={media().type === "image"}
                fallback={
                  <video src={media().src} autoplay loop muted playsinline class="w-full h-full object-cover" />
                }
              >
                <img
                  src={media().src}
                  alt={media().alt ?? feature()?.title ?? ctx.t("releaseNotes.media.alt")}
                  class="w-full h-full object-cover"
                />
              </Show>
            </div>
          )}
        </Show>
      </div>
    </Dialog>
  )
}
