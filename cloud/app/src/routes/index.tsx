import { Title } from "@solidjs/meta"
import { onCleanup, onMount } from "solid-js"
import "./index.css"
import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
import IMG_SPLASH from "../asset/lander/screenshot-splash.png"
import IMG_VSCODE from "../asset/lander/screenshot-vscode.png"
import IMG_GITHUB from "../asset/lander/screenshot-github.png"
import { IconCopy, IconCheck } from "../component/icon"
import { createAsync, query, redirect } from "@solidjs/router"
import { getActor } from "~/context/auth"
import { withActor } from "~/context/auth.withActor"
import { Account } from "@opencode/cloud-core/account.js"

function CopyStatus() {
  return (
    <div data-component="copy-status">
      <IconCopy data-slot="copy" />
      <IconCheck data-slot="check" />
    </div>
  )
}

const isLoggedIn = query(async () => {
  "use server"
  const actor = await getActor()
  if (actor.type === "account") {
    const workspaces = await withActor(() => Account.workspaces())
    return workspaces[0].id
    // throw redirect(`/workspace/${workspaces[0].id}`)
  }
}, "isLoggedIn")

export default function Home() {
  const workspaceId = createAsync(() => isLoggedIn(), {
    deferStream: true,
  })
  onMount(() => {
    const commands = document.querySelectorAll("[data-copy]")
    for (const button of commands) {
      const callback = () => {
        const text = button.textContent
        if (text) {
          navigator.clipboard.writeText(text)
          button.setAttribute("data-copied", "")
          setTimeout(() => {
            button.removeAttribute("data-copied")
          }, 1500)
        }
      }
      button.addEventListener("click", callback)
      onCleanup(() => {
        button.removeEventListener("click", callback)
      })
    }
  })

  return (
    <main data-page="home">
      <Title>opencode | AI coding agent built for the terminal</Title>
      <div data-component="content">
        <section data-component="top">
          <img data-slot="logo light" src={logoLight} alt="opencode logo light" />
          <img data-slot="logo dark" src={logoDark} alt="opencode logo dark" />
          <h1 data-slot="title">The AI coding agent built for the terminal.</h1>
        </section>

        <section data-component="cta">
          <div data-slot="left">
            <a href="/docs">Get Started</a>
          </div>
          <div data-slot="right">
            <button data-copy data-slot="command">
              <span>
                <span>curl -fsSL&nbsp;</span>
                <span data-slot="protocol">https://</span>
                <span data-slot="highlight">opencode.ai/install</span>
                &nbsp;| bash
              </span>
              <CopyStatus />
            </button>
          </div>
        </section>

        <section data-component="zen">
          <a href="/docs/zen">opencode zen</a>
          <span data-slot="description">
            , a curated list of models provided by opencode
          </span>
          <span data-slot="divider">&nbsp;/&nbsp;</span>
          <a
            href="/auth"
            target="_self"
          >
            Sign in
          </a>
        </section>

        <section data-component="features">
          <ul data-slot="list">
            <li>
              <strong>Native TUI</strong>: A responsive, native, themeable terminal UI.
            </li>
            <li>
              <strong>LSP enabled</strong>: Automatically loads the right LSPs for the LLM.
            </li>
            <li>
              <strong>Multi-session</strong>: Start multiple agents in parallel on the same project.
            </li>
            <li>
              <strong>Shareable links</strong>: Share a link to any sessions for reference or to debug.
            </li>
            <li>
              <strong>Claude Pro</strong>: Log in with Anthropic to use your Claude Pro or Max account.
            </li>
            <li>
              <strong>Use any model</strong>: Supports 75+ LLM providers through{" "}
              <a href="https://models.dev">Models.dev</a>, including local models.
            </li>
          </ul>
        </section>

        <section data-component="install">
          <div data-component="method">
            <h3 data-component="title">npm</h3>
            <button data-copy data-slot="button">
              <span>
                npm install -g&nbsp;<strong>opencode-ai</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
          <div data-component="method">
            <h3 data-component="title">bun</h3>
            <button data-copy data-slot="button">
              <span>
                bun install -g&nbsp;<strong>opencode-ai</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
          <div data-component="method">
            <h3 data-component="title">homebrew</h3>
            <button data-copy data-slot="button">
              <span>
                brew install&nbsp;<strong>sst/tap/opencode</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
          <div data-component="method">
            <h3 data-component="title">paru</h3>
            <button data-copy data-slot="button">
              <span>
                paru -S&nbsp;<strong>opencode-bin</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
        </section>

        <section data-component="screenshots">
          <div data-slot="left">
            <figure>
              <figcaption>opencode TUI with the tokyonight theme</figcaption>
              <a href="/docs/cli">
                <img src={IMG_SPLASH} alt="opencode TUI with tokyonight theme" />
              </a>
            </figure>
          </div>
          <div data-slot="right">
            <div data-slot="row1">
              <figure>
                <figcaption>opencode in VS Code</figcaption>
                <a href="/docs/ide">
                  <img src={IMG_VSCODE} alt="opencode in VS Code" />
                </a>
              </figure>
            </div>
            <div data-slot="row2">
              <figure>
                <figcaption>opencode in GitHub</figcaption>
                <a href="/docs/github">
                  <img src={IMG_GITHUB} alt="opencode in GitHub" />
                </a>
              </figure>
            </div>
          </div>
        </section>

        <footer data-component="footer">
          <div data-slot="cell">
            <a href="https://github.com/sst/opencode">GitHub</a>
          </div>
          <div data-slot="cell">
            <a href="https://opencode.ai/discord">Discord</a>
          </div>
          <div data-slot="cell">
            <span>
              ©2025 <a href="https://anoma.ly">Anomaly Innovations</a>
            </span>
          </div>
        </footer>
      </div>
    </main>
  )
}
