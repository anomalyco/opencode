import { For, Show, createUniqueId } from "solid-js"
import { IconChevron } from "~/component/icon"
import { useI18n } from "~/context/i18n"
import { LOCALES, dir, label, tag, type Locale } from "~/lib/language"
import type { DocsSet } from "../config"
import { docsLocaleHref } from "../lib/navigation"

/**
 * The site's language picker (component/language-picker.tsx) for the docs' footer: a popover
 * anchored to its trigger, every row a link to the same page in that language, so it works without
 * JavaScript and the links tell search engines about the other languages. Docs pages render on the
 * server only, so this renders the same markup and client.ts drives it (open state, the cookie).
 */
export function DocsLanguagePicker(props: { set: DocsSet; slug: string; locale: Locale }) {
  const i18n = useI18n()
  const id = createUniqueId()
  const menuId = `docs-language-menu-${id}`
  const anchor = `--docs-language-${id}`
  return (
    <div data-component="language-picker" data-design="menuActive menuColor">
      <div data-component="dropdown">
        <button
          data-slot="trigger"
          type="button"
          popovertarget={menuId}
          aria-expanded="false"
          aria-label={`${i18n.t("nav.language")}: ${label(props.locale)}`}
          style={{ "anchor-name": anchor }}
        >
          <span lang={tag(props.locale)} dir={dir(props.locale)}>
            {label(props.locale)}
          </span>
          <IconChevron data-slot="chevron" aria-hidden="true" />
        </button>
        <div id={menuId} popover="auto" data-slot="dropdown" data-align="left" style={{ "position-anchor": anchor }}>
          <For each={LOCALES}>
            {(locale) => (
              <a
                data-slot="item"
                data-locale={locale}
                data-selected={locale === props.locale ? "true" : "false"}
                href={docsLocaleHref(props.slug, props.set, locale)}
                hreflang={tag(locale)}
                lang={tag(locale)}
                aria-current={locale === props.locale ? "true" : undefined}
              >
                <span data-slot="label" lang={tag(locale)} dir={dir(locale)}>
                  {label(locale)}
                </span>
                <Show when={locale === props.locale}>
                  <svg data-slot="check" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                    <path d="M2.5 7.5L5.5 10.5L11.5 3.5" stroke="currentColor" stroke-width="1.5" />
                  </svg>
                </Show>
              </a>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
