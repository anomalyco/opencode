import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { getLanguage, setLanguage, t, type SupportedLocale } from "@/i18n"
import { useToast } from "@tui/ui/toast"

const LANGUAGES: Array<{ value: SupportedLocale; title: string; native: string }> = [
  { value: "en", title: "English", native: "English" },
  { value: "ko", title: "Korean", native: "한국어" },
]

export function DialogLanguage() {
  const dialog = useDialog()
  const toast = useToast()
  const current = getLanguage()

  return (
    <DialogSelect
      title={t("language.title")}
      current={current}
      options={LANGUAGES.map((lang) => ({
        title: `${lang.native} (${lang.title})`,
        value: lang.value,
        onSelect: () => {
          setLanguage(lang.value)
          dialog.clear()
          toast.show({
            variant: "success",
            message: t("language.changed", { language: lang.native }),
          })
        },
      }))}
    />
  )
}
