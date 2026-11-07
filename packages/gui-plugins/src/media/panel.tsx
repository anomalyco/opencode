import { createMemo, createSignal, For, Match, on, onCleanup, Show, Switch, untrack, type JSX } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { ImagePreview } from "@opencode/ui/image-preview"
import { Loader } from "@opencode/ui/loader"
import { Tabs } from "@opencode/ui/tabs"
import { Select } from "@opencode/ui/select"
import { TextInput } from "@opencode/ui/text-input"
import { createKeyed, createLatest, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"
import type { SessionMedia } from "@opencode/schema/session-media"
import type Media from "./index"
import { createMediaHistory } from "./history"
import { LinkGroups } from "./links"
import { createMediaLoader, type MediaLoader } from "./source"

type MediaItem = SessionMedia.Media

type Kind = "media" | "links"

type From = "all" | SessionMedia.Sender

const KINDS: readonly Kind[] = ["media", "links"]

const FROM: readonly From[] = ["all", "user", "agent"]

export default function MediaPanel(props: { session: MountedSession }) {
  const ctx = usePlugin<typeof Media>()
  const load = createMediaLoader()
  // The tab and sender stay per session, so leaving the panel and coming back keeps them.
  const stored = () => ctx.stores.view(props.session)
  const kind = (): Kind => stored().value?.kind ?? "media"
  const from = (): From => stored().value?.from ?? "all"

  const setKind = (next: Kind) =>
    stored().update((draft) => {
      draft.kind = next
    })

  const setFrom = (next: From) =>
    stored().update((draft) => {
      draft.from = next
    })

  const [searching, setSearching] = createSignal(false)
  const [query, setQuery] = createSignal("")

  const closeSearch = () => {
    setQuery("")
    setSearching(false)
  }

  const messages = () => props.session.server.data.session.message

  // The server reads the whole session's history for the panel; a new session starts a new history.
  const history = createMemo(
    on(
      () => `${props.session.key}\n${props.session.directory}`,
      () => untrack(() => createMediaHistory(props.session)),
    ),
  )

  // What the timeline has changes when a message arrives, a tool settles or a reply ends: read the newest messages again.
  const tip = () => {
    const list = messages().list(props.session.id)
    const last = list.at(-1)

    if (!last) return `${props.session.key}:empty`
    const settled = last.type === "assistant" ? last.content.filter(isSettled).length : 0
    const completed = last.type === "assistant" ? last.time.completed : undefined

    return `${props.session.key}:${list.length}:${last.id}:${settled}:${completed ?? ""}`
  }

  createKeyed(tip, () => history().refresh())

  const needle = () => query().trim().toLowerCase()

  const matches = (sender: SessionMedia.Sender, text: readonly (string | undefined)[]) =>
    (from() === "all" || sender === from()) &&
    (!needle() || text.some((value) => value?.toLowerCase().includes(needle())))

  const media = createMemo(() =>
    history()
      .items()
      .media.filter((item) =>
        matches(item.from, [item.name, item.source.type === "path" ? item.source.path : undefined]),
      ),
  )

  const links = createMemo(() =>
    history()
      .items()
      .links.filter((item) => matches(item.from, [item.title, item.url])),
  )

  // Older history comes in while the end of the list is on screen: as the user scrolls down, and again after each
  // read while a short list still leaves it showing. A search reads the whole session, so it finds what is not yet
  // listed. Every tab reads the same history, so a page fills both.
  const [end, setEnd] = createSignal(false)

  createKeyed(
    () => (end() || !!needle()) && history().status() === "more" && `${props.session.key}:${history().settled()}`,
    () => history().older(),
  )

  const observeEnd = (element: HTMLElement) => {
    const observer = new IntersectionObserver((entries) => setEnd(entries.some((entry) => entry.isIntersecting)), {
      rootMargin: "300px",
    })

    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }

  const empty = () => {
    if (needle()) return ctx.t("empty.search")

    if (from() !== "all") return ctx.t(from() === "user" ? "empty.user" : "empty.agent")

    return ctx.t(`empty.${kind()}`)
  }

  const openURL = (url: string) => {
    const pane = ctx.use(Browser)()

    if (pane.status === "active" && pane.value.canOpen(props.session)) return pane.value.open(props.session, url)
    ctx.system.openExternal(url)
  }

  const openPath = (path: string) => ctx.links.open({ href: path, exact: true, session: props.session })

  const reading = () => history().status() === "empty" || history().status() === "loading"

  const dialog = useDialog()
  // Each image card's thumbnail, so the viewer opens from and closes into the card of the image it shows.
  const thumbnails = new Map<string, HTMLImageElement>()

  // Images whose bytes are gone stay as cards that say so, but the viewer steps past them.
  const images = createMemo(() =>
    media().filter((item) => item.kind === "image" && !load.failed(props.session, item.source)),
  )

  const view = (id: string) =>
    dialog.show(() => (
      <MediaViewer
        items={images}
        start={id}
        session={props.session}
        load={load}
        thumbnail={(item) => thumbnails.get(item)}
        name={(item) => item.name ?? ctx.t("media.image")}
      />
    ))

  const thumbnail = (id: string, element: HTMLImageElement | undefined) =>
    element ? thumbnails.set(id, element) : thumbnails.delete(id)

  return (
    <div data-component="media-panel">
      <div data-slot="media-panel-filters">
        <Tabs
          variant="pill"
          value={kind()}
          onChange={(value) => {
            const next = KINDS.find((item) => item === value)

            if (next) setKind(next)
          }}
          aria-label={ctx.t("kind.label")}
          data-slot="media-panel-kinds"
        >
          <Tabs.List>
            <For each={KINDS}>{(value) => <Tabs.Trigger value={value}>{ctx.t(`kind.${value}`)}</Tabs.Trigger>}</For>
          </Tabs.List>
        </Tabs>
        <IconButton
          size="small"
          variant="ghost-muted"
          icon={<Icon name="magnifying-glass" />}
          aria-label={ctx.t("search.label")}
          aria-pressed={searching()}
          data-slot="media-panel-search-toggle"
          onClick={() => (searching() ? closeSearch() : setSearching(true))}
        />
        <Select
          options={[...FROM]}
          current={from()}
          label={(value) => ctx.t(`from.${value}`)}
          onSelect={(value) => value && setFrom(value)}
          appearance="inline"
          placement="bottom-end"
          gutter={6}
          aria-label={ctx.t("from.label")}
          class="shrink-0"
        />
      </div>
      <Show when={searching()}>
        <div data-slot="media-panel-search">
          <TextInput
            ref={(element) => queueMicrotask(() => element.focus())}
            type="search"
            appearance="small"
            surface="layer-1"
            leadingIcon={<Icon name="magnifying-glass" size="small" />}
            placeholder={ctx.t("search.placeholder")}
            aria-label={ctx.t("search.label")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return
              event.preventDefault()
              closeSearch()
            }}
            onBlur={() => !query() && setSearching(false)}
          />
        </div>
      </Show>
      <div data-slot="media-panel-body" data-scrollable>
        <Switch>
          <Match when={kind() === "media" && media().length > 0}>
            <MediaGrid
              items={media()}
              session={props.session}
              load={load}
              openURL={openURL}
              openPath={openPath}
              view={view}
              thumbnail={thumbnail}
            />
          </Match>
          <Match when={kind() === "links" && links().length > 0}>
            <LinkGroups links={links()} openURL={openURL} />
          </Match>
          <Match when={history().status() === "done"}>
            <div data-slot="media-panel-empty">{empty()}</div>
          </Match>
        </Switch>
        <div ref={observeEnd} data-slot="media-panel-end">
          <Switch>
            <Match when={history().status() === "failed"}>
              <span>{ctx.t("history.failed")}</span>
              <button type="button" data-slot="media-panel-retry" onClick={() => history().retry()}>
                {ctx.t("history.retry")}
              </button>
            </Match>
            <Match when={reading() || history().status() === "more"}>
              <Loader width={14} height={14} />
              <span>{ctx.t("history.loading")}</span>
            </Match>
          </Switch>
        </div>
      </div>
    </div>
  )
}

function MediaGrid(props: {
  items: readonly MediaItem[]
  session: MountedSession
  load: MediaLoader
  openURL: (url: string) => void
  openPath: (path: string) => void
  view: (id: string) => void
  thumbnail: (id: string, element: HTMLImageElement | undefined) => void
}) {
  return (
    <DayGroups items={props.items}>
      {(item) => (
        <MediaCard
          item={item}
          session={props.session}
          load={props.load}
          openURL={props.openURL}
          openPath={props.openPath}
          view={props.view}
          thumbnail={props.thumbnail}
        />
      )}
    </DayGroups>
  )
}

/**
 * Items under a heading per local day, newest first as given. Keyed by day and id strings: a streaming reply derives new
 * item objects, and their rows must not mount again.
 */
function DayGroups<T extends { readonly id: string; readonly time: number }>(props: {
  items: readonly T[]
  children: (item: T) => JSX.Element
}) {
  const ctx = usePlugin<typeof Media>()
  const byID = createMemo(() => new Map(props.items.map((item) => [item.id, item])))

  const days = createMemo(() =>
    props.items.reduce((result, item) => {
      const key = dayKey(item.time)

      result.set(key, [...(result.get(key) ?? []), item.id])

      return result
    }, new Map<string, string[]>()),
  )

  const label = (key: string) => {
    const now = Date.now()

    if (key === dayKey(now)) return ctx.t("day.today")

    if (key === dayKey(now - 86_400_000)) return ctx.t("day.yesterday")
    const time = props.items.find((item) => dayKey(item.time) === key)?.time ?? now

    return new Date(time).getFullYear() === new Date(now).getFullYear()
      ? dayFormat.format(time)
      : yearFormat.format(time)
  }

  return (
    <div data-slot="media-panel-days">
      <For each={[...days().keys()]}>
        {(day) => (
          <section data-slot="media-panel-day">
            <h3 data-slot="media-panel-day-title">{label(day)}</h3>
            <div data-slot="media-panel-grid">
              <For each={days().get(day) ?? []}>
                {(id) => <Show when={byID().get(id)}>{(item) => props.children(item())}</Show>}
              </For>
            </div>
          </section>
        )}
      </For>
    </div>
  )
}

function MediaCard(props: {
  item: MediaItem
  session: MountedSession
  load: MediaLoader
  openURL: (url: string) => void
  openPath: (path: string) => void
  view: (id: string) => void
  thumbnail: (id: string, element: HTMLImageElement | undefined) => void
}) {
  const ctx = usePlugin<typeof Media>()
  const [visible, setVisible] = createSignal(false)
  const [playing, setPlaying] = createSignal(false)

  // Loads once the card nears the viewport; the item's id names the same bytes for as long as the card lives.
  const src = createLatest(
    () => visible() && props.item.id,
    () => untrack(() => props.load.load(props.session, props.item.source, props.item.mime)),
  )

  // A load that rejects, or that finds no bytes (e.g. a deleted file), leaves the card with its caption.
  const failed = () => !!src.error || (visible() && !src.loading && src.latest === undefined)
  const state = () => (failed() ? "failed" : src.latest ? "loaded" : "loading")
  const name = () => props.item.name ?? ctx.t(props.item.kind === "video" ? "media.video" : "media.image")
  let video: HTMLVideoElement | undefined

  const observe = (element: HTMLElement) => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setVisible(true)
        observer.disconnect()
      },
      { rootMargin: "200px" },
    )

    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }

  const open = () => {
    if (props.item.kind === "image") {
      if (src.latest) props.view(props.item.id)

      return
    }

    // A video file opens in its own tab, a web video in the browser; anything else plays where it is.
    if (props.item.source.type === "path") return void props.openPath(props.item.source.path)

    if (props.item.source.type === "url" && /^https?:/.test(props.item.source.url))
      return props.openURL(props.item.source.url)

    setPlaying(true)
    void video?.play().catch(() => {})
  }

  return (
    <button
      type="button"
      ref={observe}
      data-slot="media-card"
      data-kind={props.item.kind}
      data-playing={playing() ? "" : undefined}
      title={props.item.name}
      onClick={open}
    >
      <span data-slot="media-card-frame" data-state={state()}>
        <Switch>
          <Match when={failed()}>
            <span data-slot="media-card-failed">
              <Icon name={props.item.kind === "video" ? "outline-video" : "outline-photo"} size="small" />
              {ctx.t("media.failed")}
            </span>
          </Match>
          <Match when={props.item.kind === "image" && src.latest}>
            {(url) => {
              const id = props.item.id

              onCleanup(() => props.thumbnail(id, undefined))

              return (
                <img
                  ref={(element) => props.thumbnail(id, element)}
                  src={url()}
                  alt=""
                  decoding="async"
                  draggable={false}
                />
              )
            }}
          </Match>
          <Match when={props.item.kind === "video" && src.latest}>
            {(url) => (
              <video ref={video} src={url()} muted={!playing()} controls={playing()} preload="metadata" playsinline />
            )}
          </Match>
        </Switch>
        <Show when={props.item.kind === "video" && !playing() && !failed()}>
          <span data-slot="media-card-play">
            <Icon name="outline-video" />
          </span>
        </Show>
      </span>
      <span data-slot="media-card-caption">
        <span data-slot="media-card-name">{name()}</span>
        <span data-slot="media-card-meta">
          <span data-slot="media-panel-badge" data-from={props.item.from}>
            {ctx.t(props.item.from === "user" ? "from.user" : "from.agent")}
          </span>
          <time datetime={new Date(props.item.time).toISOString()}>{timeFormat.format(props.item.time)}</time>
        </span>
      </span>
    </button>
  )
}

/**
 * The image viewer over the panel's images, in the order the grid shows them. It follows the image on screen by id, so
 * a reply that adds an image does not move it; when that image drops out (its bytes are gone), the one now in its
 * place shows.
 */
function MediaViewer(props: {
  items: () => readonly MediaItem[]
  start: string
  session: MountedSession
  load: MediaLoader
  thumbnail: (id: string) => HTMLImageElement | undefined
  name: (item: MediaItem) => string
}) {
  const [shown, setShown] = createSignal({
    id: props.start,
    index: Math.max(
      0,
      props.items().findIndex((item) => item.id === props.start),
    ),
  })

  const index = createMemo(() => {
    const found = props.items().findIndex((item) => item.id === shown().id)

    return found === -1 ? Math.min(shown().index, props.items().length - 1) : found
  })

  const item = (): MediaItem | undefined => props.items()[index()]

  const step = (direction: 1 | -1) => {
    const next = props.items()[index() + direction]

    if (next) setShown({ id: next.id, index: index() + direction })
  }

  // Keyed by id; the grid already loaded most of these, so a step usually reads a URL it has.
  const src = createLatest(
    () => item()?.id,
    () => {
      const current = untrack(item)

      return current ? props.load.load(props.session, current.source, current.mime) : Promise.resolve(undefined)
    },
  )

  const nameOf = () => {
    const current = item()

    return current && props.name(current)
  }

  const thumbnailOf = () => {
    const current = item()

    return current && props.thumbnail(current.id)
  }

  return (
    <Show when={src.latest}>
      {(url) => (
        <ImagePreview
          src={url()}
          alt={nameOf()}
          origin={thumbnailOf()}
          position={{ index: Math.max(0, index()), total: props.items().length }}
          onStep={step}
        />
      )}
    </Show>
  )
}

// A local calendar day, so items group the way the user's clock reads them.
function dayKey(time: number) {
  const date = new Date(time)

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" })

const yearFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" })

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })

const isSettled = (part: { readonly type: string; readonly state?: { readonly status: string } }) =>
  part.type === "tool" && (part.state?.status === "completed" || part.state?.status === "error")
