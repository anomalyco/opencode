import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createMemo, createSignal } from "solid-js"
import { Locale } from "@/util/locale"
import { useTheme } from "../context/theme"
import { useKeybind } from "../context/keybind"
import { usePromptStash, type StashEntry } from "./prompt/stash"
import { useI18n } from "../context/i18n"

function getRelativeTime(timestamp: number, t: ReturnType<typeof useI18n>["t"]): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return t("tui.dialog.stash.just_now")
  if (minutes < 60) return t("tui.dialog.stash.minutes_ago", { count: minutes })
  if (hours < 24) return t("tui.dialog.stash.hours_ago", { count: hours })
  if (days < 7) return t("tui.dialog.stash.days_ago", { count: days })
  return Locale.datetime(timestamp)
}

function getStashPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

export function DialogStash(props: { onSelect: (entry: StashEntry) => void }) {
  const dialog = useDialog()
  const stash = usePromptStash()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const i18n = useI18n()

  const [toDelete, setToDelete] = createSignal<number>()

  const options = createMemo(() => {
    const entries = stash.list()
    // Show most recent first
    return entries
      .map((entry, index) => {
        const isDeleting = toDelete() === index
        const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1
        return {
          title: isDeleting
            ? i18n.t("tui.dialog.session.delete_confirm", { keybind: keybind.print("stash_delete") })
            : getStashPreview(entry.input),
          bg: isDeleting ? theme.error : undefined,
          value: index,
          description: getRelativeTime(entry.timestamp, i18n.t),
          footer: lineCount > 1 ? i18n.t("tui.dialog.stash.lines", { count: lineCount }) : undefined,
        }
      })
      .toReversed()
  })

  return (
    <DialogSelect
      title={i18n.t("tui.dialog.stash.title")}
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
      keybind={[
        {
          keybind: keybind.all.stash_delete?.[0],
          title: i18n.t("tui.dialog.stash.delete"),
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
