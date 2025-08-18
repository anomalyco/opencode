import { Title } from "@solidjs/meta"
import { onCleanup, onMount } from "solid-js"
import "./index.css"
import logo from "../asset/logo-ornate-dark.svg"
import IMG_SPLASH from "../asset/screenshot-splash.webp"
import IMG_VSCODE from "../asset/screenshot-vscode.webp"
import IMG_GITHUB from "../asset/screenshot-github.webp"
import { IconCopy, IconCheck } from "../component/icon"

function CopyStatus() {
  return (
    <div data-component="copy-status">
      <IconCopy data-slot="copy" />
      <IconCheck data-slot="check" />
    </div>
  )
}

export default function Home() {
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
          <img data-slot="logo" src={logo} alt="logo" />
          <h1 data-slot="title">The AI coding agent built for the terminal.</h1>
        </section>

        <section data-component="cta">
          <div data-slot="left">
            <a href="/docs">Get Started</a>
          </div>
          <div data-slot="right">
            <button data-copy data-slot="command" data-command="curl -fsSL https://opencode.ai/install | bash">
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
            <div data-component="title">opencode TUI with tokyonight theme</div>
            <div data-slot="filler">
              <img src={IMG_SPLASH} alt="opencode TUI with tokyonight theme" />
            </div>
          </div>
          <div data-slot="right">
            <div data-slot="cell">
              <div data-component="title">opencode in VS Code</div>
              <div data-slot="filler">
                <img src={IMG_VSCODE} alt="opencode in VS Code" />
              </div>
            </div>
            <div data-slot="cell">
              <div data-component="title">opencode in GitHub</div>
              <div data-slot="filler">
                <img src={IMG_GITHUB} alt="opencode in GitHub" />
              </div>
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
