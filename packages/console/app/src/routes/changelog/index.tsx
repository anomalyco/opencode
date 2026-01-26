import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { createAsync, useSearchParams } from "@solidjs/router"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { config } from "~/config"
import { For, Show, createSignal, onMount } from "solid-js"
import { getRequestEvent } from "solid-js/web"

type HighlightMedia = { type: "video"; src: string } | { type: "image"; src: string; width: string; height: string }

type HighlightItem = {
  title: string
  description: string
  shortDescription?: string
  media: HighlightMedia
}

type HighlightGroup = {
  source: string
  items: HighlightItem[]
}

type ChangelogRelease = {
  tag: string
  name: string
  date: string
  url: string
  highlights: HighlightGroup[]
  sections: { title: string; items: string[] }[]
}

type LoadMeta = {
  endpoint: string
  ssr: boolean
  hasEvent: boolean
  ok: boolean
  status?: number
  contentType?: string
  error?: string
}

type Load = {
  releases: ChangelogRelease[]
  meta: LoadMeta
}

function endpoint() {
  const event = getRequestEvent()
  if (event) return new URL("/changelog.json", event.request.url).toString()
  if (!import.meta.env.SSR) return "/changelog.json"
  return `${config.baseUrl}/changelog.json`
}

async function getReleases(debug = false): Promise<Load> {
  const url = endpoint()
  const meta = {
    endpoint: url,
    ssr: import.meta.env.SSR,
    hasEvent: Boolean(getRequestEvent()),
    ok: false,
  } satisfies LoadMeta

  const response = await fetch(url).catch((err) => {
    console.error("[changelog] fetch failed", {
      ...meta,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  })

  if (!response) return { releases: [], meta: { ...meta, error: "fetch_failed" } }
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? undefined
    const body = debug ? await response.text().catch(() => undefined) : undefined
    console.error("[changelog] fetch non-ok", {
      ...meta,
      status: response.status,
      contentType,
      body: body?.slice(0, 300),
    })
    return { releases: [], meta: { ...meta, status: response.status, contentType, error: "bad_status" } }
  }

  const contentType = response.headers.get("content-type") ?? undefined
  const copy = debug ? response.clone() : undefined
  const json = await response.json().catch(async (err) => {
    const body = copy ? await copy.text().catch(() => undefined) : undefined
    console.error("[changelog] json parse failed", {
      ...meta,
      status: response.status,
      contentType,
      error: err instanceof Error ? err.message : String(err),
      body: body?.slice(0, 300),
    })
    return undefined
  })

  const releases = Array.isArray(json?.releases) ? (json.releases as ChangelogRelease[]) : []
  if (!releases.length) {
    console.error("[changelog] empty releases", {
      ...meta,
      status: response.status,
      contentType,
      keys: json && typeof json === "object" ? Object.keys(json) : undefined,
    })
  }

  return {
    releases,
    meta: { ...meta, ok: true, status: response.status, contentType },
  }
}

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function ReleaseItem(props: { item: string }) {
  const parts = () => {
    const match = props.item.match(/^(.+?)(\s*\(@([\w-]+)\))?$/)
    if (match) {
      return {
        text: match[1],
        username: match[3],
      }
    }
    return { text: props.item, username: undefined }
  }

  return (
    <li>
      <span>{parts().text}</span>
      <Show when={parts().username}>
        <a data-slot="author" href={`https://github.com/${parts().username}`} target="_blank" rel="noopener noreferrer">
          (@{parts().username})
        </a>
      </Show>
    </li>
  )
}

function HighlightSection(props: { group: HighlightGroup }) {
  return (
    <div data-component="highlight">
      <h4>{props.group.source}</h4>
      <hr />
      <For each={props.group.items}>
        {(item) => (
          <div data-slot="highlight-item">
            <p data-slot="title">{item.title}</p>
            <p>{item.description}</p>
            <Show when={item.media.type === "video"}>
              <video src={item.media.src} controls autoplay loop muted playsinline />
            </Show>
            <Show when={item.media.type === "image"}>
              <img
                src={item.media.src}
                alt={item.title}
                width={(item.media as { width: string }).width}
                height={(item.media as { height: string }).height}
              />
            </Show>
          </div>
        )}
      </For>
    </div>
  )
}

function CollapsibleSection(props: { section: { title: string; items: string[] } }) {
  const [open, setOpen] = createSignal(false)

  return (
    <div data-component="collapsible-section">
      <button data-slot="toggle" onClick={() => setOpen(!open())}>
        <span data-slot="icon">{open() ? "▾" : "▸"}</span>
        <span>{props.section.title}</span>
      </button>
      <Show when={open()}>
        <ul>
          <For each={props.section.items}>{(item) => <ReleaseItem item={item} />}</For>
        </ul>
      </Show>
    </div>
  )
}

function CollapsibleSections(props: { sections: { title: string; items: string[] }[] }) {
  return (
    <div data-component="collapsible-sections">
      <For each={props.sections}>{(section) => <CollapsibleSection section={section} />}</For>
    </div>
  )
}

export default function Changelog() {
  const [params] = useSearchParams()
  const debug = () => params.debug === "1"
  const data = createAsync(() => getReleases(debug()))
  const [client, setClient] = createSignal<Load | undefined>(undefined)
  const releases = () => client()?.releases ?? data()?.releases ?? []

  onMount(() => {
    queueMicrotask(async () => {
      const server = data()?.releases
      if (!server) return
      if (server.length) return

      const next = await getReleases(debug())
      setClient(next)
    })
  })

  return (
    <main data-page="changelog">
      <Title>OpenCode | Changelog</Title>
      <Link rel="canonical" href={`${config.baseUrl}/changelog`} />
      <Meta name="description" content="OpenCode release notes and changelog" />

      <div data-component="container">
        <Header />

        <div data-component="content">
          <section data-component="changelog-hero">
            <h1>Changelog</h1>
            <p>New updates and improvements to OpenCode</p>
          </section>

          <section data-component="releases">
            <Show when={releases().length === 0}>
              <p>
                No changelog entries found. <a href="/changelog.json">View JSON</a>
              </p>
            </Show>
            <Show when={debug()}>
              <pre style={{ "font-size": "12px", "line-height": "1.4", padding: "12px" }}>
                {JSON.stringify(
                  {
                    server: data()?.meta,
                    client: client()?.meta,
                  },
                  null,
                  2,
                )}
              </pre>
            </Show>
            <For each={releases()}>
              {(release) => {
                return (
                  <article data-component="release">
                    <header>
                      <div data-slot="version">
                        <a href={release.url} target="_blank" rel="noopener noreferrer">
                          {release.tag}
                        </a>
                      </div>
                      <time dateTime={release.date}>{formatDate(release.date)}</time>
                    </header>
                    <div data-slot="content">
                      <Show when={release.highlights.length > 0}>
                        <div data-component="highlights">
                          <For each={release.highlights}>{(group) => <HighlightSection group={group} />}</For>
                        </div>
                      </Show>
                      <Show when={release.highlights.length > 0 && release.sections.length > 0}>
                        <CollapsibleSections sections={release.sections} />
                      </Show>
                      <Show when={release.highlights.length === 0}>
                        <For each={release.sections}>
                          {(section) => (
                            <div data-component="section">
                              <h3>{section.title}</h3>
                              <ul>
                                <For each={section.items}>{(item) => <ReleaseItem item={item} />}</For>
                              </ul>
                            </div>
                          )}
                        </For>
                      </Show>
                    </div>
                  </article>
                )
              }}
            </For>
          </section>
        </div>

        <Footer />
      </div>

      <Legal />
    </main>
  )
}
