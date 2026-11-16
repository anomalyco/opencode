import { joinSentences, rich, sentenceGap } from "~/i18n/rich"
import "./index.css"
import "~/component/site/hero-title.css"
import { rollsByCharacter, titleCells } from "~/component/site/hero-title"
import { Title, Meta } from "@solidjs/meta"
import {
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
  For,
  lazy,
  on,
  onCleanup,
  onMount,
  Match,
  Show,
  Suspense,
  Switch,
} from "solid-js"
import { ConsoleField } from "~/component/site/console-field"
import { ChevronRight, ExternalArrow } from "~/component/site/icons"
import { LogoWall } from "~/component/site/logo-wall"
import { revealMotion, washStartTime, washStep } from "~/component/site/reveal"
import { createWash } from "~/component/site/use-wash"
import { OpenSourceFork } from "~/component/site/open-source-fork"
import { OpenSourceProof } from "~/component/site/open-source-proof"
import { ConsoleWidget } from "~/component/site/console-widget"
import {
  carouselCss,
  ProductAction,
  ProductCarousel,
  ProductCarouselSkeleton,
  useDevicePlatform,
} from "~/component/site/products"
import ProductsArrows from "~/component/site/products-arrows"
import { ProviderLogos } from "~/component/site/provider-logos"
import { PhoneFeatures } from "~/component/site/phone-features"
import { byos } from "~/lib/byos"
import { localize, useArea } from "~/i18n/content"
import { announcementsSource } from "~/i18n/content/areas/announcements"
import "~/component/site/byos.css"
import { ByosOptionLeads, ByosOptions } from "~/component/site/byos-options"
import { getStarted } from "~/lib/get-started"
import "~/component/site/get-started.css"
import { installs } from "~/component/site/product-data"
import { isMobile } from "~/lib/platform"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { JsonLd, organizationData, softwareData, websiteData } from "~/component/structured-data"
import { Rich } from "~/component/site/rich-text"
import { homeOrderDefaultCss, homeOrderScript, homeOrderStyleId, useHomeOrder } from "~/component/site/home-order"
import { designCopy, designEditing } from "~/component/site/design-copy"
import type { CopyId } from "~/component/site/design-mode"
import type { RichText } from "~/lib/markdown"
import { Site, siteSettings } from "~/component/site/site"
import { logoLabels, setSiteSetting } from "~/component/site/settings"
import { announcementCopy, announcements } from "~/component/site/announcement"
import { useMarkdown } from "~/component/site/use-markdown"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { homeContent, linkPhrases } from "~/lib/home-content"
import { tag } from "~/lib/language"
import { repoStats, type RepoStats } from "~/lib/github"
import { pageData } from "~/lib/page-data"
import { inlineKey } from "~/lib/direction"
import { copyOnClick } from "~/lib/clipboard"
import { spinReel } from "~/component/site/slot-stat"

// Settings › Hero text and Stats pick these in development; production shows the static title and
// the slot stats, so the rolling chunk isn't built.
const HeroTitle = import.meta.env.DEV
  ? lazy(() => import("~/component/site/rolling").then((module) => ({ default: module.HeroTitle })))
  : () => undefined
const RollingStat = import.meta.env.DEV
  ? lazy(() => import("~/component/site/rolling").then((module) => ({ default: module.RollingStat })))
  : () => undefined
// Only rendered inside the settings panel, so it loads with it.
// Settings rows are a development tool (component/site/settings-panel.tsx), left out of production.
const PageSettings = import.meta.env.DEV ? lazy(() => import("~/component/site/page-settings")) : () => undefined

export default function Home() {
  const i18n = useI18n()
  const language = useLanguage()
  const markdown = useMarkdown("/", (context, pages) => pages.homeMarkdown(context))
  useHomeOrder()
  const [statsVisible, setStatsVisible] = createSignal(false)
  // Live repo numbers (lib/github.ts), streamed in under the config's numbers.
  const repo = pageData(() => repoStats())

  const heroVariant = () => siteSettings.hero
  // Console layout "block" is the whole section, so it sets the panel option and the name on the
  // left itself: older saved Console and Console label values can't break it. "off" still hides it.
  const consoleSection = () =>
    siteSettings.consoleLayout === "block" && siteSettings.consoleSection !== "off"
      ? "panel"
      : siteSettings.consoleSection
  const content = createMemo(() => homeContent(i18n.t, language.route))
  // Its own meta description (140–155 characters). Until a locale translates it, the locale keeps
  // the tagline and hero subtitle it already has in its language.
  const description = () =>
    i18n.translated("home.meta.description")
      ? i18n.t("home.meta.description")
      : joinSentences([i18n.t("app.meta.description"), ...content().hero.subtitle])
  const title = () => designCopy("home.hero.title", content().hero.title)
  const subtitleParts = () => designCopy("home.hero.subtitle", content().hero.subtitle.join("\n")).split("\n")

  // The open source numbers start as they approach the window (a fifth of a window early), so they
  // are already spinning when they come into view; the avatars' wash follows once the wall itself
  // is in view, never before the numbers (on a static page, src/client/islands/home.ts). Already on
  // screen at load, they start 300ms after the page's code runs. With reduced motion the numbers
  // simply show. The stats render twice when the live numbers stream in after the page (first with
  // the config's numbers), so a second one joins a start already set.
  const [openSourceStart, setOpenSourceStart] = createSignal<number>()
  const observeStats = (element: HTMLDListElement) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setStatsVisible(true)
    if (openSourceStart() !== undefined) return
    let first = true
    const statsObserver = new IntersectionObserver(
      (entries) => {
        const initial = first
        first = false
        if (!entries.some((entry) => entry.isIntersecting)) return
        statsObserver.disconnect()
        const at = washStartTime(initial)
        setOpenSourceStart(at)
        setTimeout(() => setStatsVisible(true), Math.max(0, at - performance.now()))
      },
      { rootMargin: "0px 0px 20% 0px" },
    )
    statsObserver.observe(element)
    onCleanup(() => statsObserver.disconnect())
  }

  // The open source stats, with the stars and contributors live from GitHub when it answered. The
  // contributors round down to whole thousands ("1K+") to fit the column; the exact count is in the
  // open source proof.
  const openSourceStats = (live?: RepoStats) => {
    const values = [
      live?.stars ? new Intl.NumberFormat("en-US", { notation: "compact" }).format(live.stars) : undefined,
      live?.contributors
        ? live.contributors < 1000
          ? String(live.contributors)
          : `${Math.floor(live.contributors / 1000)}K+`
        : undefined,
    ]
    return (
      <dl data-component="stats" data-design="stats" ref={observeStats} data-visible={statsVisible() ? "" : undefined}>
        <For each={content().openSource.stats}>
          {(stat, index) => (
            <div>
              <dt>{stat.label}</dt>
              <dd>
                <Switch>
                  <Match when={siteSettings.stats === "slot"}>
                    <SlotStat value={values[index()] ?? stat.value} start={openSourceStart()} stat={index()} />
                  </Match>
                  <Match when={siteSettings.stats === "rolling"}>
                    <Suspense>
                      <RollingStat value={values[index()] ?? stat.value} visible={statsVisible()} />
                    </Suspense>
                  </Match>
                  <Match when={siteSettings.stats === "odometer"}>
                    <Odometer value={values[index()] ?? stat.value} />
                  </Match>
                </Switch>
              </dd>
            </div>
          )}
        </For>
      </dl>
    )
  }

  // The logo row's label in every layout: the translated label, unless Settings › Logo label picks
  // another (English, Design mode only) or Design mode copy overrides it.
  const logoLabel = () =>
    siteSettings.logoWall === "providers"
      ? content().providers.label
      : designCopy(
          "home.logos.label",
          siteSettings.logoLabel === logoLabels[0] ? content().companies.label : siteSettings.logoLabel,
        )
  // The translated label's short form, only while the row shows that label unchanged.
  const logoLabelShort = () =>
    siteSettings.logoWall === "companies" && logoLabel() === content().companies.label
      ? content().companies.labelShort
      : undefined
  // One logo row, rendered on its own or inside the "section" layout's home section.
  const logoWall = () => (
    <LogoWall
      kind={siteSettings.logoWall === "providers" ? "providers" : "companies"}
      layout={siteSettings.logoLayout}
      label={logoLabel()}
      shortLabel={logoLabelShort()}
      items={siteSettings.logoWall === "providers" ? content().providers.items : content().companies.items}
      animation={siteSettings.logoAnimation}
      tuning={siteSettings.logoTuning}
      interval={siteSettings.logoInterval}
      stagger={siteSettings.logoStagger}
      opacity={siteSettings.logoOpacity}
    />
  )

  return (
    <Site
      page="home"
      settings={import.meta.env.DEV ? (section) => <PageSettings home section={section} /> : undefined}
      markdown={markdown}
    >
      <Title>{content().title}</Title>
      <LocaleLinks path="/" />
      <ShareMeta title={content().title} description={description()} image={ogImage("/")} />
      <Meta name="description" content={description()} />
      <JsonLd data={organizationData} />
      <JsonLd data={websiteData(tag(language.locale()))} />
      <JsonLd
        data={softwareData({
          name: "OpenCode",
          description: description(),
          path: language.route("/"),
          image: ogImage("/").src,
          operatingSystem: "macOS, Windows, Linux",
        })}
      />

      {/* The default section order from the server; a saved one (Design mode, development only)
          replaces it before the sections paint. */}
      <style id={homeOrderStyleId} innerHTML={homeOrderDefaultCss} />
      {import.meta.env.DEV && <script innerHTML={homeOrderScript} />}
      {/* The carousel's cards per screen, which also size the hero (its title and subtitle follow the
          card width): here, ahead of the hero, as the carousel's own copy of these rules only arrives
          with the carousel, and the hero would otherwise resize once it has painted. */}
      <style>{carouselCss()}</style>
      {/* Production keeps the announcement off (Settings › Announcement), so only development renders it. */}
      {import.meta.env.DEV && <Announcement />}
      <section
        data-component="hero"
        data-section="hero"
        data-design="hero heroTitleSize heroText heroInstall homeAnnouncement"
        data-variant={heroVariant()}
        data-title-size={siteSettings.heroTitleSize}
        style={{ "--title-chars": titleCells(title()) }}
      >
        <Show
          when={siteSettings.heroText !== "static" && rollsByCharacter(title()) && !designEditing("home.hero.title")}
          fallback={<h1 data-design-copy="home.hero.title">{title()}</h1>}
        >
          <Suspense fallback={<h1 data-design-copy="home.hero.title">{title()}</h1>}>
            <HeroTitle text={title()} mode={siteSettings.heroText === "flap" ? "flap" : "roll"} />
          </Suspense>
        </Show>
        <p
          data-design-copy="home.hero.subtitle"
          data-design="subtitleWidth"
          data-width={siteSettings.subtitleWidth.charAt(0)}
        >
          {/* Two inline spans so Design mode keeps the copy's two parts; the text wraps naturally. */}
          <span>{subtitleParts()[0]}</span>
          {sentenceGap(subtitleParts()[0])}
          <span>{subtitleParts()[1] ?? ""}</span>
        </p>
        {/* Every Hero install option renders; the site root's data-hero-install (set before first
            paint for a saved value) shows the chosen one, so nothing appears or goes after load.
            Production renders only the default's (script/fold-settings.ts). */}
        <Show when={import.meta.env.DEV || siteSettings.heroInstall === "line"}>
          <HeroInstall mode="line" />
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.heroInstall === "tabs"}>
          <HeroInstall mode="tabs" />
        </Show>
      </section>

      {/* The carousel's frame until the carousel itself has streamed in (products.tsx), on the
          development server: production renders the page in one piece (src/static/render.tsx). */}
      {import.meta.env.DEV && <ProductCarouselSkeleton />}

      <Show when={siteSettings.logoWall !== "off"}>
        <Show when={siteSettings.logoLayout === "section"} fallback={logoWall()}>
          {/* The logo row as a home section: its label is the section title. */}
          <section data-component="block" data-section="logos" data-design="logoWall logoLayout logoDividers">
            <h2
              data-slot="label"
              data-design-copy={siteSettings.logoWall === "companies" ? "home.logos.label" : undefined}
            >
              {logoLabel()}
            </h2>
            <div data-slot="body">{logoWall()}</div>
          </section>
        </Show>
      </Show>

      <ProductCarousel
        header={
          <Show
            when={
              import.meta.env.DEV ||
              siteSettings.heroInstall === "above carousel" ||
              siteSettings.heroInstall === "agent only"
            }
          >
            <InstallRow />
          </Show>
        }
        // A mouse wheel can't scroll the cards sideways, so a fine pointer gets arrows.
        arrows={<ProductsArrows track="products-track" />}
      />
      {/* Before first paint: where the carousel's cards (or its skeleton's) start on the page, so on
          phones a card runs down to the bottom of the small viewport (products.css) and never past
          it. Again on resize. */}
      <script innerHTML={cardTopScript} />

      <section
        data-component="block"
        data-section="what"
        data-phone-features={siteSettings.phoneFeatures}
        data-design="phoneFeatures whatColumns whatCopyColumns spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
        data-columns={siteSettings.whatColumns.charAt(0)}
        data-copy-columns={copyColumnsAttribute(siteSettings.whatCopyColumns, siteSettings.whatColumns)}
      >
        <h2 data-slot="label">{content().what.title}</h2>
        <div data-slot="body">
          <p data-slot="lead">
            {/* The sentence before the docs link is editable in Design mode; the link always ends it. */}
            <span data-design-copy="home.what.lead">
              {designCopy("home.what.lead", String(content().what.lead[0]).trim())}
            </span>{" "}
            <Rich value={content().what.lead.slice(1)} />
          </p>
          <Show when={import.meta.env.DEV || siteSettings.providerLogos !== "none"}>
            <ProviderLogos />
          </Show>
          <ul id="home-features" data-component="features">
            <For each={content().what.features}>
              {(feature) => (
                <li>
                  <a href={feature.href}>
                    <strong>
                      <Show when={"copy" in feature && feature.copy} fallback={feature.title}>
                        {(copy) => (
                          <span data-design-copy={`home.feature.${copy()}.title`}>
                            {copy() === "anyDevice"
                              ? designCopy("home.feature.anyDevice.title", feature.title)
                              : feature.title}
                          </span>
                        )}
                      </Show>
                      <ExternalArrow />
                    </strong>
                    <Show when={"copy" in feature && feature.copy} fallback={<span>{feature.body}</span>}>
                      {(copy) => (
                        <span data-design-copy={`home.feature.${copy()}.body`}>
                          {designCopy(`home.feature.${copy()}.body`, feature.body)}
                        </span>
                      )}
                    </Show>
                  </a>
                </li>
              )}
            </For>
          </ul>
          <PhoneFeatures
            listID="home-features"
            features={content().what.features.map((feature) => ({
              href: feature.href,
              title:
                "copy" in feature && feature.copy === "anyDevice"
                  ? designCopy("home.feature.anyDevice.title", feature.title)
                  : feature.title,
              body:
                "copy" in feature && feature.copy
                  ? designCopy(`home.feature.${feature.copy}.body`, feature.body)
                  : feature.body,
            }))}
          />
        </div>
      </section>

      <GetStarted />

      <BringYourOwnSubs />

      <Show when={siteSettings.toolsSection === "on"}>
        <section
          data-component="block"
          data-section="tools"
          data-design="toolsColumns toolsCopyColumns spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
          data-columns={siteSettings.toolsColumns.charAt(0)}
          data-copy-columns={copyColumnsAttribute(siteSettings.toolsCopyColumns, siteSettings.toolsColumns)}
        >
          <h2 data-slot="label">{content().tools.title}</h2>
          <div data-slot="body">
            <p data-slot="lead" data-design-copy="home.tools.lead">
              <Rich value={richCopy("home.tools.lead", content().tools.lead, content().copyLinks)} />
            </p>
            <ToolGrid items={content().tools.items} />
          </div>
        </section>
      </Show>

      <section
        data-component="block"
        data-section="openSource"
        data-oss-variant={siteSettings.ossVariant}
        data-design="openSourceColumns openSourceCopyColumns ossProof ossVariant spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
        data-columns={siteSettings.openSourceColumns.charAt(0)}
        data-copy-columns={copyColumnsAttribute(siteSettings.openSourceCopyColumns, siteSettings.openSourceColumns)}
      >
        <h2 data-slot="label">{content().openSource.title}</h2>
        <div data-slot="body">
          {/* The page's own lead is HTML (bold numbers); a Design mode option is plain text. */}
          <Show
            when={
              designCopy("home.openSource.lead", stripTags(content().openSource.lead)) !==
              stripTags(content().openSource.lead)
            }
            fallback={
              <p data-slot="lead" data-design-copy="home.openSource.lead" innerHTML={content().openSource.lead} />
            }
          >
            <p data-slot="lead" data-design-copy="home.openSource.lead">
              {designCopy("home.openSource.lead", stripTags(content().openSource.lead))}
            </p>
          </Show>
          <Suspense
            fallback={
              <>
                {openSourceStats()}
                <Show when={siteSettings.ossProof === "stats"}>
                  <OpenSourceProof layout="stats" pending start={openSourceStart()} />
                </Show>
              </>
            }
          >
            {openSourceStats(repo())}
            <Show when={siteSettings.ossProof === "stats"}>
              <OpenSourceProof layout="stats" stats={repo()} start={openSourceStart()} />
            </Show>
          </Suspense>
        </div>
        <Show when={import.meta.env.DEV || siteSettings.ossVariant === "fork"}>
          <OpenSourceFork />
        </Show>
      </section>

      <Show when={siteSettings.ossProof === "section"}>
        <section
          data-component="block"
          data-section="openSourceProof"
          data-design="openSourceColumns spacer spacerLength spacerCount spacerStartDash spacerStartGap spacerCurve ditherHeight ditherOrientation ditherDirection ditherLength ditherPixel ditherPattern ditherDensity ditherOpacity ditherCurve ditherLine"
          data-columns={siteSettings.openSourceColumns.charAt(0)}
        >
          <h2 data-slot="label">{i18n.t("home.openSource.builtInTheOpen")}</h2>
          <div data-slot="body">
            <Suspense fallback={<OpenSourceProof layout="section" pending />}>
              <OpenSourceProof layout="section" stats={repo()} />
            </Suspense>
          </div>
        </section>
      </Show>

      <section
        data-component="block"
        data-section="console"
        data-design="consoleSection consoleHeight consoleColumns consoleCopyColumns consoleLabel consoleLayout"
        data-columns={siteSettings.consoleColumns.charAt(0)}
        data-copy-columns={copyColumnsAttribute(siteSettings.consoleCopyColumns, siteSettings.consoleColumns)}
        data-console={consoleSection()}
        data-console-height={siteSettings.consoleHeight}
        data-console-label={siteSettings.consoleLayout === "block" ? "left" : siteSettings.consoleLabel}
        data-console-layout={siteSettings.consoleLayout}
        style={{ "--clearing-strength": siteSettings.consoleClearing / 100 }}
      >
        {/* Shown instead of the eyebrow when Console label is "left"; both render so the setting
            only switches an attribute. */}
        <h2 data-slot="label">{content().console.title}</h2>
        <Show when={consoleSection() === "slim"}>
          <div data-slot="slim">
            <ConsoleField dot={1} />
            <h3>{content().console.slimHeadline}</h3>
            <div data-slot="actions">
              <a href={content().console.sales.href} data-component="site-button" data-variant="neutral">
                {content().console.sales.text}
              </a>
              <a href={content().console.cta.href} rel="external" data-component="site-button">
                {content().console.cta.text}
              </a>
            </div>
          </div>
        </Show>
        <div data-slot="console">
          <ConsoleField dot={consoleSection() === "inline" ? 1 : 2} />
          <div data-slot="copy">
            <h2 data-slot="eyebrow">{content().console.title}</h2>
            <h3>{content().console.headline}</h3>
            <p>{content().console.body}</p>
            <div data-slot="actions">
              <a href={content().console.cta.href} rel="external" data-component="site-button">
                {content().console.cta.text}
              </a>
            </div>
          </div>
        </div>
      </section>

      <Show when={consoleSection() === "corner"}>
        <ConsoleWidget
          title={content().console.title}
          headline={content().console.headline}
          cta={content().console.cta}
        />
      </Show>
    </Site>
  )
}

/**
 * Settings › Announcement: a "New" bar level with the logo, over the hero's three card columns
 * (in the page's flow on phones). It always renders; the site root's data-home-announcement (set
 * before first paint for a saved value) opens it, and changes animate its height and opacity.
 * On the development server ⇧A (or the older ⇧N) toggles it, like ⇧S and ⇧D for Settings and Design
 * mode, except while typing.
 */
function Announcement() {
  const language = useLanguage()
  const i18n = useI18n()
  const announcementText = useArea("announcements", announcementsSource)
  const message = () => designCopy("home.announcement", announcementCopy(announcements[0]))
  const item = () => announcements.find((entry) => announcementCopy(entry) === message())
  // The chosen announcement in this locale, with its link text; a custom Design mode message stays as typed.
  const local = () => {
    const index = announcements.findIndex((entry) => announcementCopy(entry) === message())
    return index < 0 ? undefined : announcementText()[index]
  }
  const shown = () => (local() ? `${local()!.text} ${local()!.link}` : message())

  return (
    <aside
      data-component="announcement"
      data-style={siteSettings.announcementStyle}
      data-design="homeAnnouncement announcementStyle"
      aria-label={i18n.t("site.announcement.aside")}
    >
      <div data-slot="clip">
        {/* Both styles render; data-style (set before first paint for a saved value) shows one.
            Production renders only the default's (script/fold-settings.ts). */}
        <Show
          when={
            import.meta.env.DEV ||
            siteSettings.announcementStyle === "text" ||
            siteSettings.announcementStyle === "chip"
          }
        >
          <p data-slot="line">
            <span data-slot="new">{i18n.t("home.banner.badge")}</span>{" "}
            <span data-design-copy="home.announcement">
              <Show when={item()} fallback={message()}>
                {(entry) => (
                  <a href={language.route(entry().href)}>
                    {shown()}
                    <ChevronRight />
                  </a>
                )}
              </Show>
            </span>
          </p>
        </Show>
        <Show when={import.meta.env.DEV || siteSettings.announcementStyle === "bar"}>
          <div data-slot="bar">
            <span data-slot="badge">{i18n.t("home.banner.badge")}</span>
            <p data-design-copy="home.announcement">
              <Show when={item()} fallback={message()}>
                {(entry) => (
                  <>
                    {local()?.text ?? entry().text}{" "}
                    <a href={language.route(entry().href)}>
                      {local()?.link ?? entry().link}
                      <ChevronRight />
                    </a>
                  </>
                )}
              </Show>
            </p>
          </div>
        </Show>
      </div>
    </aside>
  )
}

/**
 * Settings › Hero install "line" and "tabs", on desktop only, under the hero: the curl install
 * command with Copy and a link to /product, or a tab per install method beside its command.
 */
function HeroInstall(props: { mode: "line" | "tabs" }) {
  const language = useLanguage()
  const i18n = useI18n()
  const id = createUniqueId()
  const [selected, setSelected] = createSignal(0)
  const [copied, setCopied] = createSignal(false)
  const tabs = () => props.mode === "tabs"
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))

  const select = (index: number) => {
    clearTimeout(timer)
    setCopied(false)
    setSelected(index)
  }

  const keyDown = (event: KeyboardEvent, index: number) => {
    const next = {
      ArrowLeft: (index - 1 + installs.length) % installs.length,
      ArrowRight: (index + 1) % installs.length,
      Home: 0,
      End: installs.length - 1,
    }[inlineKey(event)]
    if (next === undefined) return
    event.preventDefault()
    select(next)
    document.getElementById(`${id}-tab-${next}`)?.focus()
  }

  const copy = () => {
    void navigator.clipboard.writeText(installs[selected()].command).then(() => {
      clearTimeout(timer)
      setCopied(true)
      timer = setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div data-component="hero-install" data-mode={props.mode}>
      <Show when={tabs()}>
        <div data-slot="tabs" role="tablist" aria-label={i18n.t("site.action.installMethod")}>
          <For each={installs}>
            {(item, index) => (
              <button
                type="button"
                role="tab"
                id={`${id}-tab-${index()}`}
                aria-controls={`${id}-panel`}
                aria-selected={selected() === index() ? "true" : "false"}
                tabIndex={selected() === index() ? 0 : -1}
                onClick={() => select(index())}
                onKeyDown={(event) => keyDown(event, index())}
              >
                {item.id}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div
        data-slot="command"
        id={`${id}-panel`}
        role={tabs() ? "tabpanel" : undefined}
        aria-labelledby={tabs() ? `${id}-tab-${selected()}` : undefined}
      >
        <code>{installs[selected()].command}</code>
        <button type="button" data-slot="copy" aria-live="polite" onClick={copy}>
          {copied() ? i18n.t("site.action.copied") : i18n.t("site.action.copy")}
        </button>
      </div>
      <Show when={props.mode === "line"}>
        <a href={language.route("/product")} data-slot="more">
          {i18n.t("home.install.more")}
        </a>
      </Show>
    </div>
  )
}

/**
 * Settings › Hero install "above carousel": the curl command as one copy button, like a row of the
 * Terminal card's install menu, and an action that copies an install prompt for a coding agent.
 * Every layout of Settings › Install row style renders; the row's data-style (set before first
 * paint for a saved value) shows the parts that layout uses, so a saved style never moves the page.
 * Production renders the row only when the default Hero install uses it (script/fold-settings.ts).
 */
function InstallRow() {
  const i18n = useI18n()
  const [copied, setCopied] = createSignal(false)
  const [promptCopied, setPromptCopied] = createSignal(false)
  // The "segmented" layout's toggle: what the one row copies.
  const [target, setTarget] = createSignal<"terminal" | "agent">("terminal")
  const label = () => designCopy("home.install.agent", i18n.t("home.install.agent"))
  const agentName = () => i18n.t("home.install.agentLabel")
  let timer: ReturnType<typeof setTimeout> | undefined
  let promptTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => {
    clearTimeout(timer)
    clearTimeout(promptTimer)
  })

  const flash = (set: (on: boolean) => void, previous: ReturnType<typeof setTimeout> | undefined) => {
    clearTimeout(previous)
    set(true)
    return setTimeout(() => set(false), 1500)
  }
  const copyCommand = () =>
    void navigator.clipboard.writeText(installs[0].command).then(() => (timer = flash(setCopied, timer)))
  const copyPrompt = () =>
    void navigator.clipboard.writeText(agentPrompt).then(() => (promptTimer = flash(setPromptCopied, promptTimer)))
  // The row copies the prompt only in the "segmented" layout with Agent chosen.
  const agent = () => siteSettings.installRowStyle === "segmented" && target() === "agent"

  // The agent action's visible label: the Design mode copy, or "Copied" in the same cell, so the
  // width holds; the copy icon turns into a check.
  const Action = (props: { text?: string }) => (
    <>
      <span data-slot="copy-labels" aria-hidden="true">
        <span
          data-active={promptCopied() ? undefined : ""}
          data-design-copy={props.text ? undefined : "home.install.agent"}
        >
          {props.text ?? label()}
        </span>
        <span data-active={promptCopied() ? "" : undefined}>{i18n.t("site.action.copied")}</span>
      </span>
      <Show when={promptCopied()} fallback={<CopyIcon />}>
        <CheckIcon />
      </Show>
    </>
  )

  return (
    <div
      data-component="hero-install"
      data-mode="row"
      data-style={siteSettings.installRowStyle}
      data-design="heroInstall installRowStyle"
    >
      <div data-slot="segmented" role="group" aria-label={i18n.t("home.install.target")}>
        <button
          type="button"
          aria-pressed={target() === "terminal" ? "true" : "false"}
          onClick={() => setTarget("terminal")}
        >
          {i18n.t("home.install.terminal")}
        </button>
        <button type="button" aria-pressed={target() === "agent" ? "true" : "false"} onClick={() => setTarget("agent")}>
          {i18n.t("home.install.agentTab")}
        </button>
      </div>
      <button type="button" data-slot="ghost" aria-label={agentName()} onClick={copyPrompt}>
        <Action />
      </button>
      <button
        type="button"
        data-slot="install"
        data-copied={(agent() ? promptCopied() : copied()) ? "" : undefined}
        aria-label={agent() ? agentName() : i18n.t("home.install.copyCommand", { command: installs[0].command })}
        onClick={() => (agent() ? copyPrompt() : copyCommand())}
      >
        <code data-slot="text">{agent() ? agentPrompt : installs[0].command}</code>
        <span data-slot="status" aria-hidden="true">
          <span data-slot="idle">
            <CopyIcon />
          </span>
          <span data-slot="done">
            <CheckIcon />
          </span>
        </span>
      </button>
      <button
        type="button"
        data-slot="agent-icon"
        data-tip={i18n.t("home.install.agentTip")}
        data-copied={promptCopied() ? "" : undefined}
        aria-label={agentName()}
        onClick={copyPrompt}
      >
        <Show when={promptCopied()} fallback={<AgentIcon />}>
          <CheckIcon />
        </Show>
      </button>
      <span data-slot="or" aria-hidden="true">
        {i18n.t("home.install.or")}
      </span>
      <button type="button" data-slot="agent-link" aria-label={agentName()} onClick={copyPrompt}>
        <Action />
      </button>
      <p data-slot="agent-note">
        {i18n.t("home.install.agentNote")}{" "}
        <button type="button" data-slot="agent-link" aria-label={agentName()} onClick={copyPrompt}>
          <Action text={i18n.t("home.install.copyPrompt")} />
        </button>
      </p>
      <button
        type="button"
        data-slot="agent-button"
        data-component="site-button"
        data-variant="neutral"
        aria-label={agentName()}
        onClick={copyPrompt}
      >
        <Action />
      </button>
      <span data-slot="sr-only" aria-live="polite">
        {copied() || promptCopied() ? i18n.t("site.action.copied") : ""}
      </span>
    </div>
  )
}

// A robot face on the 16px icon grid, as in the footer's "View as agent" button.
function AgentIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.25"
      aria-hidden="true"
    >
      <rect x="2.125" y="2.125" width="11.75" height="11.75" />
      <path d="M0.875 6V10M15.125 6V10" />
      <rect x="4.875" y="5.75" width="2" height="4.5" fill="currentColor" stroke="none" />
      <rect x="9.125" y="5.75" width="2" height="4.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

// For the agent action above the carousel: the Terminal section of the download page's Markdown lists every
// install command.
const agentPrompt = `Install the OpenCode terminal app on this machine. Follow the Download section of https://opencode.ai/terminal.md and pick the method that fits this system (for example \`${installs[0].command}\`), then run \`opencode --version\` to check that it works.`

function CopyIcon() {
  return (
    <svg data-slot="copy-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7.5 7.5V3.75H16.25V12.5H12.5M3.75 7.5H12.5V16.25H3.75V7.5Z" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg data-slot="copy-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5L8.25 14.25L15.5 6" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

// Rolls every digit up through at least one full turn, like an odometer, once the parent sets
// data-visible. Digits after the first spin an extra turn so smaller place values move faster;
// letters and symbols rise in as the digits settle.
/**
 * A stat like "224K" as a slot machine (Settings › Stats "slot"). It shows the final value until
 * `start` (a performance.now() time, set as the stats near the window), then each digit spins a
 * reel of random digits and eases out onto its own, left to right and stat by stat (`stat`), in
 * about 1.5s. Each reel begins and ends on the digit itself, so starting never jumps or shows a
 * zero. Letters and symbols ("K", "+") stay put. The random digits are drawn only once it starts,
 * so the server and the first client render agree.
 */
function SlotStat(props: { value: string; start?: number; stat: number }) {
  const chars = () => [...props.value]
  // Each digit's place among the stat's digits, for the stagger and the number of turns.
  const place = (index: number) =>
    chars()
      .slice(0, index)
      .filter((char) => /\d/.test(char)).length
  return (
    <span data-component="slot-stat" role="img" aria-label={props.value}>
      <For each={chars()}>
        {(char, index) => (
          <Show when={/\d/.test(char)} fallback={<span aria-hidden="true">{char}</span>}>
            <SlotDigit digit={Number(char)} start={props.start} place={place(index())} stat={props.stat} />
          </Show>
        )}
      </For>
    </span>
  )
}

function SlotDigit(props: { digit: number; start?: number; place: number; stat: number }) {
  let strip: HTMLSpanElement | undefined
  createEffect(
    on(
      () => props.start,
      (start) => {
        if (start === undefined || !strip) return
        onCleanup(spinReel(strip, props.digit, props.place, props.stat, start))
      },
    ),
  )
  // spinReel fills the strip with the reel's cells.
  return (
    <span data-slot="reel" aria-hidden="true">
      <span data-slot="strip" ref={strip}>
        <span>{props.digit}</span>
      </span>
    </span>
  )
}

function Odometer(props: { value: string }) {
  const digits = () => [...props.value].filter((char) => /\d/.test(char)).length
  return (
    <span data-component="odometer" role="img" aria-label={props.value}>
      <For each={[...props.value]}>
        {(char, index) => {
          const position = () => [...props.value].slice(0, index()).filter((item) => /\d/.test(item)).length
          const turns = () => (position() === 0 && digits() > 1 ? 1 : 2)
          return (
            <Show
              when={/\d/.test(char)}
              fallback={
                <span data-slot="suffix" aria-hidden="true" style={{ "--index": position() }}>
                  {char}
                </span>
              }
            >
              <span
                data-slot="digit"
                aria-hidden="true"
                style={{ "--target": turns() * 10 + Number(char), "--index": position() }}
              >
                <span data-slot="strip">
                  <For each={Array.from({ length: 30 }, (_, item) => item % 10)}>{(digit) => <span>{digit}</span>}</For>
                </span>
              </span>
            </Show>
          )
        }}
      </For>
    </span>
  )
}

/**
 * Design mode copy over copy with links: the page's own copy keeps its links, and an option links
 * the phrases in `links` (homeContent's copyLinks) wherever they appear.
 */
function richCopy(id: CopyId, rich: RichText, links: readonly { text: string; href: string }[]) {
  const plain = rich.map((item) => (typeof item === "string" ? item : "code" in item ? item.code : item.text)).join("")
  const text = designCopy(id, plain)
  return text === plain ? rich : linkPhrases(text, links)
}

function stripTags(html: string) {
  return html.replace(/<[^>]+>/g, "")
}

/**
 * "Get started", before "Bring your own subs": download, start with the free models, then bring a
 * subscription or use OpenCode Go (lib/get-started.ts). Laid out like the sections below it, with
 * the tools' column settings. Settings › Get started style explores five treatments of the body;
 * every one renders in development and the section's data-style (set before first paint for a saved
 * value) shows one; production renders only the default's (script/fold-settings.ts).
 */
function GetStarted() {
  const i18n = useI18n()
  const language = useLanguage()
  const content = createMemo(() => localize(language.locale(), "getStarted", getStarted(language.route)))
  // On a phone or tablet, Download is that device's app; on a computer, the desktop build.
  const platform = useDevicePlatform()
  const downloadSlug = () => (isMobile(platform()) ? "mobile" : "desktop")
  // On a phone or tablet the lead links only "OpenCode Go"; the other phrases stay plain words (no
  // link to tab to or announce), decided from the request's platform so the server renders it.
  const leadPhrases = () =>
    isMobile(platform()) ? content().phrases.filter((phrase) => phrase.text === "OpenCode Go") : content().phrases
  const [copied, setCopied] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(timer))
  const copy = () =>
    void navigator.clipboard.writeText(installs[0].command).then(() => {
      clearTimeout(timer)
      setCopied(true)
      timer = setTimeout(() => setCopied(false), 1500)
    })
  // The log-ins as one list in the page's language ("A, B or C"), each a link, inside one sentence.
  const subscriptionLinks = () => (
    <Rich
      value={rich(
        i18n.t("home.getStarted.moreModels", {
          subs: new Intl.ListFormat(language.locale() === "en" ? "en-GB" : language.tag(language.locale()), {
            type: "disjunction",
          }).format(content().subscriptions.map((item) => `[${item.name}](subs)`)),
        }),
        { subs: content().links.subs, go: content().plans[0].href, goPlus: content().plans[1].href },
      )}
    />
  )
  return (
    <section
      data-component="block"
      data-section="getStarted"
      data-style={siteSettings.getStartedStyle}
      data-design="getStartedStyle"
      data-columns={siteSettings.toolsColumns.charAt(0)}
      data-copy-columns={copyColumnsAttribute(siteSettings.toolsCopyColumns, siteSettings.toolsColumns)}
    >
      <h2 data-slot="label">{content().title}</h2>
      <div data-slot="body">
        <p data-slot="lead" data-design-copy="home.getStarted.lead">
          <Rich value={linkPhrases(designCopy("home.getStarted.lead", content().lead), leadPhrases())} />
        </p>

        {/* "steps": a numbered path, each step with its action. */}
        <Show when={import.meta.env.DEV || siteSettings.getStartedStyle === "steps"}>
          <ol data-slot="steps">
            <For each={content().steps}>
              {(step, index) => (
                <li>
                  <span data-slot="number" aria-hidden="true">
                    {String(index() + 1).padStart(2, "0")}
                  </span>
                  <div data-slot="text">
                    <h3>{step.title}</h3>
                    <p>{step.line}</p>
                  </div>
                  <div data-slot="action">
                    <Switch>
                      <Match when={index() === 0}>
                        <ProductAction slug={downloadSlug()} split />
                      </Match>
                      <Match when={index() === 1}>
                        <a href={content().links.free} data-slot="more">
                          {i18n.t("home.getStarted.freeModels")}
                          <ChevronRight />
                        </a>
                      </Match>
                      <Match when={index() === 2}>
                        <a href={content().links.go} data-slot="more">
                          OpenCode Go
                          <ChevronRight />
                        </a>
                      </Match>
                    </Switch>
                  </div>
                </li>
              )}
            </For>
          </ol>
        </Show>

        {/* "ladder": three rungs, free first. */}
        <Show when={import.meta.env.DEV || siteSettings.getStartedStyle === "ladder"}>
          <ul data-slot="ladder">
            <li>
              <a href={content().links.download}>
                <span data-slot="rung">
                  {i18n.t("home.getStarted.free")}
                  <span data-slot="marker">{i18n.t("home.getStarted.mostPeople")}</span>
                </span>
                <span data-slot="detail">
                  {i18n.t("home.getStarted.freeDetail", { model: content().freeModels[0] })}
                </span>
                <span data-slot="price">$0</span>
                <ChevronRight />
              </a>
            </li>
            <li>
              <a href={content().links.subs}>
                <span data-slot="rung">{i18n.t("home.getStarted.yours")}</span>
                <span data-slot="detail">
                  <span data-slot="logos" aria-hidden="true">
                    <For each={content().subscriptions}>
                      {(item) => (
                        <span
                          data-slot="logo"
                          style={{ "mask-image": `url(${item.logo})`, "-webkit-mask-image": `url(${item.logo})` }}
                        />
                      )}
                    </For>
                  </span>
                  ChatGPT, Copilot
                </span>
                <span data-slot="price">{i18n.t("home.getStarted.yourPlan")}</span>
                <ChevronRight />
              </a>
            </li>
            <li>
              <a href={content().links.go}>
                <span data-slot="rung">OpenCode Go</span>
                <span data-slot="detail">{i18n.t("home.getStarted.goDetail")}</span>
                <span data-slot="price">$10 / $40</span>
                <ChevronRight />
              </a>
            </li>
          </ul>
        </Show>

        {/* "sentence": the whole path in one large sentence, then the download button. */}
        <Show when={import.meta.env.DEV || siteSettings.getStartedStyle === "sentence"}>
          <div data-slot="sentence">
            <p>
              <Rich value={linkPhrases(content().sentence, content().phrases)} />
            </p>
            <ProductAction slug={downloadSlug()} split />
          </div>
        </Show>

        {/* "terminal": install, run, pick a free model. */}
        <Show when={import.meta.env.DEV || siteSettings.getStartedStyle === "terminal"}>
          <div data-slot="terminal">
            <div data-slot="window">
              <button
                type="button"
                data-slot="copy"
                aria-label={i18n.t("home.install.copyCommand", { command: installs[0].command })}
                onClick={copy}
              >
                <Show when={copied()} fallback={<CopyIcon />}>
                  <CheckIcon />
                </Show>
                <span aria-live="polite">{copied() ? i18n.t("site.action.copied") : i18n.t("site.action.copy")}</span>
              </button>
              <pre>
                <code>
                  <span data-slot="input" data-copy-command {...copyOnClick(copy)}>
                    {installs[0].command}
                  </span>
                  {"\n"}
                  <span data-slot="input">opencode</span>
                  {"\n"}
                  <span data-slot="input">/models</span>
                  {"\n\n"}
                  <span data-slot="output">Select model</span>
                  {"\n"}
                  <span data-slot="output">OpenCode</span>
                  <For each={content().freeModels}>
                    {(model, index) => (
                      <>
                        {"\n"}
                        <span data-slot={index() === 0 ? "selected" : "option"}>
                          {`${index() === 0 ? "●" : " "} ${model.padEnd(28)}Free`}
                        </span>
                      </>
                    )}
                  </For>
                </code>
              </pre>
            </div>
            <p data-slot="caption">{subscriptionLinks()}</p>
          </div>
        </Show>

        {/* "cards": two cells in the tools grid's borders. */}
        <Show when={import.meta.env.DEV || siteSettings.getStartedStyle === "cards"}>
          <ul
            data-component="tools"
            data-slot="cards"
            data-grid={siteSettings.toolGrid}
            aria-label={i18n.t("home.getStarted.waysToStart")}
          >
            <li>
              <a href={content().links.download}>
                <h3>
                  {i18n.t("home.getStarted.startFree")}
                  <ChevronRight />
                </h3>
                <p>{i18n.t("home.getStarted.startFreeBody")}</p>
              </a>
            </li>
            <li>
              <a href={content().links.go}>
                <h3>
                  {i18n.t("home.getStarted.goFurther")}
                  <ChevronRight />
                </h3>
                <p>{i18n.t("home.getStarted.goFurtherBody")}</p>
              </a>
            </li>
          </ul>
        </Show>
      </div>
    </section>
  )
}

/**
 * "Bring your own subs", before "Bring your own tools": log in with a subscription you have, or use
 * an OpenCode plan (lib/byos.ts). Laid out like that section, and the logos are its grid's tiles
 * (logos only, the names as tooltips), so they arrive with the same entrance. Settings ›
 * Subscriptions style explores three arrangements; every one renders in development and the
 * section's data-style (set before first paint for a saved value) shows one; production renders only
 * the default's (script/fold-settings.ts).
 */
function BringYourOwnSubs() {
  const i18n = useI18n()
  const language = useLanguage()
  const subs = createMemo(() => localize(language.locale(), "byos", byos))
  const [tab, setTab] = createSignal<"yours" | "ours">("yours")
  const yours = () => <ToolGrid items={subs().yours.items} label={subs().yours.label} iconTiles />
  const providers = () => <ToolGrid items={subs().providers} label={i18n.t("home.byos.providersLabel")} iconTiles />
  const goHref = () => subs().plansHref
  const select = (next: "yours" | "ours", focus?: boolean) => {
    setTab(next)
    if (focus) document.getElementById(`byos-tab-${next}`)?.focus()
  }
  return (
    <section
      data-component="block"
      data-section="byos"
      data-style={siteSettings.subsStyle}
      data-design="subsStyle"
      data-columns={siteSettings.toolsColumns.charAt(0)}
      data-copy-columns={copyColumnsAttribute(siteSettings.toolsCopyColumns, siteSettings.toolsColumns)}
    >
      {/* Laid out like "Bring your own tools" below it, with its column settings. */}
      <h2 data-slot="label">{subs().title}</h2>
      <div data-slot="body">
        <p data-slot="lead">
          <span data-design-copy="home.byos.headline">{designCopy("home.byos.headline", subs().headline)}</span>{" "}
          <span data-design-copy="home.byos.line">
            <Rich
              value={linkPhrases(
                designCopy("home.byos.line", subs().line),
                subs().planLinks.map((text) => ({ text, href: goHref() })),
              )}
            />
          </span>
          {/* Spelled out so the production build folds it (script/fold-settings.ts). */}
          <Show
            when={
              import.meta.env.DEV ||
              siteSettings.subsStyle === "A rows" ||
              siteSettings.subsStyle === "B wall" ||
              siteSettings.subsStyle === "C names"
            }
          >
            <ByosOptionLeads />
          </Show>
        </p>

        {/* "grid": the providers' grid. */}
        <Show when={import.meta.env.DEV || siteSettings.subsStyle === "grid"}>
          <div data-slot="grid">{providers()}</div>
        </Show>

        {/* "split": your subscriptions beside the models in OpenCode's plans. */}
        <Show when={import.meta.env.DEV || siteSettings.subsStyle === "split"}>
          <div data-slot="split">
            <div>
              <h3>{subs().yours.label}</h3>
              {yours()}
            </div>
            <div>
              <h3>{subs().ours.label}</h3>
              {providers()}
            </div>
          </div>
        </Show>

        {/* "tabs": one side at a time, in /brand's badge tabs. */}
        <Show when={import.meta.env.DEV || siteSettings.subsStyle === "tabs"}>
          <div data-slot="tabs">
            <div data-slot="tab-list" role="tablist" aria-label={i18n.t("site.nav.subscriptions")}>
              <For each={["yours", "ours"] as const}>
                {(id) => (
                  <button
                    type="button"
                    role="tab"
                    id={`byos-tab-${id}`}
                    aria-controls={`byos-panel-${id}`}
                    aria-selected={tab() === id ? "true" : "false"}
                    tabIndex={tab() === id ? 0 : -1}
                    onClick={() => select(id)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return
                      event.preventDefault()
                      select(id === "yours" ? "ours" : "yours", true)
                    }}
                  >
                    {id === "yours" ? subs().yours.label : subs().ours.label}
                  </button>
                )}
              </For>
            </div>
            <div id="byos-panel-yours" role="tabpanel" aria-labelledby="byos-tab-yours" hidden={tab() !== "yours"}>
              {yours()}
            </div>
            <div id="byos-panel-ours" role="tabpanel" aria-labelledby="byos-tab-ours" hidden={tab() !== "ours"}>
              {providers()}
            </div>
          </div>
        </Show>

        {/* A, B and C: showing that OpenCode works with nearly every subscription, provider and model. */}
        <Show
          when={
            import.meta.env.DEV ||
            siteSettings.subsStyle === "A rows" ||
            siteSettings.subsStyle === "B wall" ||
            siteSettings.subsStyle === "C names"
          }
        >
          <ByosOptions />
        </Show>
      </div>
    </section>
  )
}

/**
 * "Bring your own tools": a tile per service. With Settings › Tools animation on, the tiles arrive
 * in the shared entrance wash (reveal.ts), diagonally from the top left, the first time the grid
 * scrolls into view. Off by default. On a static page, src/client/islands/home.ts plays the wash.
 */
function ToolGrid(props: {
  items: readonly {
    name: string
    logo: string
    wordmark?: string
    metrics?: { aspect: number; density: number; centerY: number }
  }[]
  /** The list's accessible name. */
  label?: string
  /** Logo-only tiles whatever Settings › Tool tiles says: the mark centred, its name as a tooltip. */
  iconTiles?: boolean
}) {
  const i18n = useI18n()
  let grid: HTMLUListElement | undefined
  const animation = () => {
    const style = siteSettings.toolsAnimation
    if (style === "off") return undefined
    return style === "same as logos" ? siteSettings.logoAnimation : style
  }
  const wash = createWash(
    () => grid,
    () => animation() !== undefined,
  )
  const motion = () => {
    const style = animation()
    return wash.armed() && style ? { animation: style, vars: revealMotion(style, siteSettings.logoTuning) } : undefined
  }
  createEffect(on([animation, () => siteSettings.toolsStagger], wash.replay, { defer: true }))
  // The tiles' logos (SVG masks, index.css) load once the grid is within a screen of the window, so
  // a page doesn't fetch them with its first screen.
  onMount(() => {
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        grid?.setAttribute("data-near", "")
        near.disconnect()
      },
      { rootMargin: "100% 0px" },
    )
    if (grid) near.observe(grid)
    onCleanup(() => near.disconnect())
  })

  return (
    <ul
      data-component="tools"
      data-design="toolTiles toolGrid toolsAnimation toolsStagger"
      data-tiles={props.iconTiles ? "icon" : siteSettings.toolTiles}
      data-grid={siteSettings.toolGrid}
      data-entrance
      data-mounted={wash.mounted() ? "" : undefined}
      data-reveal={motion() ? "" : undefined}
      data-armed={motion() ? "" : undefined}
      data-animation={motion()?.animation}
      style={motion()?.vars}
      ref={grid}
      aria-label={props.label ?? i18n.t("home.tools.label")}
    >
      <For each={props.items}>
        {(tool, index) => {
          const delay = () => {
            const start = wash.start()
            if (!motion() || start === undefined) return undefined
            const at = start + washStep(index(), wash.columns() ?? 1, props.items.length) * siteSettings.toolsStagger
            return Math.max(0, Math.round(at - performance.now()))
          }
          return (
            <li>
              <span
                data-slot="brand"
                data-state={delay() === undefined ? undefined : "in"}
                style={
                  delay() === undefined ? undefined : { "--logo-delay": `${delay()}ms`, "--wipe-delay": `${delay()}ms` }
                }
              >
                <span data-slot="mark">
                  <Show
                    when={!props.iconTiles && siteSettings.toolTiles === "logo" && tool.wordmark}
                    fallback={
                      <>
                        <span
                          data-slot="icon"
                          role={props.iconTiles ? "img" : undefined}
                          aria-label={props.iconTiles ? tool.name : undefined}
                          aria-hidden={props.iconTiles ? undefined : "true"}
                          style={{ "--logo": `url(${tool.logo})` }}
                        />
                        {props.iconTiles ? null : tool.name}
                      </>
                    }
                  >
                    <span
                      data-slot="wordmark"
                      aria-hidden="true"
                      style={{
                        "--logo": `url(${tool.wordmark})`,
                        ...(tool.metrics ? balanceLogo(tool.metrics) : {}),
                      }}
                    />
                    <span data-slot="name">{tool.name}</span>
                  </Show>
                </span>
              </span>
            </li>
          )
        }}
      </For>
    </ul>
  )
}

// logo-soup's normalisation, as in LogoWall: wide logos grow less than their aspect ratio, and light
// logos grow while heavy ones shrink. Sizes are in multiples of --logo-size.
function balanceLogo(metrics: { aspect: number; density: number; centerY: number }) {
  const scale = Math.min(2, Math.max(0.5, (0.35 / metrics.density) ** 0.25))
  const width = metrics.aspect ** 0.5 * scale
  const height = width / metrics.aspect
  return {
    "--width": width.toFixed(3),
    "--height": height.toFixed(3),
    "--shift": (-metrics.centerY * height).toFixed(3),
  }
}

// Settings › Copy columns: only marked when the copy differs from the body columns, so matching
// widths keep each section's own copy measure (the Console's 34rem at two columns).
function copyColumnsAttribute(copy: "2 columns" | "3 columns", body: "2 columns" | "3 columns") {
  return copy === body ? undefined : copy.charAt(0)
}

// The top of the first visible carousel card (the skeleton's until the carousel streams in), in
// page coordinates, as --card-top on the root.
const cardTopScript = `(()=>{const r=document.documentElement,f=()=>{const m=[...document.querySelectorAll('[data-component="products-skeleton"] [data-slot="media"],[data-component="products"] [data-slot="media"]')].find(e=>e.getClientRects().length&&e.getBoundingClientRect().height);if(m)r.style.setProperty("--card-top",Math.round(m.getBoundingClientRect().top+scrollY)+"px")};f();addEventListener("resize",f)})()`
