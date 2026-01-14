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
    next: { revalidate: 300 },
  })
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

function parseMarkdown(body: string) {
  const lines = body.split("\n")
  const sections: { title: string; items: string[] }[] = []
  let current: { title: string; items: string[] } | null = null
  const contributors: string[] = []
  let inContributors = false

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (current) sections.push(current)
      const title = line.slice(3).trim()
      if (title.toLowerCase().includes("contributor")) {
        inContributors = true
        current = null
      } else {
        inContributors = false
        current = { title, items: [] }
      }
    } else if (line.startsWith("- ") && !inContributors) {
      current?.items.push(line.slice(2).trim())
    } else if (line.startsWith("- @") && inContributors) {
      contributors.push(line.slice(2).trim())
    } else if (line.startsWith("**Thank you")) {
      inContributors = true
    }
  }
  if (current) sections.push(current)

  return { sections, contributors }
}

function ReleaseItem(props: { item: string }) {
  const parts = () => {
    const match = props.item.match(/^(.+?)(\s*\(@[\w-]+\))?$/)
    if (match) {
      return {
        text: match[1],
        author: match[2]?.trim(),
      }
    }
    return { text: props.item, author: undefined }
  }

  return (
    <li>
      <span>{parts().text}</span>
      <Show when={parts().author}>
        <span data-slot="author">{parts().author}</span>
      </Show>
    </li>
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
        <Header hideGetStarted />

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
                      <Show when={parsed().contributors.length > 0}>
                        <div data-component="contributors">
                          <span>Contributors: </span>
                          <For each={parsed().contributors}>
                            {(contributor, i) => (
                              <>
                                <a
                                  href={`https://github.com/${contributor.replace("@", "").split(":")[0]}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {contributor.split(":")[0]}
                                </a>
                                <Show when={i() < parsed().contributors.length - 1}>, </Show>
                              </>
                            )}
                          </For>
                        </div>
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
