import { createMemo, createSignal, For, mapArray, Match, onCleanup, Show, Switch, untrack, type JSX } from "solid-js"
import { useDialog } from "@opencode/ui/context/dialog"
import { FileIcon } from "@opencode/ui/file-icon"
import { Icon } from "@opencode/ui/icon"
import { ImagePreview } from "@opencode/ui/image-preview"
import { Tabs } from "@opencode/ui/tabs"
import { Select } from "@opencode/ui/select"
import { SiteIcon } from "@opencode/session-ui/sources/site-icon"
import { createLatest, usePlugin, type MountedSession } from "@opencode/plugin/gui"
import { Browser } from "@opencode/plugin/gui/browser"
import type Media from "./index"
import { combineMedia, messageMedia, type FileItem, type LinkItem, type MediaItem, type Sender } from "./collect"
import { createMediaLoader, type MediaLoader } from "./source"

type Kind = "media" | "files" | "links"

type From = "all" | Sender

const KINDS: readonly Kind[] = ["media", "files", "links"]

const FROM: readonly From[] = ["all", "user", "agent"]

export default function MediaPanel(props: { session: MountedSession }) {
  const ctx = usePlugin<typeof Media>()
  const load = createMediaLoader()
  const [kind, setKind] = createSignal<Kind>("media")
  const [from, setFrom] = createSignal<From>("all")
  const messages = () => props.session.server.data.session.message

  // One memo per message, so a streaming reply derives its own items again rather than the whole session's.
  const perMessage = mapArray(
    () => messages().list(props.session.id),
    (message) => createMemo(() => messageMedia(message)),
  )

  const all = createMemo(() => combineMedia(perMessage().map((items) => items())))

  const shown = <T extends { readonly from: Sender }>(items: readonly T[]) =>
    from() === "all" ? items : items.filter((item) => item.from === from())

  const media = createMemo(() => shown(all().media))
  const files = createMemo(() => shown(all().files))
  const links = createMemo(() => shown(all().links))

  const empty = () => {
    if (from() !== "all") return ctx.t(from() === "user" ? "empty.user" : "empty.agent")

    return ctx.t(`empty.${kind()}`)
  }

  const openURL = (url: string) => {
    const pane = ctx.use(Browser)()

    if (pane.status === "active" && pane.value.canOpen(props.session)) return pane.value.open(props.session, url)
    ctx.system.openExternal(url)
  }

  const openPath = (path: string) => ctx.links.open({ href: path, exact: true, session: props.session })

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
          <Match when={kind() === "files" && files().length > 0}>
            <DayGroups items={files()} layout="list">
              {(item) => <FileRow item={item} directory={props.session.directory} openPath={openPath} />}
            </DayGroups>
          </Match>
          <Match when={kind() === "links" && links().length > 0}>
            <DayGroups items={links()} layout="list">
              {(item) => <LinkRow item={item} openURL={openURL} />}
            </DayGroups>
          </Match>
          <Match when={true}>
            <div data-slot="media-panel-empty">{empty()}</div>
          </Match>
        </Switch>
        <Show when={messages().more(props.session.id)}>
          <div data-slot="media-panel-more">
            <span>{ctx.t("load.note")}</span>
            <button
              type="button"
              disabled={messages().loading(props.session.id)}
              onClick={() =>
                void messages()
                  .loadMore(props.session.id)
                  .catch(() => {})
              }
            >
              {ctx.t(messages().loading(props.session.id) ? "load.loading" : "load.more")}
            </button>
          </div>
        </Show>
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
    <DayGroups items={props.items} layout="grid">
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
  layout: "grid" | "list"
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
            <div data-slot={props.layout === "grid" ? "media-panel-grid" : "media-panel-list"}>
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

function FileRow(props: { item: FileItem; directory: string; openPath: (path: string) => void }) {
  const ctx = usePlugin<typeof Media>()

  const href = () => {
    const source = props.item.source

    return source?.type === "url" ? source.url : undefined
  }

  // The folder the file sits in, relative to the session's directory when it is inside it.
  const folder = () => {
    const path = props.item.path

    if (!path) return undefined
    const root = props.directory.replace(/\/+$/, "") + "/"
    const relative = path.startsWith(root) ? path.slice(root.length) : path
    const split = relative.lastIndexOf("/")

    return split > 0 ? relative.slice(0, split) : undefined
  }

  const content = () => (
    <Row
      icon={<FileIcon node={{ path: props.item.name, type: "file" }} />}
      title={props.item.name}
      place={folder()}
      action={ctx.t(`file.${props.item.from}.${props.item.action}`)}
      time={props.item.time}
      opens={!!props.item.path || !!href()}
    />
  )

  return (
    <Switch fallback={<div data-slot="media-row">{content()}</div>}>
      <Match when={props.item.path}>
        {(path) => (
          <button type="button" data-slot="media-row" title={path()} onClick={() => props.openPath(path())}>
            {content()}
          </button>
        )}
      </Match>
      <Match when={href()}>
        {(url) => (
          <a data-slot="media-row" href={url()} download={props.item.name}>
            {content()}
          </a>
        )}
      </Match>
    </Switch>
  )
}

function LinkRow(props: { item: LinkItem; openURL: (url: string) => void }) {
  const ctx = usePlugin<typeof Media>()

  // The page without its scheme, `www.` or trailing slash, as the address bar would show it.
  const page = () => {
    const url = new URL(props.item.url)

    return `${url.pathname.replace(/\/+$/, "")}${url.search}`
  }

  return (
    <a
      data-slot="media-row"
      href={props.item.url}
      title={props.item.url}
      onClick={(event) => {
        event.preventDefault()
        props.openURL(props.item.url)
      }}
    >
      <Row
        icon={<SiteIcon site={props.item.site} host={props.item.host} mode="letters" />}
        title={props.item.title ?? `${props.item.site}${page()}`}
        place={props.item.title ? `${props.item.site}${page()}` : undefined}
        action={ctx.t(`link.${props.item.from}.${props.item.via}`)}
        time={props.item.time}
        opens
      />
    </a>
  )
}

/** A file or link row's content: its icon tile, title, where it is and who did what, and the time. */
function Row(props: {
  icon: JSX.Element
  title: string
  place?: string
  action: string
  time: number
  opens: boolean
}) {
  return (
    <>
      <span data-slot="media-row-icon">{props.icon}</span>
      <span data-slot="media-row-text">
        <span data-slot="media-row-title">{props.title}</span>
        <span data-slot="media-row-detail">
          <Show when={props.place}>
            {(place) => (
              <>
                <span data-slot="media-row-place">{place()}</span>
                <span data-slot="media-row-separator" aria-hidden="true">
                  ·
                </span>
              </>
            )}
          </Show>
          <span data-slot="media-row-action">{props.action}</span>
        </span>
      </span>
      <span data-slot="media-row-end">
        <time datetime={new Date(props.time).toISOString()}>{timeFormat.format(props.time)}</time>
        <Show when={props.opens}>
          <Icon name="outline-arrow-up-right" size="small" />
        </Show>
      </span>
    </>
  )
}
