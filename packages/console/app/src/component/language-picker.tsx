import { For, createSignal } from "solid-js"
import { useLocation, useNavigate } from "@solidjs/router"
import { Dropdown, DropdownItem } from "~/component/dropdown"
import { useLanguage } from "~/context/language"
import { route, strip } from "~/lib/language"
import "./language-picker.css"

export function LanguagePicker(props: { align?: "left" | "right" } = {}) {
  const language = useLanguage()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = createSignal(false)

  return (
    <div data-component="language-picker">
      <Dropdown
        trigger={language.label(language.locale())}
        align={props.align ?? "left"}
        open={open()}
        onOpenChange={setOpen}
      >
        <For each={language.locales}>
          {(locale) => (
            <DropdownItem
              selected={locale === language.locale()}
              onClick={() => {
                language.setLocale(locale)
                const href = `${route(locale, strip(location.pathname))}${location.search}${location.hash}`
                if (href !== `${location.pathname}${location.search}${location.hash}`) navigate(href)
                setOpen(false)
              }}
            >
              {language.label(locale)}
            </DropdownItem>
          )}
        </For>
      </Dropdown>
    </div>
  )
}
