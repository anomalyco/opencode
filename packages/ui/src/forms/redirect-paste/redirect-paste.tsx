import { createUniqueId, onMount, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { useI18n } from "../../context/i18n"

/** Why the last paste was not taken: the field was empty, or the server rejected the URL with `message`. */
export type RedirectPasteError = { readonly type: "required" } | { readonly type: "rejected"; readonly message: string }

/**
 * The field of a browser sign-in that takes the URL the browser was redirected to, for when the browser cannot reach
 * the machine running the server (SSH, a remote desktop connection, a container).
 */
export function RedirectPasteForm(props: {
  value: string
  error: RedirectPasteError | undefined
  /** Takes no edits or submits: a paste is in flight, or the server took one and is finishing the sign-in. */
  locked: boolean
  /** A paste is in flight. */
  submitting: boolean
  /** Focuses the field on mount, for a dialog where pasting is the main action. */
  autofocus?: boolean
  onInput: (value: string) => void
  onSubmit: () => void
}) {
  const i18n = useI18n()
  const errorID = createUniqueId()
  let input: HTMLInputElement | undefined

  const error = () => {
    if (!props.error) return

    return props.error.type === "rejected" ? props.error.message : i18n.t("ui.redirectPaste.required")
  }

  onMount(() => {
    if (props.autofocus) input?.focus({ preventScroll: true })
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
      class="flex flex-col items-start gap-5 self-stretch"
    >
      <label class="flex w-full flex-col gap-2 font-[530] leading-4 text-v2-text-text-base">
        {i18n.t("ui.redirectPaste.label")}
        <TextInput
          ref={input}
          class="!w-full"
          name="redirect"
          placeholder={i18n.t("ui.redirectPaste.placeholder")}
          value={props.value}
          readOnly={props.locked}
          invalid={error() !== undefined}
          aria-describedby={error() ? errorID : undefined}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
      </label>
      <Show when={error()}>
        {(message) => (
          <div id={errorID} role="alert" class="-mt-4 text-xs text-v2-state-fg-danger">
            {message()}
          </div>
        )}
      </Show>
      <Button type="submit" variant="contrast" disabled={props.locked} aria-busy={props.submitting}>
        {i18n.t("ui.common.continue")}
      </Button>
    </form>
  )
}
