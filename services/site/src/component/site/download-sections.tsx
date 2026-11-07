import { Marked } from "./marked"
import "./download-sections.css"
import { createMemo, createSignal, For, Match, onMount, Show, Switch, type JSX } from "solid-js"
import { Faq } from "~/component/faq"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { detectDesktopBuild, detectOS, requestOS, type OS } from "~/lib/download"
import type { DownloadPlatform } from "~/routes/download/types"
import { downloadContent, productDownloads } from "~/lib/download-content"
import { localize } from "~/i18n/content"
import { productDownloadsSource } from "~/i18n/content/areas/product-downloads"
import { NewTab } from "./icons"
import { PairPanel } from "./pair-panel"
import { SectionHeading } from "./on-this-page"
import type { PageSlug } from "./product-data"
import { Rich } from "./rich-text"
import { PlatformIcon } from "./site"
import { copyOnClick } from "~/lib/clipboard"

type Command = { id: string; command: string }

/** The copied-command state for one set of rows, and the copy action. */
function useCopy() {
  const [copied, setCopied] = createSignal<string>()
  const copy = (item: Command) => {
    void navigator.clipboard.writeText(item.command)
    setCopied(item.id)
    setTimeout(() => setCopied((current) => (current === item.id ? undefined : current)), 1500)
  }
  return { copied, copy }
}

/**
 * One copyable command as a list row: the method, the command, and a neutral Copy button. Clicking
 * the command copies too; the button alone says so (and is the keyboard's way in). `copies` names
 * what it installs for the funnel's `ui.copied` (lib/funnel.ts), and the item's id the method.
 */
function CopyRow(props: { item: Command; method: string; copies: string; state: ReturnType<typeof useCopy> }) {
  const i18n = useI18n()
  return (
    // data-funnel makes the row a control for the tracker, as a click on its command copies too.
    <li data-slot="copy-row" data-funnel-copy={props.copies} data-funnel-method={props.item.id} data-funnel="copy">
      <span data-slot="method">{props.method}</span>
      <span
        data-slot="name"
        data-copy-command
        translate="no"
        title={props.item.command}
        {...copyOnClick(() => props.state.copy(props.item))}
      >
        {props.item.command}
      </span>
      <button
        type="button"
        data-component="site-button"
        data-variant="neutral"
        aria-live="polite"
        onClick={() => props.state.copy(props.item)}
      >
        <Marked
          text={i18n.t(
            props.state.copied() === props.item.id ? "site.action.copiedCommand" : "site.action.copyCommand",
            {
              method: props.method,
            },
          )}
          slots={{ sr: "sr-only" }}
        />
      </button>
    </li>
  )
}

/**
 * Every row action takes the width of the widest one in `root`, whatever the language, so the
 * buttons line up. Measured after web fonts load; fallback font widths differ.
 */
function alignActions(root: HTMLElement) {
  void document.fonts.ready.then(() => {
    const buttons = [
      ...root.querySelectorAll<HTMLElement>('[data-component="download-list"] [data-component="site-button"]'),
    ]
    root.style.setProperty("--action-width", `${Math.max(...buttons.map((button) => button.scrollWidth))}px`)
  })
}

/**
 * The download sections (Desktop, Terminal, Mobile, Extensions, FAQ), at the bottom of
 * /product. `heading` draws each section's
 * title (an id for anchors, then the title); `columns` marks the blocks for the /product
 * title-in-the-first-column layout. `apps: false` leaves out the Desktop, Terminal and Mobile
 * sections (/product has those on its cards); `editors: false` the editor Extensions one. `firstId`
 * replaces the first section's id, so a page's own anchor (/product#download) lands on it.
 * `beforeFaq` goes right above the FAQ.
 */
export function DownloadSections(props: {
  heading: (id: string, title: string) => JSX.Element
  columns?: boolean
  apps?: boolean
  editors?: boolean
  firstId?: string
  beforeFaq?: JSX.Element
}) {
  const i18n = useI18n()
  const language = useLanguage()
  const content = createMemo(() => localize(language.locale(), "download", downloadContent(i18n.t, language.route)))
  const state = useCopy()
  let root!: HTMLDivElement

  onMount(() => alignActions(root))

  const Section = (section: { id: string; title: string; children: JSX.Element }) => (
    <section data-component="block" data-section={section.id} data-columns={props.columns ? "" : undefined}>
      {props.heading(section.id, section.title)}
      <div data-slot="body">{section.children}</div>
    </section>
  )

  return (
    <div data-component="download-sections" ref={root}>
      <Show when={props.apps !== false}>
        <Section id={props.firstId ?? "download-desktop"} title={content().desktop.title}>
          <DesktopList os={null} state={state} />
        </Section>

        <Section id="download-terminal" title={content().terminal.title}>
          <ul data-component="download-list">
            <For each={content().terminal.installs}>
              {(item) => <CopyRow item={item} method={item.id} copies="terminal" state={state} />}
            </For>
          </ul>
        </Section>

        <Section id="download-mobile" title={content().mobile.title}>
          <MobileList />
        </Section>
      </Show>

      <Show when={props.editors !== false}>
        <Section
          id={props.apps === false ? (props.firstId ?? "download-extensions") : "download-extensions"}
          title={content().extensions.title}
        >
          <LinkList items={content().extensions.items} action={content().actions.install} />
        </Section>
      </Show>

      {props.beforeFaq}

      <Section id="download-faq" title={content().faq.title}>
        <ul data-component="faq">
          <For each={content().faq.items}>
            {(item) => (
              <li>
                <Faq question={item.question}>
                  <Rich value={item.answer} />
                </Faq>
              </li>
            )}
          </For>
        </ul>
      </Section>
    </div>
  )
}

/**
 * The desktop builds and the Homebrew cask. With `os`, that computer's builds come first, and
 * `build` (the one exact build detected) is marked, for a product page; without, they keep their own order. The first row of each
 * OS is its anchor (/desktop#macos), linked from the Desktop page's intro.
 */
function DesktopList(props: { os: OS; build?: DownloadPlatform; state: ReturnType<typeof useCopy> }) {
  const i18n = useI18n()
  const language = useLanguage()
  const content = createMemo(() => localize(language.locale(), "download", downloadContent(i18n.t, language.route)))
  const builds = () => {
    const all = content().desktop.builds
    return props.os
      ? [...all.filter((b) => b.platform === props.os), ...all.filter((b) => b.platform !== props.os)]
      : all
  }
  return (
    <ul data-component="download-list">
      <For each={builds()}>
        {(build, index) => (
          <li
            id={
              builds().findIndex((item) => item.platform === build.platform) === index()
                ? build.platform.toLowerCase()
                : undefined
            }
            data-current={build.id === props.build ? "" : undefined}
          >
            <PlatformIcon platform={build.platform} />
            <span data-slot="name">
              {build.label}
              {/* Only the one build the browser could pin down (detectDesktopBuild), never two. */}
              <Show when={build.id === props.build}>
                <span data-slot="detail">{i18n.t("site.download.thisComputer")}</span>
              </Show>
            </span>
            <a href={build.href} data-component="site-button">
              {content().actions.download}
            </a>
          </li>
        )}
      </For>
      <CopyRow item={content().desktop.install} method="brew" copies="desktop" state={props.state} />
    </ul>
  )
}

/**
 * The mobile rows: the iPhone beta on TestFlight (a new tab, with TestFlight's mark) and Google
 * Play. A store that is coming soon (androidStatus) gets an unavailable "Coming soon" button.
 */
function MobileList() {
  const i18n = useI18n()
  const language = useLanguage()
  const content = createMemo(() => localize(language.locale(), "download", downloadContent(i18n.t, language.route)))
  return (
    <ul data-component="download-list">
      <For each={content().mobile.stores}>
        {(store) => (
          <li>
            <PlatformIcon platform={store.beta ? "TestFlight" : store.platform} />
            <span data-slot="name">
              {store.label} <span data-slot="detail">{store.device}</span>
            </span>
            <Show
              when={store.soon}
              fallback={
                <a
                  href={store.href}
                  data-component="site-button"
                  target={store.beta ? "_blank" : undefined}
                  rel={store.beta ? "noopener" : undefined}
                  aria-label={
                    store.beta
                      ? i18n.t("site.newTab", {
                          label: i18n.t("site.action.forOsBeta", { os: store.device }),
                        })
                      : undefined
                  }
                >
                  {content().actions.download}
                  <Show when={store.beta}>
                    <NewTab />
                  </Show>
                </a>
              }
            >
              <button
                type="button"
                data-component="site-button"
                aria-disabled="true"
                aria-label={i18n.t("site.action.comingSoonFor", { os: store.device })}
              >
                {i18n.t("site.action.comingSoon")}
              </button>
            </Show>
          </li>
        )}
      </For>
    </ul>
  )
}

function LinkList(props: { items: readonly { label: string; href: string; external?: boolean }[]; action: string }) {
  return (
    <ul data-component="download-list">
      <For each={props.items}>
        {(item) => (
          <li>
            <span data-slot="name">{item.label}</span>
            <a
              href={item.href}
              target={item.external ? "_blank" : undefined}
              rel={item.external ? "noopener" : undefined}
              data-component="site-button"
              data-variant="neutral"
            >
              {props.action}
              <Show when={item.external}>
                <NewTab />
              </Show>
            </a>
          </li>
        )}
      </For>
    </ul>
  )
}

/**
 * A product page's "Download" section, below its features: that product's builds, stores or install
 * commands from the same data as /product (lib/download-content.ts), under the page's usual section
 * heading, at #download. The Terminal page installs rather than downloads, so its section is
 * "Install" at #install, and the section keeps #download for links made before the rename.
 */
export function ProductDownload(props: { slug: PageSlug }) {
  const i18n = useI18n()
  const language = useLanguage()
  const content = createMemo(() => localize(language.locale(), "download", downloadContent(i18n.t, language.route)))
  const details = createMemo(
    () =>
      localize(language.locale(), "productDownloads", {
        ...productDownloadsSource,
        [props.slug]: productDownloads(props.slug, language.route),
      })[props.slug],
  )
  const [os, setOS] = createSignal<OS>(requestOS())
  const [build, setBuild] = createSignal<DownloadPlatform>()
  const state = useCopy()
  let root!: HTMLDivElement

  onMount(() => {
    setOS(detectOS())
    if (props.slug === "desktop") void detectDesktopBuild().then(setBuild)
    alignActions(root)
  })

  return (
    <section
      id={props.slug === "terminal" ? "download" : undefined}
      data-component="block"
      data-slot="product-download"
      data-section="download"
    >
      <SectionHeading
        id={props.slug === "terminal" ? "install" : "download"}
        title={i18n.t(props.slug === "terminal" ? "download.action.install" : "download.action.download")}
        label
      />
      <div data-slot="body" ref={root}>
        <Show when={details().lead}>{(lead) => <p data-slot="lead">{lead()}</p>}</Show>
        <Switch>
          <Match when={props.slug === "desktop"}>
            <DesktopList os={os()} build={build()} state={state} />
          </Match>
          <Match when={props.slug === "mobile"}>
            <MobileList />
            <PairPanel />
          </Match>
          <Match when={props.slug === "ide"}>
            <LinkList items={details().links} action={content().actions.install} />
          </Match>
        </Switch>
        <Show when={details().commandsLead}>{(lead) => <p data-slot="lead">{lead()}</p>}</Show>
        <Show when={details().commands.length > 0}>
          <ul data-component="download-list">
            <For each={details().commands}>
              {(item) => <CopyRow item={item} method={item.id} copies={props.slug} state={state} />}
            </For>
          </ul>
        </Show>
        <Show when={details().more}>
          {(more) => (
            <a href={more().href} data-slot="more">
              {more().label}
            </a>
          )}
        </Show>
      </div>
    </section>
  )
}

/** The extension pages' Install section, in the product pages' Download style, at #download. */
export function ExtensionDownload(props: {
  lead: string
  command?: string
  commands?: { method: string; command: string }[]
}) {
  const i18n = useI18n()
  const state = useCopy()
  let root!: HTMLDivElement
  onMount(() => alignActions(root))
  return (
    <section data-component="block" data-slot="product-download" data-section="download">
      <SectionHeading id="download" title={i18n.t("download.action.install")} label />
      <div data-slot="body" ref={root}>
        <p data-slot="lead">{props.lead}</p>
        <Show when={props.commands ?? (props.command ? [{ method: props.command.split(" ")[0], command: props.command }] : undefined)}>
          {(commands) => (
            <ul data-component="download-list">
              <For each={commands()}>
                {(item) => (
                  <CopyRow
                    item={{ id: item.method, command: item.command }}
                    method={item.method}
                    copies="extension"
                    state={state}
                  />
                )}
              </For>
            </ul>
          )}
        </Show>
      </div>
    </section>
  )
}
