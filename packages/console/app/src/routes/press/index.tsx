import { Rich } from "~/component/site/rich-text"
import { rich } from "~/i18n/rich"
import { Marked } from "~/component/site/marked"
import "~/component/site/doc-list.css"
import "./index.css"
import { Title, Meta } from "@solidjs/meta"
import { createAsync } from "@solidjs/router"
import { Dynamic } from "solid-js/web"
import { createMemo, createSignal, For, Match, onCleanup, onMount, Show, Switch, type JSX } from "solid-js"
import { LocaleLinks } from "~/component/locale-links"
import { ShareMeta } from "~/component/share-meta"
import { ogImage } from "~/lib/og"
import { breadcrumbData, JsonLd } from "~/component/structured-data"
import { Site, SettingsSelect, type SettingsSectionID } from "~/component/site/site"
import {
  pressBoilerplates,
  pressCompanyStyles,
  pressContactStyles,
  pressCopyStyles,
  pressMediaLayouts,
  setSiteSetting,
  siteSettings,
  toggles,
} from "~/component/site/settings"
import { useMarkdown } from "~/component/site/use-markdown"
import { Faq } from "~/component/faq"
import { ContentsMenu, OnThisPage, SectionHeading, slug } from "~/component/site/on-this-page"
import { AgentRulesButton } from "~/component/site/agent-rules-button"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { englishText, localize } from "~/i18n/content"
import { source } from "~/i18n/content/source"
import { changelog } from "~/lib/changelog"
import { brandContent, brandMarkdown } from "~/lib/brand-content"
import { pressContent, pressMarkdown, pressReleases } from "~/lib/press-content"
import { MediaGallery } from "./media-gallery"
import { PageTitle } from "~/component/site/sticky-title"
import { ExternalArrow } from "~/component/site/icons"

// One-line Anomaly projects for Settings › Press Anomaly projects "list".
const projectLines: Record<string, string> = {
  OpenCode: "The open source coding agent.",
  SST: "Build full-stack apps on your own infrastructure.",
  OpenTUI: "A library to build terminal user interfaces.",
  "Models.dev": "An open source database of AI models.",
  Hex: "Local voice dictation for Mac, Windows and Linux.",
  OpenTunnel: "Encrypted public URLs for apps on your machine.",
}

export default function Press() {
  const i18n = useI18n()
  const language = useLanguage()
  const content = createMemo(() => localize(language.locale(), "press", pressContent(i18n.t, language.route)))
  // Heading ids stay English in every locale, so links to /press#contact keep working.
  const english = createMemo(() => englishText(content(), source.press))
  const anchor = (text: string) => slug(english().get(text) ?? text)
  const data = createAsync(() => changelog())
  const releases = createMemo(() => pressReleases(data() ?? [], language.route, language.tag(language.locale())))
  const markdown = useMarkdown("/press", pressMarkdown, { releases: () => data() ?? [] })
  const [copied, setCopied] = createSignal<string>()
  // The boilerplate accordion: OpenCode open from the server render. Rows animate only once someone
  // has toggled one, so the first paint never runs the opening animation.
  const [openProducts, setOpenProducts] = createSignal(["OpenCode"])
  const [accordionReady, setAccordionReady] = createSignal(false)
  onMount(() => {
    // A link to a closed row (#boilerplate-…, or anything inside one) opens it.
    const reveal = () => {
      const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null
      const row = target?.closest<HTMLElement>('[data-slot="boilerplate-accordion"] > li')
      const name = row?.querySelector('[data-slot="faq-question-text"]')?.textContent
      if (!row || !name) return
      setOpenProducts((list) => (list.includes(name) ? list : [...list, name]))
      requestAnimationFrame(() => target?.scrollIntoView())
    }
    reveal()
    window.addEventListener("hashchange", reveal)
    onCleanup(() => window.removeEventListener("hashchange", reveal))
  })
  // "Copy rules for your agent" copies the Brand page's own Markdown, so the two never drift.
  const brandRules = useMarkdown("/brand", brandMarkdown)
  const rulesLabel = createMemo(() => localize(language.locale(), "brand", brandContent(i18n.t)).hero.copy)

  // The sections in page order, for "Contents". Hidden sections leave the list too.
  const sections = createMemo(() =>
    [
      content().about.title,
      content().facts.title,
      siteSettings.pressMilestones === "on" ? content().milestones.title : undefined,
      content().product.title,
      siteSettings.pressNews === "on" ? content().news.title : undefined,
      siteSettings.pressMedia === "on" ? content().media.title : undefined,
      content().brand.title,
      content().people.items.length > 0 ? content().people.title : undefined,
      content().company.title,
      content().anomalyLogo.title,
      content().coverage.items.length > 0 ? content().coverage.title : undefined,
      content().contact.title,
    ]
      .filter((title) => title !== undefined)
      .map((title) => ({ id: anchor(title), title })),
  )

  /** Copies text and marks `key` as copied for a moment. */
  const copy = (key: string, value: string) => {
    void navigator.clipboard.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied((current) => (current === key ? undefined : current)), 1500)
  }

  /** Copies an SVG file's text (a promised ClipboardItem keeps the click's activation in Safari). */
  const copySvg = (file: string, url: string) => {
    void navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": fetch(url)
          .then((response) => response.text())
          .then((text) => new Blob([text], { type: "text/plain" })),
      }),
    ])
    setCopied(`svg:${file}`)
    setTimeout(() => setCopied((current) => (current === `svg:${file}` ? undefined : current)), 1500)
  }

  /** A section heading: a plain title above the section that copies its address when clicked. */
  const Heading = (props: { id: string; children: string }) => (
    <SectionHeading id={props.id} title={props.children} label />
  )

  /**
   * A boilerplate paragraph with a label and a way to copy it, by Settings › Press copy style: the
   * label and a copy icon as one button (default), a mono "Copy" link, an icon that shows on hover or
   * focus, the text itself as the button, or a small neutral button. Each is a real button, with "Copied" announced.
   */
  const Boilerplate = (props: { id: string; label: string; value: string; level?: 3 | 4; product?: string }) => {
    const done = () => copied() === props.id
    const run = () => copy(props.id, props.value)
    const style = () => siteSettings.pressCopyStyle
    const label = () => (language.locale() === "en" ? props.label.toLowerCase() : props.label)
    const name = () =>
      props.product
        ? i18n.t("press.ui.copyFor", { label: label(), product: props.product })
        : i18n.t("press.ui.copy", { label: label() })
    return (
      <div data-component="boilerplate" data-copy={style()} data-copied={done() ? "" : undefined}>
        {/* The label on the left; the copy action at the top right, on the same row. */}
        <div data-slot="head">
          <Show
            when={style() === "label"}
            fallback={<Dynamic component={props.level === 4 ? "h4" : "h3"}>{props.label}</Dynamic>}
          >
            {/* "label": the label and the copy icon are one button; the icon turns into a check. */}
            <Dynamic component={props.level === 4 ? "h4" : "h3"}>
              <button type="button" data-slot="copy-label" aria-label={name()} onClick={run}>
                {props.label}
                <Show when={done()} fallback={<CopyIcon />}>
                  <CheckIcon />
                </Show>
              </button>
            </Dynamic>
          </Show>
          <Switch>
            <Match when={style() === "link"}>
              <button type="button" data-slot="copy-link" onClick={run}>
                <span aria-hidden="true">{done() ? i18n.t("site.action.copied") : i18n.t("site.action.copy")}</span>
                <span data-slot="sr-only">{name()}</span>
              </button>
            </Match>
            <Match when={style() === "icon"}>
              <button
                type="button"
                data-slot="copy-icon"
                data-tip={i18n.t("press.ui.copyText")}
                data-tip-align="center"
                onClick={run}
              >
                <Show when={done()} fallback={<CopyIcon />}>
                  <CheckIcon />
                </Show>
                <span data-slot="sr-only">{name()}</span>
              </button>
            </Match>
            <Match when={style() === "click"}>
              <span data-slot="copy-hint" aria-hidden="true">
                {done() ? i18n.t("site.action.copied") : i18n.t("press.ui.clickToCopy")}
              </span>
            </Match>
            <Match when={style() === "button"}>
              <button type="button" data-component="site-button" data-variant="neutral" onClick={run}>
                <span data-slot="copy-labels" aria-hidden="true">
                  <span data-active={done() ? undefined : ""}>{i18n.t("press.ui.copyText")}</span>
                  <span data-active={done() ? "" : undefined}>{i18n.t("site.action.copied")}</span>
                </span>
                <span data-slot="sr-only">{name()}</span>
                <CopyIcon />
              </button>
            </Match>
          </Switch>
        </div>
        <Show when={style() === "click"} fallback={<p data-slot="text">{props.value}</p>}>
          <button type="button" data-slot="copy-text" onClick={run}>
            <span data-slot="text">{props.value}</span>
            <span data-slot="sr-only">{name()}</span>
          </button>
        </Show>
        <span data-slot="sr-only" aria-live="polite">
          {done() ? i18n.t("site.action.copied") : ""}
        </span>
      </div>
    )
  }

  const Section = (props: { title: string; design?: string; children: JSX.Element }) => (
    <section data-component="block" data-design={props.design}>
      <Heading id={anchor(props.title)}>{props.title}</Heading>
      <div data-slot="body">{props.children}</div>
    </section>
  )

  // Created once: Site reads its aside more than once, and a fresh element each time breaks hydration.
  const aside = <OnThisPage items={sections()} />

  return (
    <Site
      page="press"
      markdown={markdown}
      settings={import.meta.env.DEV ? (section) => <PressSettings section={section} /> : undefined}
      aside={siteSettings.pressToc === "on" ? aside : undefined}
    >
      <Title>{content().title}</Title>
      <ShareMeta title={content().title} description={content().description} image={ogImage("/press")} />
      <LocaleLinks path="/press" />
      <Meta name="description" content={content().description} />
      <JsonLd
        data={breadcrumbData([
          { name: i18n.t("nav.home"), path: language.route("/") },
          { name: content().hero.title, path: language.route("/press") },
        ])}
      />

      <section data-component="hero">
        <PageTitle title={content().hero.title} />
        <p data-slot="intro">{content().hero.body}</p>
      </section>

      <Show when={siteSettings.pressToc === "on"}>
        <ContentsMenu items={sections()} />
      </Show>

      <Section title={content().about.title} design="pressBoilerplate pressCopyStyle">
        {/* OpenCode first, then the company's other products, each a row of the site's FAQ accordion
            with its long and short text. OpenCode starts open; any number of rows can be open. */}
        <ul data-component="faq" data-slot="boilerplate-accordion" data-ready={accordionReady() ? "" : undefined}>
          <For each={[{ name: "OpenCode", ...content().about.boilerplate }, ...content().about.products]}>
            {(product) => (
              <li id={`boilerplate-${slug(product.name)}`}>
                <Faq
                  question={product.name}
                  heading
                  open={openProducts().includes(product.name)}
                  onOpenChange={(next) => {
                    setAccordionReady(true)
                    setOpenProducts((list) =>
                      next ? [...list, product.name] : list.filter((name) => name !== product.name),
                    )
                  }}
                >
                  <div data-component="boilerplate-group">
                    <Boilerplate
                      id={`${product.name}-long`}
                      level={4}
                      product={product.name}
                      label={
                        siteSettings.pressBoilerplate === "long + short"
                          ? i18n.t("press.ui.longVersion")
                          : i18n.t("press.ui.boilerplate")
                      }
                      value={product.long}
                    />
                    <Show when={siteSettings.pressBoilerplate === "long + short"}>
                      <Boilerplate
                        id={`${product.name}-short`}
                        level={4}
                        product={product.name}
                        label={i18n.t("press.ui.shortVersion")}
                        value={product.short}
                      />
                    </Show>
                  </div>
                </Faq>
              </li>
            )}
          </For>
        </ul>
      </Section>

      <Section title={content().facts.title}>
        <dl data-component="facts">
          <For each={content().facts.items}>
            {(fact) => (
              <div>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            )}
          </For>
        </dl>
      </Section>

      <Show when={siteSettings.pressMilestones === "on"}>
        <Section title={content().milestones.title} design="pressMilestones">
          <ol data-component="press-timeline" data-variant="milestones">
            <For each={content().milestones.items}>
              {(item) => (
                <li>
                  <span data-slot="marker" aria-hidden="true" />
                  <span data-slot="date">{item.date}</span>
                  <span data-slot="text">{item.text}</span>
                </li>
              )}
            </For>
          </ol>
        </Section>
      </Show>

      <Section title={content().product.title}>
        <ul data-component="product-list" data-variant="cards">
          <For each={content().product.items}>
            {(product) => (
              <li>
                {/* The whole item is the link, named by the product and described by its text. */}
                <a href={product.href} data-slot="row-link" aria-describedby={`product-${slug(product.name)}`}>
                  <strong>{product.name}</strong>
                  <span id={`product-${slug(product.name)}`}>{product.body}</span>
                </a>
              </li>
            )}
          </For>
        </ul>
      </Section>

      <Show when={siteSettings.pressNews === "on"}>
        <Section title={content().news.title} design="pressNews">
          <p data-slot="text">{content().news.intro}</p>
          {/* Releases load from GitHub after the page; the links work either way. */}
          <Show when={releases().length > 0}>
            <ol data-component="press-timeline" data-variant="releases">
              <For each={releases()}>
                {(release) => (
                  <li>
                    <span data-slot="marker" aria-hidden="true" />
                    <div data-slot="meta">
                      <span data-slot="date">{release.date}</span>
                      {/* The row's one link: its ::after stretches over the whole row. */}
                      <a
                        href={release.href}
                        data-slot="version"
                        aria-label={`${release.tag}, ${release.features[0]}`}
                        lang="en"
                      >
                        {release.tag}
                      </a>
                    </div>
                    {/* Release titles come from the English release notes. */}
                    <div data-slot="entry" lang="en">
                      <strong>{release.features[0]}</strong>
                      <Show when={release.features.length > 1}>
                        <span>{release.features.slice(1).join(" · ")}</span>
                      </Show>
                    </div>
                  </li>
                )}
              </For>
            </ol>
          </Show>
          <p data-slot="text">
            <a href={content().news.changelog.href}>{content().news.changelog.text}</a>
            {" · "}
            <a href={content().news.feed.href}>{content().news.feed.text}</a>
          </p>
        </Section>
      </Show>

      <Show when={siteSettings.pressMedia === "on"}>
        <Section title={content().media.title} design="pressMedia pressMediaLayout">
          <div data-slot="paragraphs">
            <p data-slot="text">{content().media.intro}</p>
            <p data-slot="text">{content().media.note}</p>
          </div>
          <div data-slot="links">
            <a href={content().media.all.href} download="opencode-press-media.zip" data-component="site-button">
              {content().media.all.text}
              <span data-slot="size">{content().media.all.size}</span>
              <DownloadIcon />
            </a>
          </div>
          <MediaGallery products={content().media.products} style={siteSettings.pressMediaLayout} />
        </Section>
      </Show>

      <Section title={content().brand.title}>
        <div data-slot="paragraphs">
          <p data-slot="text">
            {content().brand.before}
            <a href={content().brand.link.href}>{content().brand.link.text}</a>
            {content().brand.after}
          </p>
          <p data-slot="text">{content().brand.usage}</p>
        </div>
        <div data-slot="links">
          <a href={content().brand.all.href} download="opencode-brand-assets.zip" data-component="site-button">
            {content().brand.all.text}
            <DownloadIcon />
          </a>
          <AgentRulesButton label={rulesLabel().text} copied={rulesLabel().copied} source={brandRules.source} />
        </div>
      </Section>

      <Show when={content().people.items.length > 0}>
        <Section title={content().people.title}>
          <ul data-component="press-people">
            <For each={content().people.items}>
              {(person) => (
                <li>
                  <Show when={person.photo}>{(photo) => <img src={photo()} alt={person.name} loading="lazy" />}</Show>
                  <Show when={person.href} fallback={<strong>{person.name}</strong>}>
                    {(href) => <a href={href()}>{person.name}</a>}
                  </Show>
                  <span data-slot="role">{person.role}</span>
                  <span>{person.bio}</span>
                </li>
              )}
            </For>
          </ul>
          <Show when={content().people.photosZip}>
            {(zip) => (
              <div data-slot="links">
                <a
                  href={zip()}
                  download="opencode-press-photos.zip"
                  data-component="site-button"
                  data-variant="neutral"
                >
                  Download photos and bios
                  <DownloadIcon />
                </a>
              </div>
            )}
          </Show>
        </Section>
      </Show>

      <Section title={content().company.title} design="pressCompany">
        <div data-slot="paragraphs">
          <p data-slot="text">{content().company.lead}</p>
          <p data-slot="text">
            <Rich value={rich(content().company.more, content().company.links)} />
          </p>
        </div>
        {/* The legal index's list (doc-list.css): the same rows, type, spacing and hover. */}
        <ul
          data-component="legal-list"
          data-style="rows"
          data-hover={siteSettings.legalRowHover}
          data-slot="projects"
          data-design="pressCompany legalRowHover"
        >
          <For each={content().company.projects}>
            {(project) => {
              // OpenCode is this site; the other projects open in a new tab.
              const external = !project.href.startsWith("https://opencode.ai")
              return (
                <li>
                  <a
                    href={project.href}
                    target={external ? "_blank" : undefined}
                    rel={external ? "noopener" : undefined}
                    aria-label={external ? i18n.t("site.newTab", { label: project.name }) : project.name}
                    aria-describedby={`project-${slug(project.name)}`}
                  >
                    <span data-slot="title">
                      {project.name}
                      {/* The nav's new-tab arrow, 6px after the name. */}
                      <Show when={external}>
                        <ExternalArrow />
                      </Show>
                    </span>
                    <span data-slot="description" id={`project-${slug(project.name)}`}>
                      {siteSettings.pressCompany === "list" ? projectLines[project.name] : project.body}
                    </span>
                  </a>
                </li>
              )
            }}
          </For>
        </ul>
        <p data-slot="text">
          <Rich value={rich(content().company.learnMore, content().company.links)} />
        </p>
      </Section>

      <Section title={content().anomalyLogo.title}>
        <p data-slot="text">{content().anomalyLogo.body}</p>
        <div data-slot="links">
          <a href={content().anomalyLogo.all.href} download="anomaly-logo.zip" data-component="site-button">
            <Marked
              text={i18n.t("press.ui.anomalyAll", { label: content().anomalyLogo.all.text })}
              slots={{ sr: "sr-only" }}
            />
            <span data-slot="size">{content().anomalyLogo.all.size}</span>
            <DownloadIcon />
          </a>
        </div>
        <ul data-component="logo-tiles">
          <For each={content().anomalyLogo.assets}>
            {(asset) => {
              const detail = i18n.t("press.ui.anomalyAsset", {
                name: language.locale() === "en" ? asset.name.toLowerCase() : asset.name,
              })
              return (
                <li>
                  <span data-slot="name">{asset.name}</span>
                  <div
                    data-slot="preview"
                    data-tone={asset.color === "black" ? "light" : "dark"}
                    data-kind={asset.kind}
                  >
                    <img
                      src={asset.svg}
                      width={asset.width}
                      height={asset.height}
                      alt={`Anomaly ${language.locale() === "en" ? asset.name.toLowerCase() : asset.name}`}
                    />
                  </div>
                  <div data-slot="meta">
                    <div data-slot="actions">
                      <a
                        href={asset.png}
                        download={`${asset.file}.png`}
                        data-component="site-button"
                        data-variant="neutral"
                      >
                        <Marked
                          text={i18n.t("press.ui.fileOf", { format: "PNG", title: detail })}
                          slots={{ sr: "sr-only" }}
                        />
                        <DownloadIcon />
                      </a>
                      <a
                        href={asset.svg}
                        download={`${asset.file}.svg`}
                        data-component="site-button"
                        data-variant="neutral"
                      >
                        <Marked
                          text={i18n.t("press.ui.fileOf", { format: "SVG", title: detail })}
                          slots={{ sr: "sr-only" }}
                        />
                        <DownloadIcon />
                      </a>
                      <button
                        type="button"
                        data-component="site-button"
                        data-variant="neutral"
                        data-slot="copy-square"
                        data-tip={i18n.t("brand.ui.copySvg")}
                        data-tip-align="center"
                        aria-label={i18n.t("press.ui.copySvgOf", { detail })}
                        onClick={() => copySvg(asset.file, asset.svg)}
                      >
                        <Show when={copied() === `svg:${asset.file}`} fallback={<CopyIcon />}>
                          <CheckIcon />
                        </Show>
                      </button>
                    </div>
                  </div>
                </li>
              )
            }}
          </For>
        </ul>
        <span data-slot="sr-only" aria-live="polite">
          {copied()?.startsWith("svg:") ? i18n.t("site.action.copied") : ""}
        </span>
      </Section>

      <Show when={content().coverage.items.length > 0}>
        <Section title={content().coverage.title}>
          <ol data-component="press-rows">
            <For each={content().coverage.items}>
              {(item) => (
                <li>
                  <span data-slot="meta">{item.outlet}</span>
                  <span data-slot="text">
                    <a href={item.href}>{item.title}</a> {item.type} · {item.date}
                  </span>
                </li>
              )}
            </For>
          </ol>
        </Section>
      </Show>

      <Section title={content().contact.title} design="pressContact">
        <ul data-component="press-contacts" data-style={siteSettings.pressContact}>
          <For each={content().contact.items}>
            {(item) => (
              <li>
                <h3>{item.title}</h3>
                <p data-slot="text">{item.body}</p>
                <p data-slot="text">
                  <For each={item.links}>
                    {(entry, index) => (
                      <>
                        <Show when={index() > 0}>{" · "}</Show>
                        <a href={entry.href}>{entry.text}</a>
                      </>
                    )}
                  </For>
                </p>
              </li>
            )}
          </For>
        </ul>
      </Section>
    </Site>
  )
}

/** Settings › Other rows for this page's judgement calls. */
function PressSettings(props: { section: SettingsSectionID }) {
  return (
    <Show when={props.section === "other"}>
      <SettingsSelect
        label="Press: on this page"
        options={toggles}
        value={siteSettings.pressToc}
        onChange={(value) => setSiteSetting("pressToc", value)}
      />
      <SettingsSelect
        label="Press boilerplate"
        options={pressBoilerplates}
        value={siteSettings.pressBoilerplate}
        onChange={(value) => setSiteSetting("pressBoilerplate", value)}
      />
      <SettingsSelect
        label="Press milestones"
        options={toggles}
        value={siteSettings.pressMilestones}
        onChange={(value) => setSiteSetting("pressMilestones", value)}
      />
      <SettingsSelect
        label="Press latest releases"
        options={toggles}
        value={siteSettings.pressNews}
        onChange={(value) => setSiteSetting("pressNews", value)}
      />
      <SettingsSelect
        label="Press media"
        options={toggles}
        value={siteSettings.pressMedia}
        onChange={(value) => setSiteSetting("pressMedia", value)}
      />
      <SettingsSelect
        label="Press Anomaly projects"
        options={pressCompanyStyles}
        value={siteSettings.pressCompany}
        onChange={(value) => setSiteSetting("pressCompany", value)}
      />
      <SettingsSelect
        label="Press contacts"
        options={pressContactStyles}
        value={siteSettings.pressContact}
        onChange={(value) => setSiteSetting("pressContact", value)}
      />
      <SettingsSelect
        label="Press copy style"
        options={pressCopyStyles}
        value={siteSettings.pressCopyStyle}
        onChange={(value) => setSiteSetting("pressCopyStyle", value)}
      />
      <SettingsSelect
        label="Press media layout"
        options={pressMediaLayouts}
        value={siteSettings.pressMediaLayout}
        onChange={(value) => setSiteSetting("pressMediaLayout", value)}
      />
    </Show>
  )
}

function DownloadIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M13.9583 10.6247L10 14.583L6.04167 10.6247M10 2.08301V13.958M16.25 17.9163H3.75"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="square"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4.5 10.5L8.25 14.25L15.5 6" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg data-slot="download-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7.5 7.5V3.75H16.25V12.5H12.5M3.75 7.5H12.5V16.25H3.75V7.5Z" stroke="currentColor" stroke-width="1.5" />
    </svg>
  )
}
