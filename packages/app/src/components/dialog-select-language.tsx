import { useI18n, supportedLocales } from "@/i18n"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"

const languages = {
  en: { name: "English", flag: "🇺🇸" },
  "zh-CN": { name: "简体中文", flag: "🇨🇳" },
  ja: { name: "日本語", flag: "🇯🇵" },
  fr: { name: "Français", flag: "🇫🇷" },
  es: { name: "Español", flag: "🇪🇸" },
} as const

export function DialogSelectLanguage() {
  const { locale, setLocale } = useI18n()

  return (
    <Dialog
      title="Language / 语言 / 言語"
    >
      <List
        items={supportedLocales}
        key={(lang) => lang}
        current={supportedLocales.find((l) => l === locale())}
        onSelect={(lang) => lang && setLocale(lang)}
      >
        {(lang) => (
          <div class="flex items-center gap-2">
            <span class="text-lg">{languages[lang].flag}</span>
            <span>{languages[lang].name}</span>
          </div>
        )}
      </List>
    </Dialog>
  )
}
