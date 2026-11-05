import { Link, Meta, Title } from "@solidjs/meta"
import { createAsync, useSearchParams } from "@solidjs/router"
import { Show, Suspense } from "solid-js"
import { Site } from "~/component/site/site"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { changelogPage } from "~/lib/changelog"
import { areaKeys, changelogQuery } from "~/lib/changelog-notes"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import {
  ChangelogPages,
  ChangelogSettings,
  ChangelogTimeline,
  ChangelogToolbar,
  ChangelogUnavailable,
} from "~/component/site/changelog-entry"
import { useMarkdown } from "~/component/site/use-markdown"
import { changelogMarkdown } from "~/lib/changelog-markdown"
import { PageTitle } from "~/component/site/sticky-title"

export default function Changelog() {
  const i18n = useI18n()
  const language = useLanguage()
  const [params] = useSearchParams()
  // `?page=2` for older updates and `?area=desktop,terminal` to filter; both are shareable URLs.
  const page = () => Number(params.page ?? 1) || 1
  const filter = () => areaKeys(params.area)
  const view = createAsync(() => changelogPage(page(), filter()))
  const markdown = useMarkdown("/changelog", changelogMarkdown, { changelog: view })
  const feed = () => language.route(`/changelog.xml${changelogQuery({ filter: filter() })}`)

  return (
    <Site
      page="changelog"
      settings={import.meta.env.DEV ? (section) => <ChangelogSettings section={section} /> : undefined}
      markdown={markdown}
    >
      <Title>{i18n.t("changelog.title")}</Title>
      <ShareMeta
        title={i18n.t("changelog.title")}
        description={i18n.t("changelog.meta.description")}
        image={ogImage("/changelog")}
        englishOnly
      />
      {/* Filtered views point to the full changelog; older pages are their own pages. English only. */}
      <LocaleLinks path={`/changelog${changelogQuery({ page: page() })}`} englishOnly />
      <Meta name="description" content={i18n.t("changelog.meta.description")} />
      <Link rel="alternate" type="application/rss+xml" title={i18n.t("changelog.title")} href={feed()} />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: "/" },
          { name: i18n.t("changelog.hero.title"), path: language.route("/changelog") },
        ])}
      />

      <section data-component="hero">
        <PageTitle title={i18n.t("changelog.hero.title")} />
        <p>{i18n.t("changelog.hero.subtitle")}</p>
      </section>

      {/* Its own boundary, as on the product pages: without it the whole page renders again on the
          server once GitHub's releases arrive, and the head tags it adds show twice. */}
      <Suspense>
        <Show when={view()}>
          {(current) => (
            <Show
              when={current().ok}
              fallback={
                <section data-component="block">
                  <div data-slot="body">
                    <ChangelogUnavailable />
                  </div>
                </section>
              }
            >
              <section data-component="block" data-slot="timeline">
                <ChangelogToolbar view={current()} />
                <Show
                  when={current().entries.length > 0}
                  fallback={<p data-slot="lead">{i18n.t("changelog.filter.empty")}</p>}
                >
                  <ChangelogTimeline entries={current().entries} level={2} limit={6} />
                </Show>
                <ChangelogPages view={current()} />
              </section>
            </Show>
          )}
        </Show>
      </Suspense>
    </Site>
  )
}
