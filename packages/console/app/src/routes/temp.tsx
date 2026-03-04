import "./index.css"
import { Title } from "@solidjs/meta"
import { onCleanup, onMount } from "solid-js"
import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
import IMG_SPLASH from "../asset/lander/screenshot-splash.png"
import { IconCopy, IconCheck } from "../component/icon"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"

function CopyStatus() {
  return (
    <div data-component="copy-status">
      <IconCopy data-slot="copy" />
      <IconCheck data-slot="check" />
    </div>
  )
}

export default function Home() {
  const i18n = useI18n()
  const language = useLanguage()

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
      <Title>{i18n.t("temp.title")}</Title>

      <div data-component="content">
        <section data-component="top">
          <img data-slot="logo light" src={logoLight} alt={i18n.t("temp.logoLightAlt")} />
          <img data-slot="logo dark" src={logoDark} alt={i18n.t("temp.logoDarkAlt")} />
          <h1 data-slot="title">{i18n.t("temp.hero.title")}</h1>
          <div data-slot="login">
            <a href="/auth">{i18n.t("temp.zen")}</a>
          </div>
        </section>

        <section data-component="cta">
          <div data-slot="left">
            <a href={language.route("/docs")}>{i18n.t("temp.getStarted")}</a>
          </div>
          <div data-slot="center">
            <a href="/auth">{i18n.t("temp.zen")}</a>
          </div>
          <div data-slot="right">
            <button data-copy data-slot="command">
              <span>
                <span>curl -fsSL </span>
                <span data-slot="protocol">https://</span>
                <span data-slot="highlight">opencode.ai/install</span>
                <span> | bash</span>
              </span>
              <CopyStatus />
            </button>
          </div>
        </section>

        <section data-component="features">
          <ul data-slot="list">
            <li>
              <strong>{i18n.t("temp.feature.native.title")}</strong> {i18n.t("temp.feature.native.body")}
            </li>
            <li>
              <strong>{i18n.t("home.what.lsp.title")}</strong> {i18n.t("home.what.lsp.body")}
            </li>
            <li>
              <strong>{i18n.t("temp.zen")}</strong> {i18n.t("temp.feature.zen.beforeLink")}{" "}
              <a href={language.route("/docs/zen")}>{i18n.t("temp.feature.zen.link")}</a>{" "}
              {i18n.t("temp.feature.zen.afterLink")} <label>{i18n.t("home.banner.badge")}</label>
            </li>
            <li>
              <strong>{i18n.t("home.what.multiSession.title")}</strong> {i18n.t("home.what.multiSession.body")}
            </li>
            <li>
              <strong>{i18n.t("home.what.shareLinks.title")}</strong> {i18n.t("home.what.shareLinks.body")}
            </li>
            <li>
              <strong>{i18n.t("home.what.copilot.title")}</strong> {i18n.t("home.what.copilot.body")}
            </li>
            <li>
              <strong>{i18n.t("home.what.chatgptPlus.title")}</strong> {i18n.t("home.what.chatgptPlus.body")}
            </li>
            <li>
              <strong>{i18n.t("home.what.anyModel.title")}</strong> {i18n.t("temp.feature.models.beforeLink")}{" "}
              <a href="https://models.dev">Models.dev</a>
              {i18n.t("temp.feature.models.afterLink")}
            </li>
          </ul>
        </section>

        <section data-component="install">
          <div data-component="method">
            <h3 data-component="title">npm</h3>
            <button data-copy data-slot="button">
              <span>
                npm install -g <strong>opencode-ai</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
          <div data-component="method">
            <h3 data-component="title">bun</h3>
            <button data-copy data-slot="button">
              <span>
                bun install -g <strong>opencode-ai</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
          <div data-component="method">
            <h3 data-component="title">homebrew</h3>
            <button data-copy data-slot="button">
              <span>
                brew install <strong>opencode</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
          <div data-component="method">
            <h3 data-component="title">paru</h3>
            <button data-copy data-slot="button">
              <span>
                paru -S <strong>opencode-bin</strong>
              </span>
              <CopyStatus />
            </button>
          </div>
        </section>

        <section data-component="screenshots">
          <figure>
            <figcaption>{i18n.t("temp.screenshot.caption")}</figcaption>
            <a href={language.route("/docs/cli")}>
              <img src={IMG_SPLASH} alt={i18n.t("temp.screenshot.alt")} />
            </a>
          </figure>
        </section>

        <footer data-component="footer">
          <div data-slot="cell">
            <a href="https://x.com/opencode">{i18n.t("footer.x")}</a>
          </div>
          <div data-slot="cell">
            <a href="https://github.com/anomalyco/opencode">{i18n.t("footer.github")}</a>
          </div>
          <div data-slot="cell">
            <a href="https://opencode.ai/discord">{i18n.t("footer.discord")}</a>
          </div>
        </footer>
      </div>

      <div data-component="legal">
        <span>
          ©2025 <a href="https://anoma.ly">Anomaly</a>
        </span>
      </div>
    </main>
  )
}
