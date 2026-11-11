import type { SessionMedia } from "@opencode/schema/session-media"

type Link = SessionMedia.Link

export type LinkChip = {
  readonly link: Link
  readonly label: string
  /** An issue, pull request or discussion number, shown as `#123`. */
  readonly ref: boolean
}

export type LinkGroup = {
  readonly key: string
  readonly label: string
  readonly hostname: string
  readonly github: boolean
  readonly chips: readonly LinkChip[]
}

// GitHub's own pages, whose first two path segments name no repository.
const GITHUB_PAGES =
  /^(?:apps|collections|enterprises|features|login|marketplace|notifications|orgs|search|settings|sponsors|topics|users)$/

/** Links grouped by GitHub repository, else by site, in the order given. */
export function groupLinks(links: readonly Link[]): LinkGroup[] {
  const groups = links.reduce((result, link) => {
    const url = new URL(link.url)
    const [owner, repo, ...rest] = url.pathname.split("/").filter(Boolean)
    const github = link.site === "github.com" && !!owner && !!repo && !GITHUB_PAGES.test(owner)
    const site = url.host.replace(/^www\./, "")
    const key = github ? `github.com/${owner}/${repo}` : site
    const path = github ? rest.join("/") : `${url.pathname.replace(/^\/+|\/+$/g, "")}${url.search}`
    const number = github && /^(issues|pull|discussions)$/.test(rest[0] ?? "") ? rest[1] : undefined
    const ref = !!number && /^\d+$/.test(number)

    const group = result.get(key) ?? {
      key,
      label: github ? `${owner}/${repo}` : site,
      hostname: url.hostname,
      github,
      chips: [],
    }

    return result.set(key, {
      ...group,
      chips: [...group.chips, { link, ref, label: ref ? `#${number}` : (link.title ?? (path || site)) }],
    })
  }, new Map<string, LinkGroup>())

  return [...groups.values()]
}
