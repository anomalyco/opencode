import type { Key } from "~/i18n"
import { Marked } from "./marked"
import "./changelog-entry.css"
import { For, Match, Show, Switch, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { Dynamic } from "solid-js/web"
import { config } from "~/config"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { inlineKey } from "~/lib/direction"
import {
  areaLabel,
  bodyBlocks,
  changelogQuery,
  type ChangelogEntry,
  type ChangelogMedia,
  type ChangelogNote,
  type ChangelogView,
} from "~/lib/changelog-notes"
import { CarouselArrows } from "./carousel-arrows"
import { carouselDrag, revealChosenFilter, timelineRail } from "./changelog-motion"
import { Chevron, ExternalArrow, NewTab } from "./icons"
import { Inline, ReleaseItem } from "./release"
import { prefersReducedMotion } from "./media"
import {
  changelogCarousels,
  changelogFilters,
  changelogMarkers,
  changelogTitleSizes,
  changelogTitles,
  setSiteSetting,
  siteSettings,
  toggles,
} from "./settings"
import { SettingsSelect, type SettingsSectionID } from "./site"
import { SiteMenu } from "./site-menu"
import { staticRender } from "~/lib/static-render"

/** A changelog day as the site shows it, in UTC so it matches the day releases are grouped by. */
export function formatDay(date: string, locale: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

/** An entry's page, `/changelog/<newest tag>`; `hash` adds an anchor on it. */
export function entryPath(entry: ChangelogEntry, hash?: string) {
  return `/changelog/${entry.releases[0].tag}${hash ? `#${hash}` : ""}`
}

/** A heading's id: the entry's tag and the title, so links to one feature stay unique across the page. */
function sectionId(entry: ChangelogEntry, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${entry.releases[0].tag}-${slug}`
}

/** What the changelog shows when GitHub's releases could not be loaded and none were cached. */
export function ChangelogUnavailable() {
  const i18n = useI18n()
  return (
    <p data-slot="lead">
      {i18n.t("changelog.unavailable")}{" "}
      <a href={`${config.github.repoUrl}/releases`} target="_blank" rel="noopener noreferrer">
        {i18n.t("changelog.viewReleases")}
        <ExternalArrow />
      </a>
    </p>
  )
}

/** The Settings › Other row for pages with a changelog. */
export function ChangelogSettings(props: { section: SettingsSectionID }) {
  return (
    <Show when={props.section === "other"}>
      <SettingsSelect
        label="Changelog sticky"
        options={toggles}
        value={siteSettings.changelogSticky}
        onChange={(value) => setSiteSetting("changelogSticky", value)}
      />
      <SettingsSelect
        label="Changelog marker"
        options={changelogMarkers}
        value={siteSettings.changelogMarker}
        onChange={(value) => setSiteSetting("changelogMarker", value)}
      />
      <SettingsSelect
        label="Changelog title"
        options={changelogTitles}
        value={siteSettings.changelogTitle}
        onChange={(value) => setSiteSetting("changelogTitle", value)}
      />
      <SettingsSelect
        label="Changelog title size"
        options={changelogTitleSizes}
        value={siteSettings.changelogTitleSize}
        onChange={(value) => setSiteSetting("changelogTitleSize", value)}
      />
      <SettingsSelect
        label="Changelog carousel"
        options={changelogCarousels}
        value={siteSettings.changelogCarousel}
        onChange={(value) => setSiteSetting("changelogCarousel", value)}
      />
      <SettingsSelect
        label="Changelog filters"
        options={changelogFilters}
        value={siteSettings.changelogFilters}
        onChange={(value) => setSiteSetting("changelogFilters", value)}
      />
    </Show>
  )
}

/**
 * The changelog's tools under the page title: the area filter (links, so a filter is a URL you can
 * share, and works before the page's code loads) and the Subscribe menu. By default the filter is
 * the product areas, in one row that scrolls sideways on a phone; Settings › Changelog filters
 * "all headings" shows a chip for every section heading instead.
 */
export function ChangelogToolbar(props: { view: ChangelogView }) {
  const i18n = useI18n()
  const language = useLanguage()
  const href = (filter: string[]) => language.route(`/changelog${changelogQuery({ filter })}`)
  const toggle = (key: string) =>
    props.view.filter.includes(key) ? props.view.filter.filter((item) => item !== key) : [...props.view.filter, key]
  let nav!: HTMLElement
  onMount(() => revealChosenFilter(nav))
  return (
    <div
      data-component="changelog-toolbar"
      data-filters={siteSettings.changelogFilters === "all headings" ? "headings" : "areas"}
      data-design="changelogFilters"
    >
      <nav ref={nav} data-slot="filter" aria-label={i18n.t("changelog.filter.label")}>
        <a href={href([])} aria-current={props.view.filter.length === 0 ? "true" : undefined}>
          {i18n.t("changelog.filter.all")}
        </a>
        <For each={siteSettings.changelogFilters === "all headings" ? props.view.headings : props.view.areas}>
          {(area) => (
            <a href={href(toggle(area.key))} aria-current={props.view.filter.includes(area.key) ? "true" : undefined}>
              {area.key in areaNames ? i18n.t(areaNames[area.key as keyof typeof areaNames]) : area.label}
            </a>
          )}
        </For>
      </nav>
      <ChangelogSubscribe filter={props.view.filter} />
    </div>
  )
}

/** Subscribe: the RSS feed (with the current filter), watching releases on GitHub, and X. */
function ChangelogSubscribe(props: { filter: string[] }) {
  const i18n = useI18n()
  const language = useLanguage()
  return (
    <div data-slot="subscribe">
      <SiteMenu
        label={i18n.t("changelog.subscribe")}
        align="end"
        trigger={
          <>
            {i18n.t("changelog.subscribe")}
            <Chevron />
          </>
        }
        items={[
          {
            label: i18n.t("changelog.subscribe.rss"),
            href: language.route(`/changelog.xml${changelogQuery({ filter: props.filter })}`),
            external: true,
          },
          { label: i18n.t("changelog.subscribe.github"), href: `${config.github.repoUrl}/releases`, external: true },
          { label: i18n.t("changelog.subscribe.x"), href: config.social.twitter, external: true },
        ]}
      />
    </div>
  )
}

/** Links to the newer and older pages of the changelog, keeping its filter. */
export function ChangelogPages(props: { view: ChangelogView }) {
  const i18n = useI18n()
  const language = useLanguage()
  const href = (page: number) => language.route(`/changelog${changelogQuery({ page, filter: props.view.filter })}`)
  return (
    <Show when={props.view.pages > 1}>
      <nav data-component="changelog-pages" aria-label={i18n.t("changelog.pages.label")}>
        <Show when={props.view.page > 1}>
          <a href={href(props.view.page - 1)} rel="prev">
            <span data-slot="arrow-back">←</span> {i18n.t("changelog.pages.newer")}
          </a>
        </Show>
        <span data-slot="position">
          {i18n.t("changelog.pages.position", { page: props.view.page, pages: props.view.pages })}
        </span>
        <Show when={props.view.page < props.view.pages}>
          <a href={href(props.view.page + 1)} rel="next">
            {i18n.t("changelog.pages.older")} <span data-slot="arrow-forward">→</span>
          </a>
        </Show>
      </nav>
    </Show>
  )
}

/**
 * The changelog as a vertical timeline. A rail runs down the first column with a square marker,
 * the date (once per day) and the version per entry. With Changelog marker set to "active square",
 * only the entry being read (the one whose date is stuck at the top) has a filled marker; with
 * "progress", a line fills the rail down to the reading line and every marker it passes stays
 * filled. The title and notes sit in the second and third columns. With Changelog sticky on, an
 * entry's marker, date and version stay in view until the next entry pushes them off.
 */
export function ChangelogTimeline(props: {
  entries: ChangelogEntry[]
  /** The entry titles' heading level: 1 on an entry's own page, 2 on the changelog page, 3 under a page section's h2. */
  level: 1 | 2 | 3
  /** Lists longer than this collapse (or, with `more`, link to the entry's page for the rest). */
  limit: number
  /** Product pages link the rest of a long list to the entry's page. */
  more?: boolean
}) {
  const language = useLanguage()
  let list!: HTMLOListElement

  onMount(() => onCleanup(timelineRail(list)))

  return (
    <ol
      ref={list}
      data-component="changelog-timeline"
      data-sticky={siteSettings.changelogSticky === "on" ? "" : undefined}
      data-marker={siteSettings.changelogMarker === "progress" ? "progress" : "active"}
      data-title={siteSettings.changelogTitle}
      data-title-size={siteSettings.changelogTitleSize.replace(" · ", "-")}
      data-design="changelogSticky changelogMarker changelogTitle changelogTitleSize changelogCarousel"
    >
      <For each={props.entries}>
        {(entry, index) => {
          // The date shows once per day: later entries from the same day only show their version.
          const sameDay = () => index() > 0 && props.entries[index() - 1]?.date === entry.date
          return (
            <li id={entry.releases[0].tag}>
              {/* Every release in the entry is a target, in this page's form (v2.2.5) and the old
                  changelog's (v2-2-5), so links to either land here. */}
              <For each={entry.releases}>
                {(release, position) => (
                  <>
                    <Show when={position() > 0}>
                      <span id={release.tag} data-slot="anchor" />
                    </Show>
                    <span id={release.tag.replaceAll(".", "-")} data-slot="anchor" />
                  </>
                )}
              </For>
              <header>
                <span data-slot="marker" aria-hidden="true" />
                <time dateTime={entry.date} data-same-day={sameDay() ? "" : undefined}>
                  {formatDay(entry.date, language.tag(language.locale()))}
                </time>
                <a data-slot="version" href={language.route(entryPath(entry))}>
                  {entry.releases[0].tag}
                  <Show when={entry.releases.length > 1}>
                    <span data-slot="more-versions"> +{entry.releases.length - 1}</span>
                  </Show>
                </a>
              </header>
              <EntryBody
                entry={entry}
                level={props.level}
                media={entryMedia(entry)}
                limit={props.limit}
                more={props.more ? language.route(entryPath(entry)) : undefined}
              />
            </li>
          )
        }}
      </For>
    </ol>
  )
}

/** One slide: an image or video from the release notes. */
type Slide = ChangelogMedia & { poster?: string }

/**
 * An entry's media: the images and videos in its release notes. With none, the entry has no media
 * slot at all. /dev/components previews the carousel with sample media.
 */
function entryMedia(entry: ChangelogEntry): Slide[] | undefined {
  return entry.media.length > 0 ? entry.media : undefined
}

/**
 * An entry's media: one 16:9 slot, a carousel when it holds more than one slide. Settings ›
 * Changelog carousel picks how it shows that: bars under it (each a 24px target), plus a count,
 * arrows, the next slide peeking in, or a bar that fills while the slides advance on their own
 * (paused on hover, focus and off screen; never with reduced motion). The arrow keys step through
 * the slides from the bars. Each slide is labelled with its text alternative. The static pages drive
 * the same markup from src/client/islands/changelog.ts: change both together.
 */
function EntryCarousel(props: { slides: Slide[]; title: string }) {
  const i18n = useI18n()
  const [index, setIndex] = createSignal(0)
  const [visible, setVisible] = createSignal(false)
  const [held, setHeld] = createSignal(false)
  // How far a drag has moved the track from the current slide, in pixels.
  const [drag, setDrag] = createSignal(0)
  const [dragging, setDragging] = createSignal(false)
  const count = () => props.slides.length
  const current = () => Math.min(index(), count() - 1)
  const go = (next: number) => setIndex((next + count()) % count())
  const label = (slide: Slide) => slide.alt || `${i18n.t("changelog.media.video")}: ${props.title}`
  let figure!: HTMLElement
  let viewport!: HTMLDivElement
  let track!: HTMLDivElement
  let bars: HTMLDivElement | undefined

  onMount(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting))
    observer.observe(figure)
    const stop = carouselDrag(viewport, track, {
      count,
      index: current,
      go: setIndex,
      drag: (offset, on) => {
        setDrag(offset)
        setDragging(on)
      },
    })
    onCleanup(() => {
      observer.disconnect()
      stop()
    })
  })

  // Stops the product pages' arrow-key navigation too, which skips handled events.
  const keys = (event: KeyboardEvent) => {
    const key = inlineKey(event)
    if (key !== "ArrowLeft" && key !== "ArrowRight") return
    event.preventDefault()
    go(current() + (key === "ArrowRight" ? 1 : -1))
    bars?.querySelectorAll("button")[current()]?.focus()
  }

  return (
    <figure
      ref={figure}
      data-slot="media"
      role={count() > 1 ? "region" : undefined}
      aria-roledescription={count() > 1 ? "carousel" : undefined}
      aria-label={`${i18n.t("changelog.media.label")}: ${props.title}`}
      data-carousel={siteSettings.changelogCarousel}
      data-paused={held() || dragging() || !visible() ? "" : undefined}
      data-draggable={count() > 1 ? "" : undefined}
      data-dragging={dragging() ? "" : undefined}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHeld(false)
      }}
    >
      <div ref={viewport} data-slot="viewport">
        <div ref={track} data-slot="slides" style={{ "--index": String(current()), "--drag": `${drag()}px` }}>
          <For each={props.slides}>
            {(slide, position) => (
              <div
                data-slot="slide"
                data-active={position() === current() ? "" : undefined}
                role="group"
                aria-roledescription={count() < 2 ? undefined : "slide"}
                aria-label={
                  count() > 1
                    ? `${i18n.t("changelog.media.slide", { n: position() + 1, count: count() })}: ${label(slide)}`
                    : label(slide)
                }
                aria-hidden={position() !== current() ? "true" : undefined}
                inert={position() !== current()}
              >
                <Switch>
                  <Match when={slide.type === "image" && slide}>
                    {(image) => <img src={image().src} alt={image().alt} loading="lazy" draggable={false} />}
                  </Match>
                  <Match when={slide.type === "video" && slide}>
                    {(video) => (
                      <EntryVideo
                        src={video().src}
                        poster={video().poster}
                        label={label(video())}
                        playing={visible() && position() === current()}
                      />
                    )}
                  </Match>
                </Switch>
              </div>
            )}
          </For>
        </div>
      </div>
      <Show when={count() > 1}>
        <div data-slot="carousel-nav">
          <div ref={bars} data-slot="bars" role="group" aria-label={i18n.t("changelog.media.label")} onKeyDown={keys}>
            <For each={props.slides}>
              {(_, slide) => (
                <button
                  type="button"
                  aria-label={i18n.t("changelog.media.slide", { n: slide() + 1, count: count() })}
                  aria-current={slide() === current() ? "true" : undefined}
                  onClick={() => setIndex(slide())}
                >
                  <span data-slot="bar" onAnimationEnd={() => go(current() + 1)} />
                </button>
              )}
            </For>
          </div>
          <Show when={siteSettings.changelogCarousel === "bars + count"}>
            <span data-slot="count">
              {current() + 1}/{count()}
            </span>
          </Show>
          <Show when={siteSettings.changelogCarousel === "bars + arrows"}>
            <CarouselArrows
              data-slot="arrows"
              previous={i18n.t("changelog.media.previous")}
              next={i18n.t("changelog.media.next")}
              onPrevious={() => go(current() - 1)}
              onNext={() => go(current() + 1)}
            />
          </Show>
        </div>
      </Show>
    </figure>
  )
}

/**
 * A muted loop that plays only while it is the slide showing and on screen; with reduced motion,
 * only its poster shows. A pause button stops it for good (WCAG 2.2.2), and play starts it again.
 * Static pages: src/client/islands/changelog.ts.
 */
function EntryVideo(props: { src: string; poster?: string; label: string; playing: boolean }) {
  const i18n = useI18n()
  const [stopped, setStopped] = createSignal(false)
  const [running, setRunning] = createSignal(false)
  let video!: HTMLVideoElement
  createEffect(() => {
    if (props.playing && !stopped() && !prefersReducedMotion()) return void video.play().catch(() => {})
    video.pause()
  })
  return (
    <>
      <video
        ref={video}
        src={props.src}
        poster={props.poster}
        aria-label={props.label}
        muted
        loop
        playsinline
        preload="none"
        draggable={false}
        onPlay={() => setRunning(true)}
        onPause={() => setRunning(false)}
      />
      {/* A static page's script (src/client/islands/changelog.ts) switches the label to data-pause as the video plays. */}
      <button
        type="button"
        data-slot="play"
        aria-label={running() ? i18n.t("changelog.media.pause") : i18n.t("changelog.media.play")}
        data-pause={staticRender() ? i18n.t("changelog.media.pause") : undefined}
        onClick={() => {
          if (running()) {
            setStopped(true)
            return video.pause()
          }
          setStopped(false)
          void video.play().catch(() => {})
        }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
          <Show when={running()} fallback={<path d="M3 1.5v9l7.5-4.5z" />}>
            <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" />
          </Show>
        </svg>
      </button>
    </>
  )
}

/**
 * A heading whose text copies its link: a click copies the permalink (`href`), puts `hash` in the
 * address bar and says "Link copied" for a moment (aria-live). It is a real link, so the keyboard
 * reaches it, and a modified or middle click still opens it. The site-wide rule (set on /press):
 * no "#" after headings. Swap for the shared heading helper in on-this-page.tsx once it has one.
 * Static pages: src/client/islands/changelog.ts.
 */
function CopyHeading(props: { href: string; hash: string; text: string }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  return (
    <a
      data-slot="copy-heading"
      href={props.href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
        event.preventDefault()
        history.replaceState(history.state, "", `#${props.hash}`)
        void navigator.clipboard.writeText(new URL(props.href, location.origin).href).then(() => {
          setCopied(true)
          clearTimeout(timer)
          timer = setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      <Inline text={props.text} />
      <span data-slot="copied" aria-live="polite">
        {copied() ? i18n.t("changelog.share.copied") : ""}
      </span>
    </a>
  )
}

/** The pull requests and people a note credits, after its text: "#123 · @user". */
function Refs(props: { refs: { prs: string[]; credits: string[] } }) {
  return (
    <Show when={props.refs.prs.length + props.refs.credits.length > 0}>
      <span data-slot="refs">
        <For each={props.refs.prs}>
          {(pr) => (
            <a href={`${config.github.repoUrl}/pull/${pr}`} target="_blank" rel="noopener noreferrer">
              #{pr}
            </a>
          )}
        </For>
        <For each={props.refs.credits}>
          {(user) => (
            <a data-slot="author" href={`https://github.com/${user}`} target="_blank" rel="noopener noreferrer">
              @{user}
            </a>
          )}
        </For>
      </span>
    </Show>
  )
}

/** Copies a link to the clipboard and says so (static pages: src/client/islands/changelog.ts). */
export function CopyLink(props: { href: string }) {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  return (
    <button
      type="button"
      data-slot="copy-link"
      onClick={() => {
        void navigator.clipboard.writeText(new URL(props.href, location.origin).href).then(() => {
          setCopied(true)
          clearTimeout(timer)
          timer = setTimeout(() => setCopied(false), 2000)
        })
      }}
    >
      <span aria-live="polite">{copied() ? i18n.t("changelog.share.copied") : i18n.t("changelog.share.copy")}</span>
    </button>
  )
}

// The product areas' names in the page's language; one-off headings from old releases stay as written.
const areaNames = {
  desktop: "changelog.area.desktop",
  core: "changelog.area.core",
  terminal: "changelog.area.terminal",
  sdk: "changelog.area.sdk",
  extensions: "changelog.area.extensions",
} as const satisfies Record<string, Key>

/** An entry's title and notes: the summary, the other highlights, then breaking changes, improvements and fixes. */
function EntryBody(props: { entry: ChangelogEntry; level: 1 | 2 | 3; media?: Slide[]; limit: number; more?: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  const page = () => language.route(entryPath(props.entry))
  const share = () =>
    `https://x.com/intent/post?text=${encodeURIComponent(props.entry.title)}&url=${encodeURIComponent(`${config.baseUrl}${page()}`)}`
  return (
    <div data-component="changelog-entry">
      {/* The notes are in English on every locale: lang="en" dir="auto" sets each block left to right in an
          Arabic page, so its punctuation and code stay in place. */}
      <Dynamic component={`h${props.level}`} data-slot="title" lang="en" dir="auto">
        <CopyHeading href={page()} hash={props.entry.releases[0].tag} text={props.entry.title} />
      </Dynamic>
      <Show when={props.media}>{(slides) => <EntryCarousel slides={slides()} title={props.entry.title} />}</Show>
      <Show when={props.entry.summary}>
        <p data-slot="summary" lang="en" dir="auto">
          <Inline text={props.entry.summary} />
          <Refs refs={props.entry.refs} />
        </p>
      </Show>

      <For each={props.entry.features}>
        {(feature) => (
          <section data-slot="feature">
            <Dynamic
              component={`h${props.level + 1}`}
              data-slot="subhead"
              id={sectionId(props.entry, feature.title)}
              lang="en"
              dir="auto"
            >
              <CopyHeading
                href={`${page()}#${sectionId(props.entry, feature.title)}`}
                hash={sectionId(props.entry, feature.title)}
                text={feature.title}
              />
            </Dynamic>
            <Show when={feature.body || feature.prs.length > 0}>
              <p lang="en" dir="auto">
                <Inline text={feature.body} />
                <Refs refs={feature} />
              </p>
            </Show>
          </section>
        )}
      </For>
      <Show when={props.entry.hiddenFeatures > 0}>
        <a data-slot="all-highlights" href={page()}>
          {i18n.t("changelog.highlights.all", { tag: props.entry.releases[0].tag })}
        </a>
      </Show>

      <Show when={props.entry.breaking.length > 0}>
        <section data-slot="group" data-kind="breaking">
          <Dynamic component={`h${props.level + 1}`} data-slot="group-label">
            {i18n.t("changelog.breaking")}
          </Dynamic>
          <For each={props.entry.breaking}>
            {(change) => (
              <div data-slot="breaking">
                <Show when={change.title}>
                  <Dynamic
                    component={`h${props.level + 2}`}
                    data-slot="subhead"
                    id={sectionId(props.entry, change.title)}
                    lang="en"
                    dir="auto"
                  >
                    <CopyHeading
                      href={`${page()}#${sectionId(props.entry, change.title)}`}
                      hash={sectionId(props.entry, change.title)}
                      text={change.title}
                    />
                  </Dynamic>
                </Show>
                <For each={bodyBlocks(change.body)}>
                  {(block) => (
                    <Switch>
                      <Match when={block.type === "p" && block}>
                        {(p) => (
                          <p lang="en" dir="auto">
                            <Inline text={p().text} />
                          </p>
                        )}
                      </Match>
                      <Match when={block.type === "list" && block}>
                        {(list) => (
                          <ul>
                            <For each={list().items}>{(item) => <ReleaseItem item={item} />}</For>
                          </ul>
                        )}
                      </Match>
                      <Match when={block.type === "code" && block}>
                        {(code) => (
                          // Focusable so keyboard users can scroll a long line.
                          <pre tabIndex={0}>
                            <code>{code().text}</code>
                          </pre>
                        )}
                      </Match>
                    </Switch>
                  )}
                </For>
                <Refs refs={change} />
              </div>
            )}
          </For>
        </section>
      </Show>

      <NoteGroup
        title={i18n.t("changelog.improvements")}
        level={props.level + 1}
        notes={props.entry.improved}
        limit={props.limit}
        more={props.more}
      />
      <NoteGroup
        title={i18n.t("changelog.fixes")}
        level={props.level + 1}
        notes={props.entry.fixed}
        limit={props.limit}
        more={props.more}
      />

      <footer data-slot="meta">
        <For each={props.entry.releases}>
          {(release) => (
            <a href={release.url} target="_blank" rel="noopener noreferrer">
              <Marked text={i18n.t("changelog.releaseOnGithub", { tag: release.tag })} slots={{ sr: "sr-only" }} />
              <ExternalArrow />
              <NewTab />
            </a>
          )}
        </For>
        <CopyLink href={page()} />
        <Show when={props.level === 1}>
          <a href={share()} target="_blank" rel="noopener noreferrer">
            {i18n.t("changelog.share.x")}
            <NewTab />
          </a>
        </Show>
      </footer>
    </div>
  )
}

/**
 * Improvements or fixes. A list longer than `limit` collapses behind its heading (a disclosure that
 * says how many there are), or, on product pages, shows the first few and links to the entry's
 * page for the rest.
 */
function NoteGroup(props: { title: string; level: number; notes: ChangelogNote[]; limit: number; more?: string }) {
  const i18n = useI18n()
  const items = (notes: ChangelogNote[]) => (
    <ul>
      <For each={notes}>
        {(note) => (
          <ReleaseItem item={note.text} label={note.areas.map(areaLabel).join(", ")}>
            <Refs refs={note} />
          </ReleaseItem>
        )}
      </For>
    </ul>
  )
  const long = () => props.notes.length > props.limit
  return (
    <Show when={props.notes.length > 0}>
      <Switch>
        <Match when={long() && !props.more}>
          <details data-slot="group">
            <summary>
              <Dynamic component={`h${props.level}`} data-slot="group-label">
                {props.title}
                <span data-slot="count"> {props.notes.length}</span>
              </Dynamic>
              <Chevron />
            </summary>
            {items(props.notes)}
          </details>
        </Match>
        <Match when={true}>
          <section data-slot="group">
            <Dynamic component={`h${props.level}`} data-slot="group-label">
              {props.title}
            </Dynamic>
            {items(long() ? props.notes.slice(0, props.limit) : props.notes)}
            <Show when={long() && props.more}>
              {(_) => (
                <a data-slot="show-more" href={props.more}>
                  {i18n.t("changelog.list.more", { count: props.notes.length - props.limit })}
                  <span data-slot="sr-only"> {props.title.toLowerCase()}</span>
                </a>
              )}
            </Show>
          </section>
        </Match>
      </Switch>
    </Show>
  )
}
