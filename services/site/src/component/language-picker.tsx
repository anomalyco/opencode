import { For, Show, createSignal, createUniqueId, onCleanup, onMount } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { IconChevron } from "~/component/icon"
import { openLanguageSheet } from "~/component/language-sheet"
import { onCloseMenus } from "~/component/site/menu-open"
import { prefersSheet } from "~/component/site/sheet"
import { keepUnderHeader } from "~/component/site/under-header"
import { useI18n } from "~/context/i18n"
import { useLanguage } from "~/context/language"
import { loadLanguage } from "~/i18n/content"
import { route, strip, type Locale } from "~/lib/language"
import "./dropdown.css"
import "./language-picker.css"

/**
 * The language control. Pointers get a dropdown: a popover anchored to the trigger that flips and
 * shrinks to stay on screen (CSS anchor positioning) and scrolls under the pinned header
 * (under-header.ts). Touch phones get the site's bottom sheet (language-sheet.tsx). Every row is a
 * link to the page in that language, so both work without JavaScript and tell search engines about
 * the other languages.
 */
export function LanguagePicker(props: { align?: "left" | "right" } = {}) {
  const language = useLanguage()
  const i18n = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const id = createUniqueId()
  const menuId = `language-menu-${id}`
  const anchor = `--language-${id}`
  const [open, setOpen] = createSignal(false)
  const href = (locale: Locale) => `${route(locale, strip(location.pathname))}${location.search}${location.hash}`
  let menu!: HTMLDivElement
  let trigger!: HTMLButtonElement
  onCloseMenus(() => {
    if (menu.matches(":popover-open")) menu.hidePopover()
  })

  onMount(() => {
    const toggle = (event: Event) => {
      if (!(event instanceof ToggleEvent)) return
      setOpen(event.newState === "open")
      if (event.newState === "open") keepUnderHeader(menu, trigger)
      // Opened from the keyboard: focus moves to the current language.
      if (event.newState === "open" && menu.previousElementSibling?.matches(":focus-visible"))
        menu.querySelector<HTMLElement>('[aria-current="true"]')?.focus()
    }
    menu.addEventListener("toggle", toggle)
    onCleanup(() => menu.removeEventListener("toggle", toggle))
  })

  return (
    <div data-component="language-picker" data-design="menuActive menuColor">
      <div data-component="dropdown">
        <button
          ref={trigger}
          data-slot="trigger"
          type="button"
          popovertarget={menuId}
          aria-expanded={open() ? "true" : "false"}
          aria-label={`${i18n.t("nav.language")}: ${language.label(language.locale())}`}
          style={{ "anchor-name": anchor }}
          on:click={(event) => {
            if (!prefersSheet()) return
            if (openLanguageSheet(event.currentTarget)) event.preventDefault()
          }}
        >
          <span lang={language.tag(language.locale())} dir={language.dir(language.locale())}>
            {language.label(language.locale())}
          </span>
          <IconChevron data-slot="chevron" aria-hidden="true" />
        </button>
        <div
          ref={menu}
          id={menuId}
          popover="auto"
          data-slot="dropdown"
          data-align={props.align ?? "left"}
          style={{ "position-anchor": anchor }}
        >
          <For each={language.locales}>
            {(locale) => (
              <a
                data-slot="item"
                data-selected={locale === language.locale() ? "true" : "false"}
                href={href(locale)}
                hreflang={language.tag(locale)}
                lang={language.tag(locale)}
                aria-current={locale === language.locale() ? "true" : undefined}
                // Fetch the language's text as soon as an option is pointed at, focused or touched,
                // so the click switches without waiting for it.
                onPointerEnter={() => void loadLanguage(locale).catch(() => {})}
                onFocus={() => void loadLanguage(locale).catch(() => {})}
                onTouchStart={() => void loadLanguage(locale).catch(() => {})}
                on:click={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                  event.preventDefault()
                  const next = href(locale)
                  menu.hidePopover()
                  // Switch once the language's text has arrived, so the page doesn't show English first;
                  // if it can't arrive, load the page in that language instead.
                  void loadLanguage(locale).then(
                    () => {
                      language.setLocale(locale)
                      if (next !== `${location.pathname}${location.search}${location.hash}`) navigate(next)
                    },
                    () => window.location.assign(next),
                  )
                }}
              >
                <span data-slot="label" lang={language.tag(locale)} dir={language.dir(locale)}>
                  {language.label(locale)}
                </span>
                <Show when={locale === language.locale()}>
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
