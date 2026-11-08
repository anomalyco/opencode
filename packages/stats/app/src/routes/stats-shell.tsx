import { query } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { ProductLockup } from "../component/product-lockup"
import { useI18n } from "../context/i18n"
import { useLanguage } from "../context/language"
import { route, type Locale } from "../lib/language"

export type HeaderLink = { href: string; label: string }

export const githubLink = {
  href: "https://github.com/anomalyco/opencode",
  apiHref: "https://api.github.com/repos/anomalyco/opencode",
  fallbackStars: "220K",
}
export const themePreferences = ["dark", "light", "system"] as const
export const themeStorageKey = "opencode:stats-theme"
export type ThemePreference = (typeof themePreferences)[number]

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 0,
  roundingIncrement: 5,
})

export const getGitHubStars = query(async () => {
  "use server"
  return fetch(githubLink.apiHref, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "opencode-stats",
    },
  })
    .then((response) => (response.ok ? response.json() : undefined))
    .then((body: unknown) =>
      body && typeof body === "object" && "stargazers_count" in body && typeof body.stargazers_count === "number"
        ? compactNumberFormatter.format(body.stargazers_count)
        : githubLink.fallbackStars,
    )
    .catch(() => githubLink.fallbackStars)
}, "getGitHubStars")

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system"
}

export function applyThemePreference(preference: ThemePreference) {
  if (typeof document === "undefined") return
  document.documentElement.dataset.statsTheme = preference
  if (preference === "system") {
    document.documentElement.style.removeProperty("color-scheme")
    return
  }
  document.documentElement.style.setProperty("color-scheme", preference)
}

export function Header(props: { githubStars: string; links?: readonly HeaderLink[]; brandHref?: string }) {
  const i18n = useI18n()
  const language = useLanguage()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [menuViewport, setMenuViewport] = createSignal(false)
  const links = createMemo(
    () =>
      props.links ?? [
        { href: "#top-models", label: i18n.t("nav.topModels") },
        { href: "#leaderboard", label: i18n.t("nav.leaderboard") },
        { href: "#session-cost", label: i18n.t("nav.sessionCost") },
        { href: "#token-cost", label: i18n.t("nav.tokenCost") },
        { href: "#cache-ratio", label: i18n.t("nav.cacheRatio") },
        { href: "#market-share", label: i18n.t("nav.marketShare") },
        { href: "#geo-breakdown", label: i18n.t("nav.geoBreakdown") },
      ],
  )
  const localHref = (href: string) => (href.startsWith("/") ? language.route(href) : href)

  createEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia("(max-width: 89.999rem)")
    const update = () => setMenuViewport(media.matches)
    update()
    media.addEventListener("change", update)
    onCleanup(() => media.removeEventListener("change", update))
  })

  createEffect(() => {
    if (!menuOpen()) return
    if (!menuViewport()) return
    if (typeof document === "undefined") return
    const page = document.querySelector<HTMLElement>('[data-page="stats"]')
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    const htmlOverflow = document.documentElement.style.overflow
    const pagePaddingRight = page?.style.paddingRight
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    if (scrollbarWidth > 0 && page) page.style.paddingRight = `${scrollbarWidth}px`
    document.body.style.overflow = "hidden"
    onCleanup(() => {
      document.documentElement.style.overflow = htmlOverflow
      if (page && pagePaddingRight !== undefined) page.style.paddingRight = pagePaddingRight
      document.body.style.overflow = bodyOverflow
    })
  })

  return (
    <header data-component="top" data-menu-open={menuOpen() ? "true" : undefined}>
      <div data-slot="header-bar">
        <ProductLockup
          href={localHref(props.brandHref ?? import.meta.env.BASE_URL)}
          nameLabel={i18n.t("header.brandLabel")}
          homeLabel={i18n.t("footer.homeAria")}
          link={(path) => (path === "/data" ? localHref(import.meta.env.BASE_URL) : path)}
        />
        <nav data-component="section-nav" aria-label={i18n.t("header.sectionNavLabel")}>
          <ul>
            <For each={links()}>
              {(link) => (
                <li>
                  <a href={localHref(link.href)}>{link.label}</a>
                </li>
              )}
            </For>
          </ul>
        </nav>
        <div data-slot="header-actions">
          <a
            data-slot="github-mark"
            href={githubLink.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`${i18n.t("header.githubAria")} (${props.githubStars} stars)`}
            title={i18n.t("header.github")}
          >
            <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
          </a>
          <a data-slot="header-button" data-variant="contrast" href="https://opencode.ai/">
            <strong>{i18n.t("header.tryOpenCode")}</strong>
          </a>
          <button
            data-slot="menu-button"
            type="button"
            aria-controls="stats-mobile-nav"
            aria-expanded={menuOpen() ? "true" : "false"}
            aria-label={menuOpen() ? i18n.t("header.closeNav") : i18n.t("header.openNav")}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <Show when={menuOpen()} fallback={<path d="M2 4.72H14M2 8.5H14M2 12.28H14" stroke="currentColor" />}>
                <path d="M4.44 4.44L11.56 11.56M11.56 4.44L4.44 11.56" stroke="currentColor" />
              </Show>
            </svg>
          </button>
        </div>
      </div>
      <nav
        id="stats-mobile-nav"
        data-slot="mobile-menu"
        aria-label={i18n.t("header.sectionNavLabel")}
        hidden={!menuOpen()}
      >
        <For each={links()}>
          {(link) => (
            <a data-slot="mobile-menu-item" href={localHref(link.href)} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          )}
        </For>
      </nav>
    </header>
  )
}

function OpenCodeMark() {
  return (
    <svg data-slot="opencode-mark" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M40 40H0V0H40V40Z" fill="var(--stats-logo-bg)" />
      <path d="M26 29H14V17H26V29Z" fill="var(--stats-logo-fill)" />
      <path d="M26 11H14V29H26V11ZM32 35H8V5H32V35Z" fill="var(--stats-logo-stroke)" />
    </svg>
  )
}

export function Footer(props: {
  themePreference: ThemePreference
  onThemePreferenceChange: (preference: ThemePreference) => void
  links?: readonly HeaderLink[]
  bridge?: HeaderLink | null
}) {
  const i18n = useI18n()
  const language = useLanguage()
  const localHref = (href: string) => (href.startsWith("/") ? language.route(href) : href)
  const modelStats = props.links ?? [
    { href: "#top-models", label: i18n.t("nav.topModels") },
    { href: "#leaderboard", label: i18n.t("nav.leaderboard") },
    { href: "#session-cost", label: i18n.t("nav.sessionCost") },
    { href: "#token-cost", label: i18n.t("nav.tokenCost") },
    { href: "#cache-ratio", label: i18n.t("nav.cacheRatio") },
    { href: "#market-share", label: i18n.t("nav.marketShare") },
    { href: "#geo-breakdown", label: i18n.t("nav.geoBreakdown") },
    { href: "#methodology", label: i18n.t("methodology.title") },
  ]
  const legal = [
    { href: "https://opencode.ai/legal/terms-of-service", label: i18n.t("footer.terms") },
    { href: "https://opencode.ai/legal/privacy-policy", label: i18n.t("footer.privacy") },
  ]
  const connect = [
    { href: "mailto:hello@opencode.ai", label: i18n.t("footer.contact") },
    { href: "https://opencode.ai/discord", label: i18n.t("footer.community") },
    { href: "https://x.com/opencode", label: "X" },
    { href: githubLink.href, label: i18n.t("header.github") },
    { href: "https://www.youtube.com/@anomalyco", label: i18n.t("footer.youtube") },
  ]
  const bridge = () =>
    props.bridge === undefined
      ? { href: "#geo-breakdown", label: i18n.t("nav.geoBreakdown").toUpperCase() }
      : props.bridge

  return (
    <footer data-component="footer">
      <Show when={bridge()}>{(link) => <SectionBridge label={link().label} href={link().href} />}</Show>
      <div data-slot="footer-grid">
        <a data-slot="footer-mark" href="https://opencode.ai" aria-label={i18n.t("footer.homeAria")}>
          <OpenCodeMark />
        </a>
        <FooterColumn title={i18n.t("footer.modelData")} links={modelStats} localHref={localHref} />
        <FooterColumn title={i18n.t("footer.legal")} links={legal} localHref={localHref} />
        <FooterColumn title={i18n.t("footer.connect")} links={connect} localHref={localHref} />
      </div>
      <div data-slot="footer-pattern" aria-hidden="true" />
      <div data-slot="footer-bottom">
        <div>
          <span>{i18n.t("footer.copyright")}</span>
          <SystemStatusLink />
        </div>
        <div data-slot="footer-controls">
          <FooterLanguageSwitcher />
          <div data-slot="theme-toggle" role="group" aria-label={i18n.t("theme.groupLabel")}>
            <For each={themePreferences}>
              {(preference) => (
                <button
                  data-slot="theme-option"
                  type="button"
                  aria-label={i18n.t(themePreferenceLabelKey(preference))}
                  aria-pressed={props.themePreference === preference ? "true" : "false"}
                  title={i18n.t(themePreferenceLabelKey(preference))}
                  onClick={() => props.onThemePreferenceChange(preference)}
                >
                  <ThemePreferenceIcon preference={preference} />
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </footer>
  )
}

function FooterLanguageSwitcher() {
  const i18n = useI18n()
  const language = useLanguage()

  return (
    <label data-slot="footer-language">
      <span>{i18n.t("footer.language")}</span>
      <select
        aria-label={i18n.t("footer.language")}
        onChange={(event) => {
          const locale = event.currentTarget.value as Locale
          const url = new URL(window.location.href)
          const current = `${url.pathname}${url.search}${url.hash}`
          const href = `${route(locale, url.pathname)}${url.search}${url.hash}`
          language.setLocale(locale)
          if (href !== current) window.location.assign(href)
        }}
      >
        {/* Mark the option, not the select: SSR ignores a select value and hydration does not apply it. */}
        <For each={language.locales}>
          {(locale) => (
            <option value={locale} selected={locale === language.locale()}>
              {language.label(locale)}
            </option>
          )}
        </For>
      </select>
    </label>
  )
}

const systemStatuses = ["operational", "degraded", "outage", "unknown"] as const
type SystemStatus = (typeof systemStatuses)[number]

function SystemStatusLink() {
  const i18n = useI18n()
  const [status, setStatus] = createSignal<SystemStatus>("unknown")

  onMount(() => {
    fetch("/status/api/summary", { signal: AbortSignal.timeout(10_000) })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((body: unknown) => setStatus(readSystemStatus(body)))
      .catch(() => setStatus("unknown"))
  })

  // The status page lives outside this app and is not localized, so bypass the locale route and client router.
  return (
    <a data-slot="status" data-status={status()} href="/status" rel="external">
      {i18n.t(`footer.status.${status()}`)}
    </a>
  )
}

function readSystemStatus(body: unknown) {
  if (!body || typeof body !== "object" || !("status" in body)) return "unknown"
  return systemStatuses.find((status) => status === body.status) ?? "unknown"
}

function SectionBridge(props: { label: string; href: string }) {
  const i18n = useI18n()
  return (
    <a data-component="section-bridge" href={props.href}>
      <span>{i18n.t("bridge.learnMore")}</span>
      <i />
      <strong>{props.label}</strong>
      <b>▸</b>
    </a>
  )
}

function ThemePreferenceIcon(props: { preference: ThemePreference }) {
  return (
    <svg data-slot="theme-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <Show
        when={props.preference === "dark"}
        fallback={
          <Show
            when={props.preference === "light"}
            fallback={
              <>
                <rect x="1.5552" y="2.4448" width="12.8896" height="8.8888" fill="currentColor" opacity="0.3" />
                <svg
                  x="1.0552"
                  y="1.9446"
                  width="13.8889"
                  height="12.5325"
                  viewBox="0 0 13.8889 12.5325"
                  preserveAspectRatio="none"
                  overflow="visible"
                >
                  <path
                    d="M4.05559 12.0555C4.72936 11.8431 5.72492 11.6111 6.94448 11.6111M6.94448 11.6111C7.65114 11.6111 8.66981 11.6893 9.83336 12.0555M6.94448 11.6111L6.94448 9.38888M13.3889 0.5H0.500102C0.500102 0.5 0.500017 1.29594 0.500017 2.27778V7.61112C0.500017 8.59298 0.500007 9.38889 0.500007 9.38889H13.3889C13.3889 9.38889 13.3889 8.59298 13.3889 7.61112V2.27778C13.3889 1.29594 13.3889 0.5 13.3889 0.5Z"
                    stroke="currentColor"
                  />
                </svg>
              </>
            }
          >
            <svg
              x="0.6102"
              y="0.6102"
              width="14.7778"
              height="14.7778"
              viewBox="0 0 14.7778 14.7778"
              preserveAspectRatio="none"
              overflow="visible"
            >
              <path
                d="M7.38889 0.5V1.38889M12.26 2.51782L11.6315 3.14627M14.2778 7.38892H13.3889M12.26 12.26L11.6315 11.6316M7.38889 14.2778V13.3889M2.51778 12.26L3.14622 11.6316M0.5 7.38892H1.38889M2.51778 2.51782L3.14622 3.14627M7.38888 11.1666C9.47528 11.1666 11.1667 9.47526 11.1667 7.38886C11.1667 5.30245 9.47528 3.61108 7.38888 3.61108C5.30247 3.61108 3.6111 5.30245 3.6111 7.38886C3.6111 9.47526 5.30247 11.1666 7.38888 11.1666Z"
                stroke="currentColor"
                stroke-linecap="square"
              />
            </svg>
          </Show>
        }
      >
        <svg
          x="2.0549"
          y="1.742"
          width="12.3867"
          height="12.3971"
          viewBox="0 0 12.3867 12.3971"
          preserveAspectRatio="none"
          overflow="visible"
        >
          <path
            d="M9.05556 8.39711C6.37067 8.39711 4.19444 6.22089 4.19444 3.536C4.19444 2.48445 4.53122 1.51456 5.09822 0.71889C2.48178 1.20733 0.5 3.49944 0.5 6.25822C0.5 9.37244 3.02467 11.8971 6.13889 11.8971C8.76156 11.8971 10.9596 10.1036 11.5903 7.67844C10.8514 8.13189 9.98578 8.39711 9.05556 8.39711Z"
            stroke="currentColor"
            stroke-linecap="round"
          />
        </svg>
      </Show>
    </svg>
  )
}

function FooterColumn(props: {
  title: string
  links: readonly { href: string; label: string }[]
  localHref: (href: string) => string
}) {
  return (
    <div data-slot="footer-column">
      <h2>{props.title}</h2>
      <nav aria-label={props.title}>
        <For each={props.links}>
          {(link) => (
            <a
              href={props.localHref(link.href)}
              target={link.href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
            >
              {link.label}
            </a>
          )}
        </For>
      </nav>
    </div>
  )
}

function themePreferenceLabelKey(preference: ThemePreference) {
  if (preference === "dark") return "theme.dark"
  if (preference === "light") return "theme.light"
  return "theme.system"
}
