import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { createAsync } from "@solidjs/router"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { config } from "~/config"
import { changelog } from "~/lib/changelog"
import type { HighlightGroup } from "~/lib/changelog"
import { For, Show, createSignal } from "solid-js"

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
  const data = createAsync(() => changelog())
  const releases = () => data() ?? []

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
