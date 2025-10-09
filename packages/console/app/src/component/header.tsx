import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
import { A, createAsync } from "@solidjs/router"
import { createMemo, Match, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { github } from "~/lib/github"

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
  })

  return (
    <section data-component="top">
      <A href="/">
        <img data-slot="logo light" src={logoLight} alt="opencode logo light" />
        <img data-slot="logo dark" src={logoDark} alt="opencode logo dark" />
      </A>
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
