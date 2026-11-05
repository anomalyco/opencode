import { Link, Meta } from "@solidjs/meta"
import { For } from "solid-js"
import { getRequestEvent } from "solid-js/web"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import { LOCALES, route, tag } from "~/lib/language"

function skip(path: string) {
  const evt = getRequestEvent()
  if (!evt) return false

  const key = "__locale_links_seen"
  const locals = evt.locals as Record<string, unknown>
  const seen = locals[key] instanceof Set ? (locals[key] as Set<string>) : new Set<string>()
  locals[key] = seen
  if (seen.has(path)) return true
  seen.add(path)
  return false
}

/**
 * The canonical URL and the language alternates. `englishOnly` pages serve the same English text at
 * every locale URL, so the English URL is canonical and is the only alternate.
 */
export function LocaleLinks(props: { path: string; englishOnly?: boolean }) {
  const language = useLanguage()
  if (skip(props.path)) return null
  const canonical = `${config.baseUrl}${route(props.englishOnly ? "en" : language.locale(), props.path)}`

  return (
    <>
      <Link rel="canonical" href={canonical} />
      <Meta property="og:url" content={canonical} />
      <For each={props.englishOnly ? (["en"] as const) : LOCALES}>
        {(locale) => (
          <Link rel="alternate" hreflang={tag(locale)} href={`${config.baseUrl}${route(locale, props.path)}`} />
        )}
      </For>
      <Link rel="alternate" hreflang="x-default" href={`${config.baseUrl}${props.path}`} />
    </>
  )
}
