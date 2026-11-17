import { Meta } from "@solidjs/meta"
import { For } from "solid-js"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import type { Locale } from "~/lib/language"
import type { OgImage } from "~/lib/og"

/** One Open Graph (`property`) or X (`name`) tag. */
export type ShareTag = { property: string; content: string } | { name: string; content: string }

/**
 * A page's link preview: Open Graph and X tags. `image` is the page's 1200×630 PNG card from
 * `ogImage` (script/og.ts renders them). Crawlers need absolute image URLs.
 * `englishOnly` pages serve English at every locale URL.
 */
export function ShareMeta(props: { title: string; description: string; image: OgImage; englishOnly?: boolean }) {
  const language = useLanguage()
  const tags = () =>
    shareTags({ ...props, locale: props.englishOnly ? "en" : language.locale(), englishOnly: props.englishOnly })
  return <For each={tags()}>{(tag) => <Meta {...tag} />}</For>
}

/**
 * The tags ShareMeta renders, for pages that write their own head (the docs, DocsLayout.tsx).
 * A card's src and video are site paths, its own (/og/…) or the files bucket's (/files/site/og/…).
 */
export function shareTags(props: {
  title: string
  description: string
  image: OgImage
  locale: Locale
  englishOnly?: boolean
}): ShareTag[] {
  const image = (props.englishOnly ? undefined : props.image.locales?.[props.locale]) ?? props.image
  const video = props.image.video && `${config.baseUrl}${props.image.video}`
  return [
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "OpenCode" },
    { property: "og:locale", content: OG_LOCALE[props.englishOnly ? "en" : props.locale] },
    { property: "og:title", content: props.title },
    { property: "og:description", content: props.description },
    { property: "og:image", content: `${config.baseUrl}${image.src}` },
    { property: "og:image:type", content: "image/png" },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: image.alt },
    // Only iMessage and Discord play og:video. Everyone else shows og:image.
    ...(video
      ? [
          { property: "og:video", content: video },
          { property: "og:video:secure_url", content: video },
          { property: "og:video:type", content: "video/mp4" },
          { property: "og:video:width", content: "1200" },
          { property: "og:video:height", content: "630" },
        ]
      : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:site", content: `@${new URL(config.social.twitter).pathname.slice(1)}` },
    { name: "twitter:title", content: props.title },
    { name: "twitter:description", content: props.description },
    { name: "twitter:image", content: `${config.baseUrl}${image.src}` },
    { name: "twitter:image:alt", content: image.alt },
  ]
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
