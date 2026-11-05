import { config } from "~/config"
import {
  areaLabel,
  changelogDays,
  changelogQuery,
  type ChangelogEntry,
  type ChangelogNote,
  type ChangelogView,
} from "~/lib/changelog-notes"
import { blocks, link, type MarkdownContext } from "~/lib/markdown"

/** The changelog page as Markdown: one page of the timeline by day, its filter, and links to the other pages and the feed. */
export function changelogMarkdown(context: MarkdownContext) {
  const view = context.changelog
  if (!view?.ok) return blocks(`# ${context.t("changelog.hero.title")}`, unavailable(context))
  const page = (number: number) => context.route(`/changelog${changelogQuery({ page: number, filter: view.filter })}`)
  const labels = [...view.areas, ...view.headings]
    .filter(
      (area, index, all) => view.filter.includes(area.key) && all.findIndex((item) => item.key === area.key) === index,
    )
    .map((area) => area.label)
  return blocks(
    `# ${context.t("changelog.hero.title")}`,
    context.t("changelog.hero.subtitle"),
    `${link(context.t("changelog.subscribe.rss"), context.route("/changelog.xml"))} · ${link(context.t("changelog.subscribe.github"), `${config.github.repoUrl}/releases`)}`,
    labels.length > 0 &&
      `${context.t("changelog.filter.showing")} ${labels.join(", ")}. ${link(context.t("changelog.filter.all"), context.route("/changelog"))}`,
    view.entries.length === 0 && context.t("changelog.filter.empty"),
    ...changelogDays(view.entries).map((day) =>
      blocks(`## ${day.date}`, ...day.entries.map((entry) => changelogEntryMarkdown(entry, 3, { context }))).trimEnd(),
    ),
    view.pages > 1 &&
      [
        view.page > 1 && link(context.t("changelog.pages.newer"), page(view.page - 1)),
        `${view.page} / ${view.pages}`,
        view.page < view.pages && link(context.t("changelog.pages.older"), page(view.page + 1)),
      ]
        .filter(Boolean)
        .join(" · "),
  )
}

/** One release's page as Markdown: the entry in full, then the newer and older ones and the way back. */
export function changelogEntryPageMarkdown(context: MarkdownContext) {
  const view = context.changelog
  const entry = view?.entries[0]
  if (!view?.ok || !entry) return blocks(`# ${context.t("changelog.hero.title")}`, unavailable(context))
  return blocks(
    changelogEntryMarkdown(entry, 1, { context, dated: true }),
    [
      view.newer && `${context.t("changelog.entry.newer")}: ${neighbour(view.newer, context)}`,
      view.older && `${context.t("changelog.entry.older")}: ${neighbour(view.older, context)}`,
      link(context.t("changelog.entry.back"), context.route("/changelog")),
    ]
      .filter(Boolean)
      .join("\n\n"),
  )
}

/**
 * One timeline entry as Markdown, its title at heading `level` and linked to the entry's page. With
 * `limit`, each list stops there and links to `more` for the rest; `dated` adds the date and
 * version under the title.
 */
export function changelogEntryMarkdown(
  entry: ChangelogEntry,
  level: number,
  options: { context: MarkdownContext; limit?: number; more?: string; dated?: boolean },
) {
  const heading = "#".repeat(level)
  const limit = options.limit ?? Infinity
  const tags = entry.releases.map((release) => release.tag).join(", ")
  const list = (title: string, notes: ChangelogNote[]) =>
    notes.length > 0 &&
    blocks(
      `${heading}# ${title}`,
      [
        ...notes.slice(0, limit).map((note) => {
          const areas = note.areas.map(areaLabel).join(", ")
          return `- ${areas ? `**${areas}:** ` : ""}${releaseItemMarkdown(note.text)}${refsMarkdown(note)}`
        }),
        notes.length > limit && options.more && `- ${link(`${notes.length - limit} more`, options.more)}`,
      ]
        .filter((line) => line)
        .join("\n"),
    ).trimEnd()
  return blocks(
    level === 1
      ? `${heading} ${entry.title}`
      : `${heading} ${link(entry.title, options.context.route(`/changelog/${entry.releases[0].tag}`))}`,
    (options.dated || level > 1) && `${entry.date} · ${tags}`,
    entry.summary && `${entry.summary}${refsMarkdown(entry.refs)}`,
    ...entry.media.map((media) =>
      media.type === "image" ? `![${media.alt}](${media.src})` : link(media.alt || "Video", media.src),
    ),
    ...entry.features.map((feature) =>
      blocks(`${heading}# ${feature.title}`, feature.body && `${feature.body}${refsMarkdown(feature)}`).trimEnd(),
    ),
    entry.breaking.length > 0 &&
      blocks(
        `${heading}# ${options.context.t("changelog.breaking")}`,
        ...entry.breaking.map((change) =>
          blocks(change.title && `**${change.title}**`, releaseItemMarkdown(change.body)).trimEnd(),
        ),
      ).trimEnd(),
    list(options.context.t("changelog.improvements"), entry.improved),
    list(options.context.t("changelog.fixes"), entry.fixed),
    `${options.context.t("changelog.releasedIn")} ${entry.releases.map((release) => link(release.tag, release.url)).join(", ")}`,
  ).trimEnd()
}

/** A release note line, with the trailing `(@author)` linked to their GitHub profile. */
export function releaseItemMarkdown(item: string) {
  return item.replace(/\s*\(@([\w-]+)\)$/, (_, username: string) => ` ([@${username}](https://github.com/${username}))`)
}

/** The pull requests and credits after a note: " ([#123](…), [@user](…))". */
function refsMarkdown(refs: { prs: string[]; credits: string[] }) {
  const items = [
    ...refs.prs.map((pr) => link(`#${pr}`, `${config.github.repoUrl}/pull/${pr}`)),
    ...refs.credits.map((user) => link(`@${user}`, `https://github.com/${user}`)),
  ]
  return items.length > 0 ? ` (${items.join(", ")})` : ""
}

function neighbour(item: NonNullable<ChangelogView["newer"]>, context: MarkdownContext) {
  return `${link(item.title, context.route(`/changelog/${item.tag}`))} (${item.tag})`
}

function unavailable(context: MarkdownContext) {
  return `${context.t("changelog.unavailable")} ${link(context.t("changelog.viewReleases"), `${config.github.repoUrl}/releases`)}`
}
