import { createMemo, createSignal, For, Show } from "solid-js"
import { Icon } from "@opencode/ui/icon"
import { usePlugin } from "@opencode/plugin/gui"
import type { SessionMedia } from "@opencode/schema/session-media"
import type Media from "./index"
import { groupLinks } from "./link-groups"

type Link = SessionMedia.Link

/** Chips a group shows before a `+N` that shows the rest. */
const LIMIT = 12

/**
 * The session's links by where they live, as chips: a GitHub repository's issues and pull requests as `#123`, any other
 * page by its title. Groups and chips are newest first.
 */
export function LinkGroups(props: { links: readonly Link[]; openURL: (url: string) => void }) {
  const ctx = usePlugin<typeof Media>()
  const groups = createMemo(() => groupLinks(props.links))
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())

  const tooltip = (link: Link) =>
    [
      ...new Set([link.title ?? link.url, link.url]),
      `${ctx.t(`link.${link.from}.${link.via}`)} · ${timeFormat.format(link.time)}`,
    ].join("\n")

  return (
    <div data-slot="media-links">
      <For each={groups()}>
        {(group) => {
          const shown = () => (expanded().has(group.key) ? group.chips : group.chips.slice(0, LIMIT))

          return (
            <section data-slot="media-link-group">
              <div data-slot="media-link-group-header">
                <SiteIcon hostname={group.hostname} github={group.github} />
                <span data-slot="media-link-group-label">{group.label}</span>
                <span data-slot="media-link-group-count">{group.chips.length}</span>
              </div>
              <div data-slot="media-link-chips">
                <For each={shown()}>
                  {(chip) => (
                    <a
                      data-slot="media-link"
                      data-ref={chip.ref ? "" : undefined}
                      href={chip.link.url}
                      title={tooltip(chip.link)}
                      onClick={(event) => {
                        event.preventDefault()
                        props.openURL(chip.link.url)
                      }}
                    >
                      {chip.label}
                    </a>
                  )}
                </For>
                <Show when={group.chips.length > shown().length}>
                  <button
                    type="button"
                    data-slot="media-link-more"
                    onClick={() => setExpanded((previous) => new Set([...previous, group.key]))}
                  >
                    {ctx.t("links.more", { count: group.chips.length - shown().length })}
                  </button>
                </Show>
              </div>
            </section>
          )
        }}
      </For>
    </div>
  )
}

/**
 * The site's favicon, as the timeline's links show it: GitHub's mark, a public site's icon, and a globe for a private
 * host or until the icon loads.
 */
function SiteIcon(props: { hostname: string; github: boolean }) {
  const [loaded, setLoaded] = createSignal(false)

  const src = () =>
    isPublic(props.hostname)
      ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(props.hostname)}&sz=32`
      : undefined

  return (
    <span data-slot="media-link-icon" data-loaded={loaded() ? "" : undefined} aria-hidden="true">
      <Show when={!props.github} fallback={<Icon name="github" size="small" />}>
        <Show when={!loaded()}>
          <Icon name="outline-globe" size="small" />
        </Show>
        <Show when={src()}>
          {(url) => <img src={url()} alt="" decoding="async" draggable={false} onLoad={() => setLoaded(true)} />}
        </Show>
      </Show>
    </span>
  )
}

const PUBLIC_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

const PRIVATE_SUFFIX = /\.(?:alt|example|internal|invalid|local|localhost|onion|test|ts\.net)$/

// Only a public host's name goes to the favicon service; a local or private one stays on the machine.
function isPublic(hostname: string) {
  const host = hostname.toLowerCase()

  return PUBLIC_HOST.test(host) && !PRIVATE_SUFFIX.test(host) && host !== "home.arpa" && !host.endsWith(".home.arpa")
}

const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
