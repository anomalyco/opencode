import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { createAsync } from "@solidjs/router"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { config } from "~/config"
import { For, Show, createSignal } from "solid-js"
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

async function getReleases() {
  const event = getRequestEvent()
  const url = event ? new URL("/changelog.json", event.request.url).toString() : "/changelog.json"

  const response = await fetch(url).catch(() => undefined)
  if (!response?.ok) return []

  const json = await response.json().catch(() => undefined)
  return Array.isArray(json?.releases) ? (json.releases as ChangelogRelease[]) : []
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
  const releases = createAsync(() => getReleases())

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

          <Footer />
        </div>
      </div>

      <Legal />
    </main>
  )
}
