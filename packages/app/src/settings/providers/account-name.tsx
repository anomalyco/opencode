import { InlineInput } from "@opencode/ui/inline-input"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { createInlineRename } from "@/settings/rename"

export function AccountNameInput(props: {
  value: string
  class?: string
  onSave: (label: string) => Promise<boolean>
  onClose: () => void
}) {
  const language = useLanguage()
  let input: HTMLInputElement | undefined

  // Like session title editing, clicking away keeps the typed name.
  const rename = createInlineRename({
    open: props.value,
    blurPolicy: "submit",
    current: () => props.value,
    input: () => input,
    onSave: (label) => props.onSave(label),
    onClose: () => props.onClose(),
    onTimeout: () =>
      showToast({
        title: language.t("common.requestFailed"),
        description: language.t("home.sessions.load.timeout"),
      }),
  })

  return (
    <InlineInput
      ref={input}
      aria-label={language.t("settings.providers.account.name")}
      dir="auto"
      value={rename.draft()}
      readOnly={rename.saving()}
      aria-busy={rename.saving() || undefined}
      class={`field-sizing-content rounded-[6px] px-1 py-1 ${props.class ?? ""}`}
      style={{ "--inline-input-shadow": "none", "text-align": "start" }}
      onInput={(event) => rename.input(event.currentTarget.value)}
      data-owns-escape
      onKeyDown={rename.keyDown}
      onBlur={rename.blur}
    />
  )
}
