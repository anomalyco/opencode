import "./chrome.css"
import { Link, Meta } from "@solidjs/meta"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from "solid-js"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { useViewportCover } from "~/lib/viewport"
import { LiveMeta } from "~/component/head-meta"
import { siteLinks } from "../links"
import { navCustomItems, navSavedLabel, navSequence } from "../nav-order"
import { GitHubLink } from "../github-link"
import { ExternalArrow, NewTab } from "../icons"
import { LogoIcon } from "../marks"
import { MenuSheet, MenuToggle } from "../phone-menu"
import { monoFontLatin } from "../mono-fonts"
import { SiteSearch } from "../search"
import { loadSiteSettings, siteSettings } from "../settings"
import { Tooltips } from "../tooltip"
import { SoundToggle } from "./sound-toggle"
import { arcadeTone, backdropColor } from "./tone"

// The site's Settings panel and its styles load the first time Settings opens. Settings is a
// development tool, so production builds leave it out, with its button and shortcut.
const SettingsPanel = import.meta.env.DEV ? lazy(() => import("./settings")) : undefined
// Whether Settings is open. Module-wide, so it stays open when Settings › Mode swaps the version
// (and with it this overlay).
const [settings, setSettings] = createSignal(false)
let settingsLoaded = false
// Whether the small-screen menu sheet is open: the scene (arcade.tsx) ignores input and goes quiet under it.
const [arcadeMenu, setArcadeMenu] = createSignal(false)
export { arcadeMenu }

/**
 * The page around an arcade 404 scene, shared by every version of it: the site's own logo mark and
 * numbered nav in the place they sit on every other page (the sidebar on wide screens, the top
 * bar's logo on small ones), light on the dark scene; a visually hidden h1; the ⌘K search; the
 * tooltips; and the sound switch at the bottom left.
 */
export function ArcadeChrome(props: { settingsRows?: () => JSX.Element }) {
  const i18n = useI18n()
  const language = useLanguage()
  const links = createMemo(() => siteLinks(i18n.t, language.route))
  useViewportCover()
  // The same items and order as the site's sidebar (site.tsx) with the current settings.
  const nav = createMemo(() => {
    const entry = (id: string) => siteSettings.navConfig.find((item) => item.id === id)
    return navSequence(
      [
        ...links().nav.map((item) => ({
          id: item.id,
          href: siteSettings.productNavDemo === "on" && item.demo ? item.demo : item.href,
          label: navSavedLabel(entry(item.id), language.locale()) ?? item.label,
          external: "external" in item && !!item.external,
          arrow: "arrow" in item && !!item.arrow,
          company: "company" in item,
        })),
        ...navCustomItems(siteSettings.navConfig),
      ],
      siteSettings.navConfig,
      siteSettings.navGroups === "grouped",
    ).filter((item) => entry(item.id)?.visible && !entry(item.id)?.removed)
  })

  let settingsButton: HTMLButtonElement | undefined
  let menuButton: HTMLButtonElement | undefined

  // The tone script set the grade on <html> before first paint; keep it in step with Settings.
  createEffect(() => {
    for (const [name, value] of Object.entries(arcadeTone())) document.documentElement.style.setProperty(name, value)
  })

  onMount(() => {
    onCleanup(() => {
      for (const name of Object.keys(arcadeTone())) document.documentElement.style.removeProperty(name)
    })
    // No Site component here, so load the saved development settings ourselves, once: loading
    // passes through the defaults, which would undo a Mode change that remounts this overlay.
    if (!settingsLoaded) loadSiteSettings()
    settingsLoaded = true
    // ⇧S opens Settings (development only) and 0 goes home, as on the other pages.
    const shortcut = (event: KeyboardEvent) => {
      if (!["S", "0"].includes(event.key) || event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
      if ((event.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return
      if (event.key === "S" && !SettingsPanel) return
      event.preventDefault()
      if (event.key === "0") return window.location.assign(language.route("/"))
      setSettings(!settings())
    }
    document.addEventListener("keydown", shortcut)
    onCleanup(() => document.removeEventListener("keydown", shortcut))
    // The menu closes on Escape (focus back on its button) and once the sidebar is back, as on the site.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !arcadeMenu()) return
      event.preventDefault()
      setArcadeMenu(false)
      menuButton?.focus()
    }
    const wide = matchMedia("(min-width: 60.0625rem)")
    const closeMenu = () => setArcadeMenu(false)
    document.addEventListener("keydown", escape)
    wide.addEventListener("change", closeMenu)
    onCleanup(() => {
      document.removeEventListener("keydown", escape)
      wide.removeEventListener("change", closeMenu)
      setArcadeMenu(false)
    })
  })

  const close = () => {
    setSettings(false)
    settingsButton?.focus()
  }

  return (
    <div
      data-component="arcade-chrome"
      data-blend={siteSettings.arcadeNavBlend}
      style={{ "--arcade-shade": siteSettings.arcadeShade / 100 }}
    >
      {/* Server-rendered, so it applies before any image or script loads; it goes when the page
          unmounts. :root outranks site.css's own page background once the Settings panel loads it. */}
      <style>{`html:root, html:root body { background: var(--tone-backdrop, #1b1d1f); color-scheme: dark; }`}</style>
      {/* The 404 page renders without the site shell, so it preloads the mono face itself (site.tsx). */}
      <Link rel="preload" href={monoFontLatin} as="font" type="font/woff2" crossorigin="anonymous" />
      <LiveMeta name="theme-color" content={backdropColor(siteSettings.arcadeSaturation)} />
      <Meta name="color-scheme" content="dark" />
      <h1 data-slot="title">{i18n.t("site.notFound.title")}</h1>
      <div data-slot="shade" aria-hidden="true" />
      <header data-slot="sidebar">
        <a href={language.route("/")} data-slot="logo" aria-label={i18n.t("nav.logoAlt")} data-tip={i18n.t("nav.home")}>
          <LogoIcon />
        </a>
        <nav aria-label={i18n.t("site.landmark.primary")}>
          <ul>
            <For each={nav()}>
              {(item, index) => (
                <li>
                  <a href={item.href} target={"external" in item && item.external ? "_blank" : undefined}>
                    <span data-slot="index" aria-hidden="true">
                      [{index() + 1}]
                    </span>
                    <span data-slot="label">{item.label}</span>
                  </a>
                </li>
              )}
            </For>
          </ul>
        </nav>
      </header>
      {/* Small screens: the site's top-bar GitHub mark and menu (phone-menu.tsx), on the logo's row. */}
      <div data-site data-theme="dark" data-slot="phone-bar">
        <GitHubLink owner="topbar" />
        <MenuToggle
          ref={(element) => (menuButton = element)}
          open={arcadeMenu()}
          onToggle={() => setArcadeMenu(!arcadeMenu())}
        />
        <MenuSheet open={arcadeMenu()} onClose={() => setArcadeMenu(false)}>
          <For each={nav()}>
            {(item, index) => (
              <li>
                <a href={item.href} target={item.external ? "_blank" : undefined}>
                  <span data-slot="index" aria-hidden="true">
                    [{index() + 1}]
                  </span>
                  <span data-slot="label">{item.label}</span>
                  <Show when={item.arrow}>
                    <ExternalArrow />
                  </Show>
                  <Show when={item.external}>
                    <NewTab />
                  </Show>
                </a>
              </li>
            )}
          </For>
        </MenuSheet>
      </div>
      {/* Under the open menu the scene's own controls leave the tab order (arcade.tsx does the stage). */}
      <div inert={arcadeMenu()}>
        <SoundToggle />
      </div>
      {/* The site's tools need the [data-site] scope; the logo and nav above stay outside it so the
          site's stylesheet (loaded with the Settings panel) never restyles them. */}
      <div data-site data-theme="dark" data-slot="site-tools">
        <SiteSearch
          onToggleTheme={() => {}}
          onSettings={SettingsPanel && (() => setSettings(true))}
          go={(href) => window.location.assign(href)}
        />
        <Tooltips />
        {SettingsPanel && (
          <>
            <button
              ref={settingsButton}
              type="button"
              data-slot="settings-button"
              data-tip={`${i18n.t("site.settings")} ⇧S`}
              aria-label={i18n.t("site.settings")}
              aria-expanded={settings() ? "true" : "false"}
              onClick={() => setSettings(!settings())}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.25"
                stroke-linejoin="miter"
                aria-hidden="true"
              >
                <path d="M6.9 1.5H9.1L9.45 3.35L10.6 3.83L12.15 2.76L13.24 3.85L12.17 5.4L12.65 6.55L14.5 6.9V9.1L12.65 9.45L12.17 10.6L13.24 12.15L12.15 13.24L10.6 12.17L9.45 12.65L9.1 14.5H6.9L6.55 12.65L5.4 12.17L3.85 13.24L2.76 12.15L3.83 10.6L3.35 9.45L1.5 9.1V6.9L3.35 6.55L3.83 5.4L2.76 3.85L3.85 2.76L5.4 3.83L6.55 3.35Z" />
                <circle cx="8" cy="8" r="2" />
              </svg>
            </button>
            <Show when={settings()}>
              <Suspense>
                <SettingsPanel onClose={close} rows={props.settingsRows} />
              </Suspense>
            </Show>
          </>
        )}
      </div>
    </div>
  )
}
