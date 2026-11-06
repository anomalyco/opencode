import "./provider-logos.css"
import { For } from "solid-js"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { marks, rich } from "~/i18n/rich"
import { Rich } from "./rich-text"
import { docsUrl } from "~/lib/docs"
import { providerLogo, providerMarks, type ProviderMark } from "~/lib/providers"
import { siteSettings } from "./settings"

/** A provider's mark, drawn as a mask so it takes the text colour; its name for assistive tech. */
export function ProviderLogo(props: { provider: ProviderMark; decorative?: boolean }) {
  return (
    <span
      data-slot="mark"
      role={props.decorative ? undefined : "img"}
      aria-label={props.decorative ? undefined : props.provider.name}
      aria-hidden={props.decorative ? "true" : undefined}
      style={{ "--logo": `url(${providerLogo(props.provider.id)})` }}
    />
  )
}

/**
 * Settings › Provider logos, in "What is OpenCode?": the model providers' marks as a quiet row, inline
 * in a sentence, a dense grid with the count, or a slow marquee. Every exploration renders;
 * data-variant (set before first paint for a saved value) shows one, so the section never jumps.
 * Hidden marks are display: none, so their images load only when shown.
 */
export function ProviderLogos() {
  const i18n = useI18n()
  const language = useLanguage()
  // The four named models as one list in the page's language ("A, B, C, D"), each with its mark.
  const pairs = () => {
    const items = named(["anthropic", "openai", "google", "xai"])
    const format = new Intl.ListFormat(language.locale() === "en" ? "en-GB" : language.tag(language.locale()), {
      type: "unit",
    })
    return format.formatToParts(items.map((_, index) => String(index))).map((part) => {
      if (part.type === "literal") return part.value
      const provider = items[Number(part.value)]
      return (
        <span data-slot="pair">
          <ProviderLogo provider={provider} decorative />
          {"model" in provider ? provider.model : provider.name}
        </span>
      )
    })
  }
  const named = (ids: string[]) => ids.map((id) => providerMarks.find((item) => item.id === id)!)
  const list = (items: readonly ProviderMark[], hidden?: boolean) => (
    <ul aria-hidden={hidden ? "true" : undefined}>
      <For each={items}>
        {(provider) => (
          <li data-tip={hidden ? undefined : provider.name}>
            <ProviderLogo provider={provider} decorative={hidden} />
          </li>
        )}
      </For>
    </ul>
  )
  return (
    <div
      data-component="provider-logos"
      data-variant={siteSettings.providerLogos}
      data-design="providerLogos"
      aria-label={i18n.t("home.providers.aria")}
    >
      <div data-slot="row">{list(providerMarks.slice(0, 10))}</div>
      <p data-slot="inline">
        <For each={marks(i18n.t("home.providers.inline"))}>
          {(part) => (part.mark === "list" ? pairs() : part.text)}
        </For>
      </p>
      <div data-slot="grid">
        {list(providerMarks)}
        <p>
          <Rich
            value={rich(i18n.t("home.providers.grid"), {
              modelsdev: "https://models.dev",
              providers: docsUrl("/providers/"),
            })}
          />
        </p>
      </div>
      <div data-slot="marquee">
        <div data-slot="track">
          {list(providerMarks)}
          {list(providerMarks, true)}
        </div>
      </div>
    </div>
  )
}
