import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
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
          <button
            className="context-menu-item"
            onClick={() => window.open("https://github.com/sst/opencode", "_blank")}
          >
            Copy logo as SVG
          </button>
          <button
            className="context-menu-item"
            onClick={() => window.open("https://github.com/sst/opencode", "_blank")}
          >
            Copy wordmark as SVG
          </button>
          <button className="context-menu-item"
                  onClick={() => (window.location.href = "/brand")}>
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
            <a href="/brand">Brand assets</a>
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
                  <a href="/brand">Brand assets</a>
                </li>
              </ul>
            </nav>
          </div>
        </Show>
      </nav>
    </section>
  )
}
