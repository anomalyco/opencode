import { Link, Meta, Title } from "@solidjs/meta"
import { createAsync, useParams } from "@solidjs/router"
import { HttpStatusCode } from "@solidjs/start"
import { Show, Suspense } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd, techArticleData } from "~/component/structured-data"
import { ChangelogSettings, ChangelogTimeline, ChangelogUnavailable, entryPath } from "~/component/site/changelog-entry"
import { Site } from "~/component/site/site"
import { useMarkdown } from "~/component/site/use-markdown"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { changelogEntry } from "~/lib/changelog"
import { entryStatus } from "~/lib/changelog-notes"
import { changelogEntryPageMarkdown } from "~/lib/changelog-markdown"
import { PageTitle } from "~/component/site/sticky-title"

/** One release's page, `/changelog/<tag>`: the entry in full, with Share, and the newer and older entries. */
export default function ChangelogRelease() {
  const i18n = useI18n()
  const language = useLanguage()
  const params = useParams()
  const view = createAsync(() => changelogEntry(params.tag ?? ""))
  const entry = () => view()?.entries[0]
  const markdown = useMarkdown(`/changelog/${params.tag}`, changelogEntryPageMarkdown, { changelog: view })
  const description = () => {
    const current = entry()
    if (!current) return i18n.t("changelog.meta.description")
    const text = current.summary || current.features[0]?.title || current.title
    const plain = withoutColons(text.replace(/[`*]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"))
    // Search results show 140 to 160 characters: a short summary gets a line about the release, and
    // a long one ends on a whole word. Release notes are English, so this line is too.
    const full =
      plain.length >= 140
        ? plain
        : `${plain.replace(/[.!]?$/, ".")} Release notes for OpenCode ${current.releases[0].tag}, with every new feature, improvement and fix.`
    return full.length <= 160 ? full : `${full.slice(0, 159).replace(/\s+\S*$/, "")}…`
  }
  // Titles fit in 60 characters: a long release title drops "changelog", then ends on a whole word.
  const headline = () => {
    const title = entry()?.title.replace(/`/g, "") ?? ""
    return title.length <= 60 ? title : `${title.slice(0, 59).replace(/\s+\S*$/, "")}…`
  }
  const pageTitle = () => {
    const full = i18n.t("changelog.entry.title", { title: headline() })
    if (full.length <= 60) return full
    const short = `${headline()} | OpenCode`
    return short.length <= 60 ? short : headline()
  }

  return (
    <Site
      page="changelog-entry"
      settings={import.meta.env.DEV ? (section) => <ChangelogSettings section={section} /> : undefined}
      markdown={markdown}
    >
      <Link
        rel="alternate"
        type="application/rss+xml"
        title={i18n.t("changelog.title")}
        href={language.route("/changelog.xml")}
      />
      <nav data-slot="entry-nav" aria-label={i18n.t("changelog.hero.title")}>
        <a href={language.route("/changelog")}>
          <span data-slot="arrow-back">←</span> {i18n.t("changelog.entry.back")}
        </a>
      </nav>

      <Suspense>
        <Show when={view()}>
          {(current) => (
            <Show
              when={entry()}
              fallback={
                <>
                  <HttpStatusCode code={entryStatus(current())} />
                  <Title>{i18n.t("changelog.title")}</Title>
                  <section data-component="hero">
                    <PageTitle title={i18n.t("changelog.hero.title")} />
                    <Show when={current().ok} fallback={<ChangelogUnavailable />}>
                      <p>{i18n.t("changelog.entry.notFound", { tag: params.tag ?? "" })}</p>
                    </Show>
                  </section>
                </>
              }
            >
              {(item) => (
                <>
                  <Title>{pageTitle()}</Title>
                  <ShareMeta
                    title={headline()}
                    description={description()}
                    image={ogImage("/changelog/[tag]")}
                    englishOnly
                  />
                  {/* A merged entry answers to each of its tags; the newest one is the page's address. */}
                  <LocaleLinks path={entryPath(item())} englishOnly />
                  <Meta name="description" content={description()} />
                  <JsonLd
                    data={techArticleData({
                      headline: item().title.replace(/`/g, ""),
                      description: description(),
                      path: language.route(entryPath(item())),
                      image: ogImage("/changelog/[tag]").src,
                      date: item().date,
                      language: "en",
                    })}
                  />
                  <JsonLd
                    data={breadcrumbData([
                      { name: i18n.t("nav.home"), path: "/" },
                      { name: i18n.t("changelog.hero.title"), path: language.route("/changelog") },
                      { name: item().releases[0].tag, path: language.route(entryPath(item())) },
                    ])}
                  />
                  <section data-component="block" data-slot="timeline">
                    <ChangelogTimeline entries={[item()]} level={1} limit={Infinity} />
                    <nav data-component="changelog-neighbours" aria-label={i18n.t("changelog.pages.label")}>
                      <Show when={current().newer}>
                        {(newer) => (
                          <a href={language.route(`/changelog/${newer().tag}`)} rel="prev">
                            <span data-slot="kicker">
                              <span data-slot="arrow-back">←</span> {i18n.t("changelog.entry.newer")} · {newer().tag}
                            </span>
                            <span data-slot="title">{newer().title.replace(/`/g, "")}</span>
                          </a>
                        )}
                      </Show>
                      <Show when={current().older}>
                        {(older) => (
                          <a href={language.route(`/changelog/${older().tag}`)} rel="next" data-slot="older">
                            <span data-slot="kicker">
                              {older().tag} · {i18n.t("changelog.entry.older")} <span data-slot="arrow-forward">→</span>
                            </span>
                            <span data-slot="title">{older().title.replace(/`/g, "")}</span>
                          </a>
                        )}
                      </Show>
                    </nav>
                  </section>
                </>
              )}
            </Show>
          )}
        </Show>
      </Suspense>
    </Site>
  )
}

/**
 * The site's copy has no colons, so a release note's description drops a leading "Label:" and a
 * trailing "see: <link>", and a colon that joins two clauses becomes a full stop. A colon in a
 * setting such as "persist-credentials: false" stays. The release notes themselves are unchanged.
 */
function withoutColons(text: string) {
  return text
    .replace(/^[A-Z][\w&/+-]*(?: [A-Z][\w&/+-]*)?:\s+(\S)/, (_, first: string) => first.toUpperCase())
    .replace(/,?\s+see:\s+\S+\s*$/i, "")
    .replace(
      /^((?:\S+\s+){3,}\S+?):\s+([a-z])/,
      (_, before: string, first: string) => `${before}. ${first.toUpperCase()}`,
    )
}
