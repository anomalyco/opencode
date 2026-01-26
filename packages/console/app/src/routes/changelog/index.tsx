import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { createAsync, query } from "@solidjs/router"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { config } from "~/config"
import { For, Show, createSignal } from "solid-js"

type Release = {
  tag_name: string
  name: string
  body: string
  published_at: string
  html_url: string
}

const getReleases = query(async () => {
  "use server"
  const response = await fetch("https://api.github.com/repos/anomalyco/opencode/releases?per_page=20", {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "OpenCode-Console",
    },
    cf: {
      cacheTtl: 60 * 5,
      cacheEverything: true,
    },
  } as any)
  if (!response.ok) return []
  return response.json() as Promise<Release[]>
}, "releases.get")

function formatDate(dateString: string) {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

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

function parseHighlights(body: string): HighlightGroup[] {
  const groups = new Map<string, HighlightItem[]>()
  const regex = /<highlight\s+source="([^"]+)">([\s\S]*?)<\/highlight>/g
  let match

  while ((match = regex.exec(body)) !== null) {
    const source = match[1]
    const content = match[2]

    const titleMatch = content.match(/<h2>([^<]+)<\/h2>/)
    const pMatch = content.match(/<p(?:\s+short="([^"]*)")?>([^<]+)<\/p>/)
    const imgMatch = content.match(/<img\s+width="([^"]+)"\s+height="([^"]+)"\s+alt="[^"]*"\s+src="([^"]+)"/)
    const videoMatch = content.match(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+)\s*$/m)

    let media: HighlightMedia | undefined
    if (videoMatch) {
      media = { type: "video", src: videoMatch[1] }
    } else if (imgMatch) {
      media = { type: "image", src: imgMatch[3], width: imgMatch[1], height: imgMatch[2] }
    }

    if (titleMatch && media) {
      const item: HighlightItem = {
        title: titleMatch[1],
        description: pMatch?.[2] || "",
        shortDescription: pMatch?.[1],
        media,
      }

      if (!groups.has(source)) {
        groups.set(source, [])
      }
      groups.get(source)!.push(item)
    }
  }

  return Array.from(groups.entries()).map(([source, items]) => ({ source, items }))
}

function parseMarkdown(body: string) {
  const lines = body.split("\n")
  const sections: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null
  let skip = false

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current)
      const title = line.slice(3).trim()
      current = { title, items: [] }
      skip = false
    } else if (line.startsWith("**Thank you")) {
      skip = true
    } else if (line.startsWith("- ") && !skip) {
      current?.items.push(line.slice(2).trim())
    }
  }
  if (current) sections.push(current)

  const highlights = parseHighlights(body)

  return { sections, highlights }
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
                const parsed = () => parseMarkdown(release.body || "")
                return (
                  <article data-component="release">
                    <header>
                      <div data-slot="version">
                        <a href={release.html_url} target="_blank" rel="noopener noreferrer">
                          {release.tag_name}
                        </a>
                      </div>
                      <time dateTime={release.published_at}>{formatDate(release.published_at)}</time>
                    </header>
                    <div data-slot="content">
                      <Show when={parsed().highlights.length > 0}>
                        <div data-component="highlights">
                          <For each={parsed().highlights}>{(group) => <HighlightSection group={group} />}</For>
                        </div>
                      </Show>
                      <Show when={parsed().highlights.length > 0 && parsed().sections.length > 0}>
                        <CollapsibleSections sections={parsed().sections} />
                      </Show>
                      <Show when={parsed().highlights.length === 0}>
                        <For each={parsed().sections}>
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
