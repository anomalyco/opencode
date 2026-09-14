import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { createMemo, createSignal } from "solid-js"
import { Locale } from "../util/locale"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { usePromptStash, type StashEntry } from "../prompt/stash"
import { useLanguage } from "../context/language"

function getRelativeTime(timestamp: number, language: ReturnType<typeof useLanguage>): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return language.t("tui.dialogs.justNow")
  const relative = new Intl.RelativeTimeFormat(language.intl(), { style: "short" })
  if (minutes < 60) return relative.format(-minutes, "minute")
  if (hours < 24) return relative.format(-hours, "hour")
  if (days < 7) return relative.format(-days, "day")
  return language.date(timestamp, { dateStyle: "medium", timeStyle: "short" })
}

function getStashPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

export function DialogStash(props: { onSelect: (entry: StashEntry) => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const stash = usePromptStash()
  const theme = useTheme("elevated")
  const shortcuts = Keymap.useShortcuts()

  const [toDelete, setToDelete] = createSignal<number>()

  const options = createMemo(() => {
    const entries = stash.list()
    // Show most recent first
    return entries
      .map((entry, index) => {
        const isDeleting = toDelete() === index
        const lineCount = (entry.prompt.text.match(/\n/g)?.length ?? 0) + 1
        return {
          title: isDeleting
            ? language.t("tui.pressKeyAgainToConfirm", { key: shortcuts.get("stash.delete") ?? "" })
            : getStashPreview(entry.prompt.text),
          bg: isDeleting ? theme.background.action.destructive.focused : undefined,
          fg: isDeleting ? theme.text.action.destructive.focused : undefined,
          value: index,
          description: getRelativeTime(entry.timestamp, language),
          footer: lineCount > 1 ? language.t("tui.dialogs.stashLines", { count: lineCount }) : undefined,
        }
      })
      .toReversed()
  })

  return (
    <DialogSelect
      title={language.t("tui.dialogs.stash")}
      options={options()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        const entries = stash.list()
        const entry = entries[option.value]
        if (entry) {
          stash.remove(option.value)
          props.onSelect(entry)
        }
        dialog.clear()
      }}
      actions={[
        {
          command: "stash.delete",
          title: language.t("tui.delete"),
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              stash.remove(option.value)
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
      ]}
    />
  )
}
