import { TextField as Kobalte } from "@kobalte/core/text-field"
import { createSignal, onCleanup, Show, splitProps, untrack } from "solid-js"
import type { ComponentProps } from "solid-js"
import { useI18n } from "../context/i18n"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Tooltip } from "@opencode/ui/tooltip"
import {
  INITIAL_TEXT_FIELD_COPY_STATE,
  selectTextFieldCopied,
  selectTextFieldCopyIcon,
  selectTextFieldCopyLabelKey,
  transitionTextFieldCopy,
  type TextFieldCopyEffect,
  type TextFieldCopyEvent,
} from "./text-field-machine"

export interface TextFieldProps
  extends ComponentProps<typeof Kobalte.Input>,
    Partial<
      Pick<
        ComponentProps<typeof Kobalte>,
        | "name"
        | "defaultValue"
        | "value"
        | "onChange"
        | "onKeyDown"
        | "validationState"
        | "required"
        | "disabled"
        | "readOnly"
      >
    > {
  label?: string
  hideLabel?: boolean
  description?: string
  error?: string
  variant?: "normal" | "ghost"
  copyable?: boolean
  copyKind?: "clipboard" | "link"
  multiline?: boolean
}

export function TextField(props: TextFieldProps) {
  const i18n = useI18n()

  const [local, others] = splitProps(props, [
    "name",
    "defaultValue",
    "value",
    "onChange",
    "onKeyDown",
    "validationState",
    "required",
    "disabled",
    "readOnly",
    "class",
    "label",
    "hideLabel",
    "description",
    "error",
    "variant",
    "copyable",
    "copyKind",
    "multiline",
  ])

  const [copyState, setCopyState] = createSignal(INITIAL_TEXT_FIELD_COPY_STATE)
  let timer: ReturnType<typeof setTimeout> | undefined

  const dispatch = (event: TextFieldCopyEvent) => {
    const next = transitionTextFieldCopy(untrack(copyState), event)

    if (next.state !== untrack(copyState)) setCopyState(next.state)
    next.effects.forEach(run)
  }

  const run = (effect: TextFieldCopyEffect) => {
    if (effect.type === "timer.clear") {
      clearTimeout(timer)
      timer = undefined

      return
    }

    if (effect.type === "reset.schedule") {
      timer = setTimeout(() => dispatch({ type: "reset.elapsed", attempt: effect.attempt }), effect.delayMs)

      return
    }

    timer = setTimeout(() => dispatch({ type: "copy.timed-out", attempt: effect.attempt }), effect.timeoutMs)
    void writeClipboard(effect.value).then(
      (written) => dispatch({ type: written ? "copy.succeeded" : "copy.failed", attempt: effect.attempt }),
      () => dispatch({ type: "copy.failed", attempt: effect.attempt }),
    )
  }

  onCleanup(() => dispatch({ type: "disposed" }))

  const copied = () => selectTextFieldCopied(copyState())
  const label = () => i18n.t(selectTextFieldCopyLabelKey(copyState(), local.copyKind))

  const requestCopy = () =>
    dispatch({
      type: "copy.requested",
      value: local.value ?? local.defaultValue ?? "",
      enabled: !!local.copyable && !local.disabled,
    })

  return (
    <Kobalte
      data-component="input"
      data-variant={local.variant || "normal"}
      name={local.name}
      defaultValue={local.defaultValue}
      value={local.value}
      onChange={local.onChange}
      onKeyDown={local.onKeyDown}
      onClick={requestCopy}
      required={local.required}
      disabled={local.disabled}
      readOnly={local.readOnly}
      validationState={local.validationState}
    >
      <Show when={local.label}>
        <Kobalte.Label data-slot="input-label" classList={{ "sr-only": local.hideLabel }}>
          {local.label}
        </Kobalte.Label>
      </Show>
      <div data-slot="input-wrapper">
        <Show
          when={local.multiline}
          fallback={<Kobalte.Input {...others} data-slot="input-input" class={local.class} />}
        >
          <Kobalte.TextArea {...others} autoResize data-slot="input-input" class={local.class} />
        </Show>
        <Show when={local.copyable}>
          <Tooltip
            appearance="compact"
            value={label()}
            placement="top"
            gutter={4}
            forceOpen={copied() || undefined}
            skipDelayDuration={0}
          >
            <IconButton
              type="button"
              icon={<Icon name={selectTextFieldCopyIcon(copyState(), local.copyKind)} />}
              variant="ghost"
              disabled={local.disabled}
              onClick={(event) => {
                // The field itself copies on click too; one click is one copy.
                event.stopPropagation()
                requestCopy()
              }}
              tabIndex={-1}
              data-slot="input-copy-button"
              aria-label={label()}
            />
          </Tooltip>
        </Show>
      </div>
      <Show when={local.description}>
        <Kobalte.Description data-slot="input-description">{local.description}</Kobalte.Description>
      </Show>
      <Kobalte.ErrorMessage data-slot="input-error">{local.error}</Kobalte.ErrorMessage>
    </Kobalte>
  )
}

// `navigator.clipboard` exists only in secure contexts, so plain-HTTP LAN origins copy through a selected textarea.
async function writeClipboard(text: string) {
  const written = await navigator.clipboard?.writeText(text).then(
    () => true,
    () => false,
  )

  if (written) return true
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.setAttribute("aria-hidden", "true")
  textarea.tabIndex = -1
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  textarea.style.pointerEvents = "none"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  active?.focus({ preventScroll: true })

  return copied
}
