import { For, createSignal } from "solid-js"
import { Dropdown, DropdownItem } from "~/component/dropdown"
import { useLanguage } from "~/context/language"
import "./language-picker.css"

export function LanguagePicker(props: { align?: "left" | "right" } = {}) {
  const language = useLanguage()
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
