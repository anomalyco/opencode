import { InlineInput } from "@opencode/ui/inline-input"
import { onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"

/** Edits an account label in place: Enter saves, Escape or leaving the field cancels. */
export function AccountNameInput(props: {
  value: string
  class?: string
  onSave: (label: string) => Promise<boolean>
  onClose: () => void
}) {
  const language = useLanguage()
  const [store, setStore] = createStore({ draft: props.value, saving: false })
  let input: HTMLInputElement | undefined

  // Waits a frame so a closing menu's focus restore cannot pull focus back out of the field.
  onMount(() =>
    requestAnimationFrame(() => {
      input?.focus()
      input?.select()
    }),
  )

  const save = async () => {
    const label = store.draft.trim()

    if (!label || label === props.value) return props.onClose()
    setStore("saving", true)

    if (await props.onSave(label)) return props.onClose()
    setStore("saving", false)
    requestAnimationFrame(() => input?.focus())
  }

  return (
    <InlineInput
      ref={input}
      aria-label={language.t("settings.providers.account.name")}
      dir="auto"
      value={store.draft}
      disabled={store.saving}
      class={props.class}
      style={{ "--inline-input-shadow": "0 0 0 1px var(--v2-border-border-focus)" }}
      onInput={(event) => setStore("draft", event.currentTarget.value)}
      onKeyDown={(event) => {
        event.stopPropagation()

        if (event.isComposing || event.keyCode === 229) return

        if (event.key === "Enter") {
          event.preventDefault()
          void save()

          return
        }

        if (event.key !== "Escape") return
        event.preventDefault()
        props.onClose()
      }}
      onBlur={() => {
        if (!store.saving) props.onClose()
      }}
    />
  )
}
