import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { createMemo, createSignal, onCleanup } from "solid-js"
import { Locale } from "../util/locale"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { usePromptStash, type StashEntry } from "../prompt/stash"
import { useToast } from "../ui/toast"

function getRelativeTime(timestamp: number): string {
  const now = Date.now()
  const diff = now - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return Locale.datetime(timestamp)
}

function getStashPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

export function DialogStash(props: { onSelect: (entry: StashEntry) => void }) {
  const dialog = useDialog()
  const stash = usePromptStash()
  const theme = useTheme("elevated")
  const shortcuts = Keymap.useShortcuts()
  const toast = useToast()

  const [toDelete, setToDelete] = createSignal<string>()
  const [pending, setPending] = createSignal(false)
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  const options = createMemo(() => {
    const entries = stash.list()
    // Show most recent first
    return entries
      .map((entry) => {
        const isDeleting = toDelete() === entry.id
        const lineCount = (entry.prompt.text.match(/\n/g)?.length ?? 0) + 1
        return {
          title: isDeleting
            ? `Press ${shortcuts.get("stash.delete")} again to confirm`
            : getStashPreview(entry.prompt.text),
          bg: isDeleting ? theme.background.action.destructive.focused : undefined,
          fg: isDeleting ? theme.text.action.destructive.focused : undefined,
          value: entry.id,
          description: getRelativeTime(entry.timestamp),
          footer: lineCount > 1 ? `~${lineCount} lines` : undefined,
        }
      })
      .toReversed()
  })

  return (
    <DialogSelect
      title="Stash"
      options={options()}
      preserveSelection
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={async (option) => {
        if (pending()) return
        setPending(true)
        await stash
          .remove(option.value)
          .then(
            (entry) => {
              // A consumed entry still belongs to the caller after this dialog closes.
              if (entry) props.onSelect(entry)
              if (!disposed) dialog.clear()
            },
            (error) => toast.error(error),
          )
          .finally(() => setPending(false))
      }}
      actions={[
        {
          command: "stash.delete",
          title: "delete",
          onTrigger: async (option) => {
            if (pending()) return
            if (toDelete() === option.value) {
              setPending(true)
              await stash
                .remove(option.value)
                .catch((error) => toast.error(error))
                .finally(() => setPending(false))
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
