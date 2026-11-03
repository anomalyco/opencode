import { createSignal } from "solid-js"
import { useLanguage } from "../context/language"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

export function DialogLanguage() {
  const language = useLanguage()
  const toast = useToast()
  const [saving, setSaving] = createSignal(false)

  return (
    <DialogSelect
      title={language.t("command.category.language")}
      current={language.locale()}
      options={language.locales.map((locale) => ({
        title: language.label(locale),
        value: locale,
        searchText: locale,
      }))}
      onSelect={(option) => {
        if (saving() || option.value === language.locale()) return
        setSaving(true)
        void language
          .setLocale(option.value)
          .catch(toast.error)
          .finally(() => setSaving(false))
      }}
    />
  )
}
