import { For } from "solid-js"
import { Link } from "@solidjs/meta"
import { LOCALES, localizedUrl, tag } from "../lib/language"
import { useLanguage } from "../context/language"

export function LocaleLinks(props: { path: string }) {
  const language = useLanguage()
  return (
    <>
      <Link rel="canonical" href={localizedUrl(language.locale(), props.path)} />
      <For each={LOCALES}>
        {(locale) => <Link rel="alternate" hreflang={tag(locale)} href={localizedUrl(locale, props.path)} />}
      </For>
      <Link rel="alternate" hreflang="x-default" href={localizedUrl("en", props.path)} />
    </>
  )
}
