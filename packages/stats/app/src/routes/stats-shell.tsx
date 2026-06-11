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
        <a data-slot="brand" href={props.brandHref ?? import.meta.env.BASE_URL} aria-label="Data home">
          <DataWordmark />
        </a>
        <nav data-component="section-nav" aria-label="Data sections">
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
      <nav id="stats-mobile-nav" data-slot="mobile-menu" aria-label="Data sections" hidden={!menuOpen()}>
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

function DataWordmark() {
  return (
    <svg data-slot="stats-wordmark" width="66" height="20" viewBox="0 0 66 20" fill="none" aria-hidden="true">
      <path opacity="0.2" d="M12 16H4V8H12V16Z" fill="currentColor" />
      <path d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="currentColor" />
      <path
        d="M63.3543 16L62.5119 12.8711H58.6437L57.8013 16H55.7383L59.2454 4H61.9618L65.4689 16H63.3543ZM61.0678 7.851L60.6896 5.94269H60.4489L60.0707 7.851L59.1595 11.1347H61.9962L61.0678 7.851Z"
        fill="currentColor"
      />
      <path d="M52.5951 5.87392V16H50.4461V5.87392H47.4375V4H55.6209V5.87392H52.5951Z" fill="currentColor" />
      <path
        d="M45.2059 16L44.3635 12.8711H40.4953L39.6529 16H37.5898L41.097 4H43.8133L47.3205 16H45.2059ZM42.9194 7.851L42.5411 5.94269H42.3004L41.9222 7.851L41.011 11.1347H43.8477L42.9194 7.851Z"
        fill="currentColor"
      />
      <path
        d="M28 4H32.0917C32.8138 4 33.4556 4.11461 34.0172 4.34384C34.5903 4.5616 35.0716 4.9169 35.4613 5.40974C35.8625 5.89112 36.1662 6.51003 36.3725 7.26648C36.5788 8.02292 36.6819 8.9341 36.6819 10C36.6819 11.0659 36.5788 11.9771 36.3725 12.7335C36.1662 13.49 35.8625 14.1146 35.4613 14.6075C35.0716 15.0888 34.5903 15.4441 34.0172 15.6734C33.4556 15.8911 32.8138 16 32.0917 16H28V4ZM32.0917 14.1261C32.8252 14.1261 33.3926 13.9026 33.7937 13.4556C34.1948 12.9971 34.3954 12.3152 34.3954 11.4097V8.59026C34.3954 7.68481 34.1948 7.0086 33.7937 6.5616C33.3926 6.10315 32.8252 5.87392 32.0917 5.87392H30.149V14.1261H32.0917Z"
        fill="currentColor"
      />
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
        <FooterColumn title="Model Data" links={modelStats} />
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
