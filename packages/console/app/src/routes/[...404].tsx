import "./[...404].css"
import { Title } from "@solidjs/meta"
import { HttpStatusCode } from "@solidjs/start"
import logoLight from "../asset/logo-ornate-light.svg"
import logoDark from "../asset/logo-ornate-dark.svg"
import { useI18n } from "~/context/i18n"

export default function NotFound() {
  const i18n = useI18n()
  return (
    <main data-page="not-found">
      <Title>{i18n.t("notFound.title")}</Title>
      <HttpStatusCode code={404} />
      <div data-component="content">
        <section data-component="top">
          <a href="/" data-slot="logo-link">
            <img data-slot="logo light" src={logoLight} alt="opencode logo light" />
            <img data-slot="logo dark" src={logoDark} alt="opencode logo dark" />
          </a>
          <h1 data-slot="title">{i18n.t("notFound.heading")}</h1>
        </section>

        <section data-component="actions">
          <div data-slot="action">
            <a href="/">{i18n.t("notFound.home")}</a>
          </div>
          <div data-slot="action">
            <a href="/docs">{i18n.t("notFound.docs")}</a>
          </div>
          <div data-slot="action">
            <a href="https://github.com/anomalyco/opencode">{i18n.t("notFound.github")}</a>
          </div>
          <div data-slot="action">
            <a href="/discord">{i18n.t("notFound.discord")}</a>
          </div>
        </section>
      </div>
    </main>
  )
}
