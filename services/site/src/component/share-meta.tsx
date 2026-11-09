import { Meta } from "@solidjs/meta"
import { Show } from "solid-js"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import type { Locale } from "~/lib/language"
import type { OgImage } from "~/lib/og"

/**
 * A page's link preview: Open Graph and X tags. `image` is the page's 1200×630 PNG card from
 * `ogImage` (script/og.ts renders them). Crawlers need absolute image URLs.
 * `englishOnly` pages serve English at every locale URL.
 */
export function ShareMeta(props: { title: string; description: string; image: OgImage; englishOnly?: boolean }) {
  const language = useLanguage()
  const image = () => (props.englishOnly ? undefined : props.image.locales?.[language.locale()]) ?? props.image
  return (
    <>
      <Meta property="og:type" content="website" />
      <Meta property="og:site_name" content="OpenCode" />
      <Meta property="og:locale" content={OG_LOCALE[props.englishOnly ? "en" : language.locale()]} />
      <Meta property="og:title" content={props.title} />
      <Meta property="og:description" content={props.description} />
      <Meta property="og:image" content={`${config.baseUrl}${image().src}`} />
      <Meta property="og:image:type" content="image/png" />
      <Meta property="og:image:width" content="1200" />
      <Meta property="og:image:height" content="630" />
      <Meta property="og:image:alt" content={image().alt} />
      {/* Only iMessage and Discord play og:video. Everyone else shows og:image. */}
      <Show when={props.image.video}>
        {(video) => (
          <>
            <Meta property="og:video" content={`${config.baseUrl}${video()}`} />
            <Meta property="og:video:secure_url" content={`${config.baseUrl}${video()}`} />
            <Meta property="og:video:type" content="video/mp4" />
            <Meta property="og:video:width" content="1200" />
            <Meta property="og:video:height" content="630" />
          </>
        )}
      </Show>
      <Meta name="twitter:card" content="summary_large_image" />
      <Meta name="twitter:site" content={`@${new URL(config.social.twitter).pathname.slice(1)}`} />
      <Meta name="twitter:title" content={props.title} />
      <Meta name="twitter:description" content={props.description} />
      <Meta name="twitter:image" content={`${config.baseUrl}${image().src}`} />
      <Meta name="twitter:image:alt" content={image().alt} />
    </>
  )
}

// Open Graph wants language_TERRITORY.
const OG_LOCALE = {
  en: "en_US",
  zh: "zh_CN",
  zht: "zh_TW",
  ko: "ko_KR",
  de: "de_DE",
  es: "es_ES",
  fr: "fr_FR",
  it: "it_IT",
  da: "da_DK",
  ja: "ja_JP",
  pl: "pl_PL",
  ru: "ru_RU",
  uk: "uk_UA",
  ar: "ar_AR",
  no: "nb_NO",
  br: "pt_BR",
  th: "th_TH",
  tr: "tr_TR",
} satisfies Record<Locale, string>
