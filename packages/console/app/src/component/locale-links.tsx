import { Link } from "@solidjs/meta"
import { For } from "solid-js"
import { config } from "~/config"
import { useLanguage } from "~/context/language"
import { LOCALES, route, tag } from "~/lib/language"

export function LocaleLinks(props: { path: string }) {
  const language = useLanguage()

  return (
    <>
      <Link rel="canonical" href={`${config.baseUrl}${route(language.locale(), props.path)}`} />
      <For each={LOCALES}>
        {(locale) => (
          <Link rel="alternate" hreflang={tag(locale)} href={`${config.baseUrl}${route(locale, props.path)}`} />
        )}
      </For>
      <Link rel="alternate" hreflang="x-default" href={`${config.baseUrl}${props.path}`} />
    </>
  )
}
