import "./index.css"
import { Title, Meta, Link } from "@solidjs/meta"
import { createAsync, query } from "@solidjs/router"
import { Header } from "~/component/header"
import { Footer } from "~/component/footer"
import { Legal } from "~/component/legal"
import { config } from "~/config"
import { For, Show } from "solid-js"

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

type Highlight = {
  source: string
  title: string
  description: string
  shortDescription?: string
  image?: {
    src: string
    width: string
    height: string
  }
  video?: string
}

function parseHighlights(body: string): Highlight[] {
  const highlights: Highlight[] = []
  const regex = /<highlight\s+source="([^"]+)">([\s\S]*?)<\/highlight>/g
  let match

  while ((match = regex.exec(body)) !== null) {
    const source = match[1]
    const content = match[2]

    const titleMatch = content.match(/<h2>([^<]+)<\/h2>/)
    const pMatch = content.match(/<p(?:\s+short="([^"]*)")?>([^<]+)<\/p>/)
    const imgMatch = content.match(/<img\s+width="([^"]+)"\s+height="([^"]+)"\s+alt="([^"]*)"\s+src="([^"]+)"/)
    // Match standalone GitHub asset URLs (videos)
    const videoMatch = content.match(/^\s*(https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+)\s*$/m)

    if (titleMatch) {
      highlights.push({
        source,
        title: titleMatch[1],
        description: pMatch?.[2] || "",
        shortDescription: pMatch?.[1],
        image: imgMatch
          ? {
              width: imgMatch[1],
              height: imgMatch[2],
              src: imgMatch[4],
            }
          : undefined,
        video: videoMatch?.[1],
      })
    }
  }

  return highlights
}

function toTitleCase(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase()
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

function HighlightCard(props: { highlight: Highlight }) {
  return (
    <div data-component="highlight">
      <h4>{props.highlight.source}</h4>
      <p data-slot="title">{props.highlight.title}</p>
      <p>{props.highlight.description}</p>
      <Show when={props.highlight.video}>
        <video src={props.highlight.video} controls autoplay loop muted playsinline />
      </Show>
      <Show when={props.highlight.image && !props.highlight.video}>
        <img
          src={props.highlight.image!.src}
          alt={props.highlight.title}
          width={props.highlight.image!.width}
          height={props.highlight.image!.height}
        />
      </Show>
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
                          <For each={parsed().highlights}>{(highlight) => <HighlightCard highlight={highlight} />}</For>
                        </div>
                      </Show>
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
