import opencodeWordmarkDark from "../asset/logo-ornate-dark.svg"
import { query } from "@solidjs/router"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"

export type HeaderLink = { href: string; label: string }

export const headerLinks = [
  { href: "#top-models", label: "Top Models" },
  { href: "#leaderboard", label: "Leaderboard" },
  { href: "#session-cost", label: "Session Cost" },
  { href: "#token-cost", label: "Token Cost" },
  { href: "#cache-ratio", label: "Cache Ratio" },
  { href: "#market-share", label: "Market Share" },
  { href: "#geo-breakdown", label: "Geo Breakdown" },
] as const
export const githubLink = {
  href: "https://github.com/anomalyco/opencode",
  apiHref: "https://api.github.com/repos/anomalyco/opencode",
  label: "GitHub",
  fallbackStars: "150K",
  ariaLabel: "Star OpenCode on GitHub",
}
export const themePreferences = ["dark", "light", "system"] as const
export const themeStorageKey = "opencode:stats-theme"
export type ThemePreference = (typeof themePreferences)[number]

const compactNumberFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const themePreferenceLabels = {
  dark: "Dark",
  light: "Light",
  system: "System",
} as const

export const getGitHubStars = query(async () => {
  "use server"
  return fetch(githubLink.apiHref, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
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
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [menuViewport, setMenuViewport] = createSignal(false)
  const links = createMemo(() => props.links ?? headerLinks)

  createEffect(() => {
    if (typeof window === "undefined") return
    const media = window.matchMedia("(max-width: 74.999rem)")
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
        <a data-slot="brand" href={props.brandHref ?? import.meta.env.BASE_URL} aria-label="Stats home">
          <StatsWordmark />
        </a>
        <nav data-component="section-nav" aria-label="Stats sections">
          <ul>
            <For each={links()}>
              {(link) => (
                <li>
                  <a href={link.href}>{link.label}</a>
                </li>
              )}
            </For>
          </ul>
        </nav>
        <div data-slot="header-actions">
          <a
            data-slot="header-button"
            data-variant="neutral"
            href={githubLink.href}
            target="_blank"
            rel="noreferrer"
            aria-label={`${githubLink.ariaLabel} (${props.githubStars} stars)`}
          >
            <strong>{githubLink.label}</strong>
            <span>[{props.githubStars}]</span>
          </a>
          <a data-slot="header-button" data-variant="contrast" href="https://opencode.ai/">
            <strong>Try OpenCode</strong>
          </a>
          <button
            data-slot="menu-button"
            type="button"
            aria-controls="stats-mobile-nav"
            aria-expanded={menuOpen() ? "true" : "false"}
            aria-label={menuOpen() ? "Close navigation" : "Open navigation"}
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
      <nav id="stats-mobile-nav" data-slot="mobile-menu" aria-label="Stats sections" hidden={!menuOpen()}>
        <a
          data-slot="mobile-menu-item"
          data-variant="github"
          href={githubLink.href}
          target="_blank"
          rel="noreferrer"
          aria-label={`${githubLink.ariaLabel} (${props.githubStars} stars)`}
        >
          <strong>{githubLink.label}</strong>
          <span>[{props.githubStars}]</span>
        </a>
        <For each={links()}>
          {(link) => (
            <a data-slot="mobile-menu-item" href={link.href} onClick={() => setMenuOpen(false)}>
              {link.label}
            </a>
          )}
        </For>
      </nav>
    </header>
  )
}

function StatsWordmark() {
  return (
    <span data-slot="stats-wordmark" aria-hidden="true">
      <StatsMark />
      <svg data-slot="brand-label" width="51" height="14" viewBox="0 0 50.8509 14" fill="none">
        <path
          d="M46.2359 14C45.2276 14 44.3356 13.819 43.56 13.4571C42.7973 13.0822 42.138 12.5328 41.5822 11.8089L43.1722 10.277C43.56 10.807 44.0124 11.2142 44.5295 11.4986C45.0466 11.7701 45.6283 11.9058 46.2747 11.9058C47.7225 11.9058 48.4464 11.2465 48.4464 9.92798C48.4464 9.38504 48.3172 8.97138 48.0586 8.68698C47.8001 8.40259 47.3735 8.19575 46.7788 8.06648L45.596 7.8338C44.3679 7.57525 43.463 7.13573 42.8813 6.51524C42.2996 5.89474 42.0088 5.02862 42.0088 3.9169C42.0088 2.62419 42.3901 1.6482 43.1528 0.98892C43.9284 0.32964 45.0272 0 46.4492 0C47.4187 0 48.2461 0.161588 48.9312 0.484764C49.6293 0.795014 50.2239 1.28624 50.7151 1.95845L49.1251 3.45152C48.789 2.99908 48.4076 2.66297 47.9811 2.44321C47.5545 2.21053 47.0309 2.09418 46.4104 2.09418C45.7253 2.09418 45.2211 2.22992 44.898 2.50139C44.5748 2.77285 44.4132 3.21237 44.4132 3.81995C44.4132 4.3241 44.536 4.71191 44.7816 4.98338C45.0401 5.25485 45.4538 5.45522 46.0226 5.58449L47.2054 5.83656C47.8647 5.97876 48.4206 6.15328 48.873 6.36011C49.3384 6.56694 49.7133 6.82548 49.9977 7.13573C50.295 7.44598 50.5083 7.8144 50.6376 8.241C50.7798 8.65466 50.8509 9.14589 50.8509 9.71468C50.8509 11.1108 50.4501 12.1773 49.6486 12.9141C48.8601 13.638 47.7225 14 46.2359 14Z"
          fill="currentColor"
        />
        <path
          d="M36.9543 2.34643V13.7675H34.5305V2.34643H31.1371V0.232856H40.367V2.34643H36.9543Z"
          fill="currentColor"
        />
        <path
          d="M28.6196 13.7675L27.6695 10.2384H23.3066L22.3565 13.7675H20.0296L23.9853 0.232856H27.049L31.0047 13.7675H28.6196ZM26.0407 4.57635L25.6141 2.42399H25.3426L24.916 4.57635L23.8883 8.27995H27.0878L26.0407 4.57635Z"
          fill="currentColor"
        />
        <path
          d="M16.4849 2.34643V13.7675H14.0611V2.34643H10.6678V0.232856H19.8977V2.34643H16.4849Z"
          fill="currentColor"
        />
        <path
          d="M4.65374 14C3.64543 14 2.75346 13.819 1.97784 13.4571C1.21514 13.0822 0.555863 12.5328 0 11.8089L1.59003 10.277C1.97784 10.807 2.43029 11.2142 2.94737 11.4986C3.46445 11.7701 4.04617 11.9058 4.69252 11.9058C6.14035 11.9058 6.86427 11.2465 6.86427 9.92798C6.86427 9.38504 6.735 8.97138 6.47646 8.68698C6.21791 8.40259 5.79132 8.19575 5.19668 8.06648L4.01385 7.8338C2.78578 7.57525 1.88089 7.13573 1.29917 6.51524C0.717452 5.89474 0.426593 5.02862 0.426593 3.9169C0.426593 2.62419 0.807941 1.6482 1.57064 0.98892C2.34626 0.32964 3.44506 0 4.86704 0C5.83657 0 6.6639 0.161588 7.34903 0.484764C8.04709 0.795014 8.64174 1.28624 9.13297 1.95845L7.54294 3.45152C7.20683 2.99908 6.82549 2.66297 6.39889 2.44321C5.9723 2.21053 5.44875 2.09418 4.82826 2.09418C4.14312 2.09418 3.63897 2.22992 3.31579 2.50139C2.99261 2.77285 2.83103 3.21237 2.83103 3.81995C2.83103 4.3241 2.95383 4.71191 3.19945 4.98338C3.45799 5.25485 3.87165 5.45522 4.44044 5.58449L5.62327 5.83656C6.28255 5.97876 6.83841 6.15328 7.29086 6.36011C7.75623 6.56694 8.13112 6.82548 8.41551 7.13573C8.71284 7.44598 8.92613 7.8144 9.0554 8.241C9.1976 8.65466 9.2687 9.14589 9.2687 9.71468C9.2687 11.1108 8.86796 12.1773 8.06648 12.9141C7.27793 13.638 6.14035 14 4.65374 14Z"
          fill="currentColor"
        />
      </svg>
    </span>
  )
}

function StatsMark() {
  return (
    <svg data-slot="brand-mark" width="19" height="24" viewBox="0 0 19 24" fill="none" aria-hidden="true">
      <path opacity="0.2" d="M14.25 19.2H4.75V9.6H14.25V19.2Z" fill="currentColor" />
      <path d="M14.25 4.8H4.75V19.2H14.25V4.8ZM19 24H0V0H19V24Z" fill="currentColor" />
    </svg>
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
}) {
  const [subscribeOpen, setSubscribeOpen] = createSignal(false)
  const modelStats = props.links ?? [
    { href: "#top-models", label: "Top Models" },
    { href: "#leaderboard", label: "Leaderboard" },
    { href: "#session-cost", label: "Session Cost" },
    { href: "#token-cost", label: "Token Cost" },
    { href: "#cache-ratio", label: "Cache Ratio" },
    { href: "#market-share", label: "Market Share" },
    { href: "#geo-breakdown", label: "Geo Breakdown" },
  ]
  const legal = [
    { href: "https://opencode.ai/legal/terms-of-service", label: "Terms of service" },
    { href: "https://opencode.ai/legal/privacy-policy", label: "Privacy policy" },
  ]
  const connect = [
    { href: "mailto:hello@opencode.ai", label: "Contact us" },
    { href: "https://opencode.ai/discord", label: "Community" },
    { href: "https://x.com/opencode", label: "X" },
    githubLink,
    { href: "https://www.youtube.com/@anomaly-co", label: "YouTube" },
  ]

  return (
    <footer data-component="footer">
      <SectionBridge label="GEO BREAKDOWN" href="#geo-breakdown" />
      <div data-slot="footer-grid">
        <a data-slot="footer-mark" href="https://opencode.ai" aria-label="OpenCode home">
          <OpenCodeMark />
        </a>
        <FooterColumn title="Model Stats" links={modelStats} />
        <FooterColumn title="Legal" links={legal} />
        <FooterColumn title="Connect" links={connect} />
        <div data-slot="footer-column">
          <h2>Newsletter</h2>
          <p>Be the first to know about new releases.</p>
          <button data-slot="subscribe-button" type="button" onClick={() => setSubscribeOpen(true)}>
            Subscribe
          </button>
        </div>
      </div>
      <div data-slot="footer-pattern" aria-hidden="true" />
      <div data-slot="footer-bottom">
        <div>
          <span>© 2026 Anomaly Innovations Inc.</span>
          <span data-slot="status">All systems Operational</span>
        </div>
        <div data-slot="theme-toggle" role="group" aria-label="Theme">
          <For each={themePreferences}>
            {(preference) => (
              <button
                data-slot="theme-option"
                type="button"
                aria-label={themePreferenceLabels[preference]}
                aria-pressed={props.themePreference === preference ? "true" : "false"}
                title={themePreferenceLabels[preference]}
                onClick={() => props.onThemePreferenceChange(preference)}
              >
                <ThemePreferenceIcon preference={preference} />
              </button>
            )}
          </For>
        </div>
      </div>
      <Show when={subscribeOpen()}>
        <SubscribeModal onClose={() => setSubscribeOpen(false)} />
      </Show>
    </footer>
  )
}

function SectionBridge(props: { label: string; href: string }) {
  return (
    <a data-component="section-bridge" href={props.href}>
      <span>LEAN MORE</span>
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

function SubscribeModal(props: { onClose: () => void }) {
  const [status, setStatus] = createSignal<"idle" | "pending" | "success" | "error">("idle")
  const [message, setMessage] = createSignal("")
  let input: HTMLInputElement | undefined

  onMount(() => {
    if (typeof document === "undefined") return
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const htmlOverflow = document.documentElement.style.overflow
    const bodyOverflow = document.body.style.overflow
    document.documentElement.style.overflow = "hidden"
    document.body.style.overflow = "hidden"
    const focusTimeout = window.setTimeout(() => input?.focus(), 0)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      window.clearTimeout(focusTimeout)
      document.documentElement.style.overflow = htmlOverflow
      document.body.style.overflow = bodyOverflow
      document.removeEventListener("keydown", onKeyDown)
      activeElement?.focus()
    })
  })

  return (
    <div data-component="subscribe-modal" role="dialog" aria-modal="true" aria-labelledby="subscribe-title">
      <div data-slot="modal-scrim" aria-hidden="true" onClick={props.onClose} />
      <div data-slot="modal-panel">
        <div data-slot="modal-brand">
          <img data-slot="modal-logo" src={opencodeWordmarkDark} alt="OpenCode" />
          <button data-slot="modal-close" type="button" aria-label="Close newsletter signup" onClick={props.onClose}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4.44 4.44L11.56 11.56M11.56 4.44L4.44 11.56" stroke="currentColor" />
            </svg>
          </button>
        </div>
        <div data-slot="modal-body">
          <div data-slot="modal-intro">
            <h2 id="subscribe-title">OpenCode Newsletter</h2>
            <p>
              Be the first to know
              <br />
              about new releases.
            </p>
          </div>
          <form
            data-slot="subscribe-form"
            method="post"
            onSubmit={(event) => {
              event.preventDefault()
              const form = event.currentTarget
              setStatus("pending")
              setMessage("")
              fetch(`${import.meta.env.BASE_URL}api/newsletter`, {
                method: "POST",
                body: new FormData(form),
              }).then(
                async (response) => {
                  if (response.ok) {
                    form.reset()
                    setStatus("success")
                    return
                  }
                  setMessage(await newsletterErrorMessage(response))
                  setStatus("error")
                },
                () => {
                  setMessage("Failed to subscribe")
                  setStatus("error")
                },
              )
            }}
          >
            <input ref={input} type="email" name="email" placeholder="Email address" required />
            <button type="submit" disabled={status() === "pending"}>
              <span>{status() === "pending" ? "Subscribing..." : "Subscribe"}</span>
            </button>
          </form>
          <div data-slot="subscribe-feedback" aria-live="polite">
            <Show when={status() === "success"}>
              <p data-state="success">You're subscribed.</p>
            </Show>
            <Show when={status() === "error"}>
              <p data-state="error">{message()}</p>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

function newsletterErrorMessage(response: Response) {
  return response.json().then(
    (body: unknown) =>
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : "Failed to subscribe",
    () => "Failed to subscribe",
  )
}

function FooterColumn(props: { title: string; links: readonly { href: string; label: string }[] }) {
  return (
    <div data-slot="footer-column">
      <h2>{props.title}</h2>
      <nav aria-label={props.title}>
        <For each={props.links}>
          {(link) => (
            <a href={link.href} target={link.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
              {link.label}
            </a>
          )}
        </For>
      </nav>
    </div>
  )
}
