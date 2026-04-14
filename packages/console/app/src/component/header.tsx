import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
import copyLogoLight from "../asset/lander/logo-light.svg"
import copyLogoDark from "../asset/lander/logo-dark.svg"
import copyWordmarkLight from "../asset/lander/wordmark-light.svg"
import copyWordmarkDark from "../asset/lander/wordmark-dark.svg"
import copyBrandAssetsLight from "../asset/lander/brand-assets-light.svg"
import copyBrandAssetsDark from "../asset/lander/brand-assets-dark.svg"

// SVG files for copying (separate from button icons)
// Replace these with your actual SVG files for copying
import copyLogoSvgLight from "../asset/lander/opencode-logo-light.svg"
import copyLogoSvgDark from "../asset/lander/opencode-logo-dark.svg"
import copyWordmarkSvgLight from "../asset/lander/opencode-wordmark-light.svg"
import copyWordmarkSvgDark from "../asset/lander/opencode-wordmark-dark.svg"
import { A, createAsync, useNavigate } from "@solidjs/router"
import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { github } from "~/lib/github"
import { createEffect, onCleanup } from "solid-js"
import { config } from "~/config"
import "./header-context-menu.css"

const isDarkMode = () => window.matchMedia("(prefers-color-scheme: dark)").matches

const fetchSvgContent = async (svgPath: string): Promise<string> => {
  try {
    const response = await fetch(svgPath)
    const svgText = await response.text()
    return svgText
  } catch (err) {
    console.error("Failed to fetch SVG content:", err)
    throw err
  }
}

export function Header(props: { zen?: boolean; hideGetStarted?: boolean }) {
  const navigate = useNavigate()
  const githubData = createAsync(() => github())
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()?.stars!)
      : config.github.starsFormatted.compact,
  )

  const [store, setStore] = createStore({
    mobileMenuOpen: false,
    contextMenuOpen: false,
    contextMenuPosition: { x: 0, y: 0 },
  })

  createEffect(() => {
    const handleClickOutside = () => {
      setStore("contextMenuOpen", false)
    }

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault()
      setStore("contextMenuOpen", false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStore("contextMenuOpen", false)
      }
    }

    if (store.contextMenuOpen) {
      document.addEventListener("click", handleClickOutside)
      document.addEventListener("contextmenu", handleContextMenu)
      document.addEventListener("keydown", handleKeyDown)
      onCleanup(() => {
        document.removeEventListener("click", handleClickOutside)
        document.removeEventListener("contextmenu", handleContextMenu)
        document.removeEventListener("keydown", handleKeyDown)
      })
    }
  })

  const handleLogoContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const logoElement = (event.currentTarget as HTMLElement).querySelector("a")
    if (logoElement) {
      const rect = logoElement.getBoundingClientRect()
      setStore("contextMenuPosition", {
        x: rect.left - 16,
        y: rect.bottom + 8,
      })
    }
    setStore("contextMenuOpen", true)
  }

  const copyWordmarkToClipboard = async () => {
    try {
      const isDark = isDarkMode()
      const wordmarkSvgPath = isDark ? copyWordmarkSvgDark : copyWordmarkSvgLight
      const wordmarkSvg = await fetchSvgContent(wordmarkSvgPath)
      await navigator.clipboard.writeText(wordmarkSvg)
    } catch (err) {
      console.error("Failed to copy wordmark to clipboard:", err)
    }
  }

  const copyLogoToClipboard = async () => {
    try {
      const isDark = isDarkMode()
      const logoSvgPath = isDark ? copyLogoSvgDark : copyLogoSvgLight
      const logoSvg = await fetchSvgContent(logoSvgPath)
      await navigator.clipboard.writeText(logoSvg)
    } catch (err) {
      console.error("Failed to copy logo to clipboard:", err)
    }
  }

  return (
    <section data-component="top">
      <div onContextMenu={handleLogoContextMenu}>
        <A href="/">
          <img data-slot="logo light" src={logoLight} alt="opencode logo light" width="189" height="34" />
          <img data-slot="logo dark" src={logoDark} alt="opencode logo dark" width="189" height="34" />
        </A>
      </div>

      <Show when={store.contextMenuOpen}>
        <div
          class="context-menu"
          style={`left: ${store.contextMenuPosition.x}px; top: ${store.contextMenuPosition.y}px;`}
        >
          <button class="context-menu-item" onClick={copyLogoToClipboard}>
            <img data-slot="copy light" src={copyLogoLight} alt="Logo" />
            <img data-slot="copy dark" src={copyLogoDark} alt="Logo" />
            Copy logo as SVG
          </button>
          <button class="context-menu-item" onClick={copyWordmarkToClipboard}>
            <img data-slot="copy light" src={copyWordmarkLight} alt="Wordmark" />
            <img data-slot="copy dark" src={copyWordmarkDark} alt="Wordmark" />
            Copy wordmark as SVG
          </button>
          <button class="context-menu-item" onClick={() => navigate("/brand")}>
            <img data-slot="copy light" src={copyBrandAssetsLight} alt="Brand Assets" />
            <img data-slot="copy dark" src={copyBrandAssetsDark} alt="Brand Assets" />
            Brand assets
          </button>
        </div>
      </Show>
      <nav data-component="nav-desktop">
        <ul>
          <li>
            <a href={config.github.repoUrl} target="_blank">
              GitHub <span>[{starCount()}]</span>
            </a>
          </li>
          <li>
            <a href="/docs">Docs</a>
          </li>
          <li>
            <A href="/enterprise">Enterprise</A>
          </li>
          <li>
            <Switch>
              <Match when={props.zen}>
                <a href="/auth">Login</a>
              </Match>
              <Match when={!props.zen}>
                <A href="/zen">Zen</A>
              </Match>
            </Switch>
          </li>
          <Show when={!props.hideGetStarted}>
            {" "}
            <li>
              {" "}
              <A href="/download" data-slot="cta-button">
                {" "}
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  {" "}
                  <path
                    d="M12.1875 9.75L9.00001 12.9375L5.8125 9.75M9.00001 2.0625L9 12.375M14.4375 15.9375H3.5625"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="square"
                  />{" "}
                </svg>{" "}
                Free{" "}
              </A>{" "}
            </li>
          </Show>
        </ul>
      </nav>
      <nav data-component="nav-mobile">
        <button
          type="button"
          data-component="nav-mobile-toggle"
          aria-expanded="false"
          aria-controls="nav-mobile-menu"
          class="nav-toggle"
          onClick={() => setStore("mobileMenuOpen", !store.mobileMenuOpen)}
        >
          <span class="sr-only">Open menu</span>
          <Switch>
            <Match when={store.mobileMenuOpen}>
              <svg
                class="icon icon-close"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12.7071 11.9993L18.0104 17.3026L17.3033 18.0097L12 12.7064L6.6967 18.0097L5.98959 17.3026L11.2929 11.9993L5.98959 6.69595L6.6967 5.98885L12 11.2921L17.3033 5.98885L18.0104 6.69595L12.7071 11.9993Z"
                  fill="currentColor"
                />
              </svg>
            </Match>
            <Match when={!store.mobileMenuOpen}>
              <svg
                class="icon icon-hamburger"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M19 17H5V16H19V17Z" fill="currentColor" />
                <path d="M19 8H5V7H19V8Z" fill="currentColor" />
              </svg>
            </Match>
          </Switch>
        </button>

        <Show when={store.mobileMenuOpen}>
          <div id="nav-mobile-menu" data-component="nav-mobile">
            <nav data-component="nav-mobile-menu-list">
              <ul>
                <li>
                  <A href="/">Home</A>
                </li>
                <li>
                  <a href={config.github.repoUrl} target="_blank">
                    GitHub <span>[{starCount()}]</span>
                  </a>
                </li>
                <li>
                  <a href="/docs">Docs</a>
                </li>
                <li>
                  <A href="/enterprise">Enterprise</A>
                </li>
                <li>
                  <Switch>
                    <Match when={props.zen}>
                      <a href="/auth">Login</a>
                    </Match>
                    <Match when={!props.zen}>
                      <A href="/zen">Zen</A>
                    </Match>
                  </Switch>
                </li>
                <Show when={!props.hideGetStarted}>
                  <li>
                    <A href="/download" data-slot="cta-button">
                      Get started for free
                    </A>
                  </li>
                </Show>
              </ul>
            </nav>
          </div>
        </Show>
      </nav>
    </section>
  )
}
