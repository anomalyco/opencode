import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { faviconURL } from "../components/link-favicon"
import { githubPreview, loadGitHubPreview } from "./github-previews"
import {
  githubCaption,
  replyLinks,
  type GitHubPreview,
  type GitHubState,
  type GitHubTarget,
  type LinkTarget,
} from "./links"
import "./link-previews.css"

// Past this many, the rest wait behind "N more".
const folded = 3

/**
 * A finished reply's links as compact rows, in reading order: GitHub repositories, issues, pull requests and commits
 * with their titles and states, other pages by their path and site. Only the rows on screen load their metadata.
 */
export function LinkPreviews(props: { text: string }) {
  const i18n = useI18n()
  const links = createMemo(() => replyLinks(props.text))
  const [open, setOpen] = createSignal(false)
  const shown = createMemo(() => (open() ? links() : links().slice(0, folded)))

  createEffect(() => shown().forEach((link) => link.type === "github" && loadGitHubPreview(link)))

  return (
    <Show when={links().length > 0}>
      <div data-component="link-previews">
        <ul data-slot="link-previews-list" aria-label={i18n.t("ui.linkPreviews.label")}>
          <For each={shown()}>
            {(link) => (
              <li>
                <LinkPreviewRow link={link} />
              </li>
            )}
          </For>
        </ul>
        <Show when={links().length > folded}>
          <button
            type="button"
            data-slot="link-previews-more"
            aria-expanded={open()}
            onClick={() => setOpen((value) => !value)}
          >
            <span data-slot="link-preview-icon">
              <Icon name="outline-chevron-down" size="small" />
            </span>
            <span data-slot="link-preview-title">
              {open()
                ? i18n.t("ui.linkPreviews.showFewer")
                : i18n.plural("ui.linkPreviews.more", links().length - folded)}
            </span>
          </button>
        </Show>
      </div>
    </Show>
  )
}

type Row = {
  icon: string
  tone?: GitHubState
  favicon?: string
  title: string
  fact?: string
  muted: boolean
}

function LinkPreviewRow(props: { link: LinkTarget }) {
  const i18n = useI18n()

  const compact = createMemo(
    () => new Intl.NumberFormat(i18n.locale(), { notation: "compact", maximumFractionDigits: 1 }),
  )

  const row = createMemo((): Row => {
    const link = props.link

    if (link.type === "web")
      return {
        icon: "globe",
        favicon: faviconURL(new URL(link.url)),
        title: link.title ?? link.host,
        fact: link.title ? link.host : undefined,
        muted: true,
      }

    const preview = githubPreview(link)

    if (!preview)
      return {
        icon: githubIcon(link),
        title: githubCaption(link),
        fact: i18n.t(`ui.linkPreviews.kind.${link.kind}`),
        muted: true,
      }

    return {
      icon: githubIcon(link, preview.state),
      tone: preview.state,
      title: preview.title,
      fact: fact(link, preview),
      muted: false,
    }
  })

  function fact(link: GitHubTarget, preview: GitHubPreview) {
    if (preview.state) return i18n.t(`ui.linkPreviews.state.${preview.state}`)

    if (link.kind === "commit")
      return preview.additions !== undefined && preview.deletions !== undefined
        ? `+${compact().format(preview.additions)} \u2212${compact().format(preview.deletions)}`
        : undefined

    if (link.kind !== "repository") return undefined

    const facts = [
      preview.stars !== undefined ? `\u2605 ${compact().format(preview.stars)}` : undefined,
      preview.language,
    ].filter(Boolean)

    return facts.length > 0 ? facts.join(" \u00B7 ") : undefined
  }

  // Read as the row reads, led by the caption a loaded GitHub row no longer shows unless its title already says it.
  const label = () => {
    const caption = props.link.type === "github" && !row().muted ? githubCaption(props.link) : undefined

    return [caption === row().title ? undefined : caption, row().title, row().fact].filter(Boolean).join(", ")
  }

  return (
    <a
      data-slot="link-preview"
      data-muted={row().muted ? "" : undefined}
      data-tone={row().tone}
      href={props.link.url}
      title={props.link.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label()}
    >
      <span data-slot="link-preview-icon" data-icon={row().icon} aria-hidden="true">
        <Show when={row().favicon}>
          {(src) => (
            <img
              data-slot="link-preview-favicon"
              src={src()}
              alt=""
              width={16}
              height={16}
              decoding="async"
              draggable={false}
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                if (event.currentTarget.naturalWidth > 0) event.currentTarget.dataset.loaded = ""
              }}
            />
          )}
        </Show>
      </span>
      <span data-slot="link-preview-title" dir="auto">
        {row().title}
      </span>
      <Show when={row().fact}>
        <span data-slot="link-preview-fact">{row().fact}</span>
      </Show>
    </a>
  )
}

// Issues and pull requests show their state's glyph once it is known; until then, the open one in grey.
function githubIcon(link: GitHubTarget, state?: GitHubState) {
  if (link.kind === "repository" || link.kind === "commit") return `github-${link.kind}`

  if (link.kind === "pull")
    return `github-pull-${state && state !== "completed" && state !== "notPlanned" ? state : "open"}`

  if (state === "completed" || state === "notPlanned")
    return `github-issue-${state === "notPlanned" ? "not-planned" : "completed"}`

  return "github-issue-open"
}
