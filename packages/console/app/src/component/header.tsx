import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
import copyLogoLight from "../asset/lander/logo-light.svg"
import copyLogoDark from "../asset/lander/logo-dark.svg"
import copyWordmarkLight from "../asset/lander/wordmark-light.svg"
import copyWordmarkDark from "../asset/lander/wordmark-dark.svg"
import copyBrandAssetsLight from "../asset/lander/brand-assets-light.svg"
import copyBrandAssetsDark from "../asset/lander/brand-assets-dark.svg"
import { A, createAsync } from "@solidjs/router"
import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { github } from "~/lib/github"
import { createEffect, onCleanup } from "solid-js"
import "./header-context-menu.css"

export function Header(props: { zen?: boolean }) {
  const githubData = createAsync(() => github())
  const starCount = createMemo(() =>
    githubData()?.stars
      ? new Intl.NumberFormat("en-US", {
          notation: "compact",
          compactDisplay: "short",
        }).format(githubData()?.stars!)
      : "25K",
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

    if (store.contextMenuOpen) {
      document.addEventListener("click", handleClickOutside)
      document.addEventListener("contextmenu", handleContextMenu)
      onCleanup(() => {
        document.removeEventListener("click", handleClickOutside)
        document.removeEventListener("contextmenu", handleContextMenu)
      })
    }
  })

  const handleLogoContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    setStore("contextMenuPosition", { x: event.clientX, y: event.clientY })
    setStore("contextMenuOpen", true)
  }

  const copyWordmarkToClipboard = async () => {
    try {
      const wordmarkSvg = `<svg width="234" height="42" viewBox="0 0 234 42" fill="none" xmlns="http://www.w3.org/2000/svg">
<g clip-path="url(#clip0_1306_86249)">
<path d="M18 30H6V18H18V30Z" fill="#CFCECD"/>
<path d="M18 12H6V30H18V12ZM24 36H0V6H24V36Z" fill="#656363"/>
<path d="M48 30H36V18H48V30Z" fill="#CFCECD"/>
<path d="M36 30H48V12H36V30ZM54 36H36V42H30V6H54V36Z" fill="#656363"/>
<path d="M84 24V30H66V24H84Z" fill="#CFCECD"/>
<path d="M84 24H66V30H84V36H60V6H84V24ZM66 18H78V12H66V18Z" fill="#656363"/>
<path d="M108 36H96V18H108V36Z" fill="#CFCECD"/>
<path d="M108 12H96V36H90V6H108V12ZM114 36H108V12H114V36Z" fill="#656363"/>
<path d="M144 30H126V18H144V30Z" fill="#CFCECD"/>
<path d="M144 12H126V30H144V36H120V6H144V12Z" fill="#211E1E"/>
<path d="M168 30H156V18H168V30Z" fill="#CFCECD"/>
<path d="M168 12H156V30H168V12ZM174 36H150V6H174V36Z" fill="#211E1E"/>
<path d="M198 30H186V18H198V30Z" fill="#CFCECD"/>
<path d="M198 12H186V30H198V12ZM204 36H180V6H198V0H204V36Z" fill="#211E1E"/>
<path d="M234 24V30H216V24H234Z" fill="#CFCECD"/>
<path d="M216 12V18H228V12H216ZM234 24H216V30H234V36H210V6H234V24Z" fill="#211E1E"/>
</g>
<defs>
<clipPath id="clip0_1306_86249">
<rect width="234" height="42" fill="white"/>
</clipPath>
</defs>
</svg>
`
      await navigator.clipboard.writeText(wordmarkSvg)
    } catch (err) {
      console.error("Failed to copy wordmark to clipboard:", err)
    }
  }

  const copyLogoToClipboard = async () => {
    try {
      const logoSvg = `<svg width="80" height="100" viewBox="0 0 80 100" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M60 80H20V40H60V80Z" fill="#BCBBBB"/>
<path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="#211E1E"/>
</svg>
`
      await navigator.clipboard.writeText(logoSvg)
    } catch (err) {
      console.error("Failed to copy logo to clipboard:", err)
    }
  }

  return (
    <section data-component="top">
      <div onContextMenu={handleLogoContextMenu}>
        <A href="/">
          <img data-slot="logo light" src={logoLight} alt="opencode logo light" />
          <img data-slot="logo dark" src={logoDark} alt="opencode logo dark" />
        </A>
      </div>

      <Show when={store.contextMenuOpen}>
        <div
          class="context-menu"
          style={`left: ${store.contextMenuPosition.x}px; top: ${store.contextMenuPosition.y}px;`}
        >
          <button class="context-menu-item" onClick={copyLogoToClipboard}>
            <img data-slot="copy light" src={copyLogoLight}
                 alt="Logo"/>
            <img data-slot="copy dark" src={copyLogoDark}
                 alt="Logo"/>
            Copy logo as SVG
          </button>
          <button class="context-menu-item" onClick={copyWordmarkToClipboard}>
            <img data-slot="copy light" src={copyWordmarkLight}
                 alt="Wordmark"/>
            <img data-slot="copy dark" src={copyWordmarkDark}
                 alt="Wordmark"/>
            Copy wordmark as SVG
          </button>
          <button class="context-menu-item"
                  onClick={() => (window.location.href = "/brand")}>
            <img data-slot="copy light" src={copyBrandAssetsLight}
                 alt="Brand Assets"/>
            <img data-slot="copy dark" src={copyBrandAssetsDark}
                 alt="Brand Assets"/>
            Brand assets
          </button>
        </div>
      </Show>
      <nav data-component="nav-desktop">
        <ul>
          <li>
            <a href="https://github.com/sst/opencode" target="_blank">
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
                  <a href="https://github.com/sst/opencode" target="_blank">
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
              </ul>
            </nav>
          </div>
        </Show>
      </nav>
    </section>
  )
}
