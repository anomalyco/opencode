/** @jsxImportSource @opentui/solid */
import type { TextareaRenderable } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import {
  createFormBodyState,
  formAcknowledge,
  formCommitInput,
  formConfirm,
  formCurrent,
  formCustom,
  formDisplay,
  formErrorMessage,
  formInput,
  formLabel,
  formMove,
  formPick,
  formPlaceholder,
  formReply,
  formRows,
  formSetError,
  formSetExternalReady,
  formSetDraft,
  formSetField,
  formSetSelected,
  formSetSubmitting,
  formSingle,
  formSync,
  formTextual,
  formUnsupported,
  formValidate,
  formValidateValue,
} from "./form.shared"
import type { FormBodyState } from "./form.shared"
import type { RunFooterTheme } from "./theme"
import type { FormCancel, FormReply, MiniFormRequest } from "./types"

export function RunFormBody(props: {
  request: MiniFormRequest
  theme: RunFooterTheme
  onReply: (input: FormReply) => void | Promise<void>
  onCancel: (input: FormCancel) => void | Promise<void>
  openExternal?: (url: string) => Promise<unknown>
  state?: FormBodyState
  onState?: (state: FormBodyState) => void
}) {
  const [state, setLocalState] = createSignal(props.state ?? createFormBodyState(props.request))
  const setState = (next: FormBodyState | ((previous: FormBodyState) => FormBodyState)) => {
    const value = typeof next === "function" ? next(state()) : next
    setLocalState(value)
    props.onState?.(value)
  }
  const unsupported = createMemo(() => formUnsupported(props.request))
  const current = createMemo(() => formCurrent(props.request, state()))
  const answerField = createMemo(() => {
    const field = current()
    return field?.type === "external" ? undefined : field
  })
  const externalField = createMemo(() => {
    const field = current()
    return field?.type === "external" ? field : undefined
  })
  const confirm = createMemo(() => formConfirm(props.request, state()))
  const rows = createMemo(() => formRows(current()))
  const custom = createMemo(() => formCustom(current()))
  const textual = createMemo(() => formTextual(current()))
  const multiple = createMemo(() => current()?.type === "multiselect")
  const message = createMemo(() => {
    const value = props.request.metadata?.message
    return typeof value === "string" ? value : undefined
  })
  let area: TextareaRenderable | undefined

  createEffect(() => {
    setState((previous) => formSync(previous, props.request))
  })

  onCleanup(() => {
    const currentArea = area
    if (!currentArea || currentArea.isDestroyed) return
    setState((previous) => formSetDraft(previous, current(), currentArea.plainText))
  })

  createEffect(() => {
    if (!state().editing || !area || area.isDestroyed) return
    const value = formInput(state(), current())
    if (area.plainText !== value) {
      area.setText(value)
      area.cursorOffset = value.length
    }
    queueMicrotask(() => {
      if (!area || area.isDestroyed || !state().editing) return
      area.focus()
      area.cursorOffset = area.plainText.length
    })
  })

  const beginReply = async (input: FormReply) => {
    const formID = props.request.id
    setState((previous) => formSetSubmitting(previous, true))
    try {
      await props.onReply(input)
    } catch (error) {
      setState((previous) => (previous.formID === formID ? formSetError(previous, formErrorMessage(error)) : previous))
    }
  }

  const submit = (next = state()) => {
    const invalid = formValidate(props.request, next)
    if (invalid) {
      setState((previous) => formSetError(previous, invalid))
      return
    }
    const reply = formReply(props.request, next)
    if (reply) void beginReply(reply)
  }

  const cancel = async () => {
    const formID = props.request.id
    setState((previous) => formSetSubmitting(previous, true))
    try {
      await props.onCancel({
        sessionID: props.request.sessionID,
        formID: props.request.id,
        location: props.request.location,
      })
    } catch (error) {
      setState((previous) => (previous.formID === formID ? formSetError(previous, formErrorMessage(error)) : previous))
    }
  }

  const commitInput = () => {
    const next = formCommitInput(state(), props.request, area?.plainText ?? formInput(state(), current()))
    setState(next)
    if (next.error) return
    if (formSingle(props.request)) {
      submit(next)
      return
    }
    setState(formSetField(next, props.request, next.field + 1))
  }

  const choose = (selected = state().selected) => {
    const base = formSetSelected(state(), selected)
    const next = formPick(base, props.request)
    setState(next)
    if (next.editing || multiple()) return
    if (formSingle(props.request)) submit(next)
  }

  const moveField = (direction: -1 | 1) => {
    const next = (state().field + direction + props.request.fields.length + 1) % (props.request.fields.length + 1)
    if (direction < 0 || confirm()) {
      setState((previous) => formSetField(previous, props.request, next))
      return
    }
    const field = current()
    if (field?.type === "external") {
      if (state().answers[field.key] !== true) {
        setState((previous) => formSetError(previous, `Acknowledge ${formLabel(field)}`))
        return
      }
    } else if (field) {
      const invalid = formValidateValue(field, state().answers[field.key])
      if (invalid) {
        setState((previous) => formSetError(previous, invalid))
        return
      }
    }
    setState((previous) => formSetField(previous, props.request, next))
  }

  const external = async () => {
    const field = current()
    if (field?.type !== "external") return
    if (state().answers[field.key] === true) {
      if (formSingle(props.request)) submit()
      else moveField(1)
      return
    }
    if (state().externalReady[field.key]) {
      const next = formAcknowledge(state(), props.request)
      setState(next)
      if (formSingle(props.request)) submit(next)
      return
    }
    try {
      if (props.openExternal) await props.openExternal(field.url)
      else {
        const { default: open } = await import("open")
        await open(field.url)
      }
      setState((previous) => formSetExternalReady(previous, field.key))
    } catch {
      setState((previous) => formSetExternalReady(previous, field.key))
      setState((previous) => formSetError(previous, "Could not open the URL. Open it manually, then press enter."))
    }
  }

  useKeyboard((event) => {
    if (state().submitting) {
      event.preventDefault()
      return
    }
    if (event.name === "escape") {
      void cancel()
      event.preventDefault()
      return
    }
    if (unsupported()) return
    if (state().editing) return
    if (
      event.name === "tab" ||
      event.name === "left" ||
      event.name === "right" ||
      event.name === "h" ||
      event.name === "l"
    ) {
      const direction = event.shift || event.name === "left" || event.name === "h" ? -1 : 1
      moveField(direction)
      event.preventDefault()
      return
    }
    if (confirm() && event.name === "return") {
      submit()
      event.preventDefault()
      return
    }
    if (current()?.type === "external" && event.name === "return") {
      void external()
      event.preventDefault()
      return
    }
    const total = rows().length + (custom() ? 1 : 0)
    const digit = Number(event.name)
    if (!Number.isNaN(digit) && digit >= 1 && digit <= Math.min(total, 9)) {
      choose(digit - 1)
      event.preventDefault()
      return
    }
    if (event.name === "up" || event.name === "k") {
      setState((previous) => formMove(previous, props.request, -1))
      event.preventDefault()
      return
    }
    if (event.name === "down" || event.name === "j") {
      setState((previous) => formMove(previous, props.request, 1))
      event.preventDefault()
      return
    }
    if (event.name === "return") {
      choose()
      event.preventDefault()
    }
  })

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={props.theme.surface}>
      <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={3} paddingTop={1} flexGrow={1} flexShrink={1}>
        <box flexDirection="row" gap={1} flexShrink={0}>
          <text fg={unsupported() ? props.theme.warning : props.theme.highlight}>◆</text>
          <text fg={props.theme.text}>{props.request.title}</text>
          <Show when={!unsupported() && !formSingle(props.request)}>
            <text fg={props.theme.muted}>
              {confirm()
                ? "Review"
                : `${Math.min(state().field + 1, props.request.fields.length)}/${props.request.fields.length}`}
            </text>
          </Show>
        </box>
        <Show when={message()}>{(value) => <text fg={props.theme.muted}>{value()}</text>}</Show>
        <Show when={unsupported()}>
          {(value) => (
            <box flexDirection="column" gap={1}>
              <text fg={props.theme.warning} wrapMode="word">
                {value()}
              </text>
              <text fg={props.theme.muted}>This request remains pending until you dismiss it.</text>
            </box>
          )}
        </Show>
        <Show when={!unsupported() && externalField()}>
          {(field) => (
            <box flexDirection="column" gap={1}>
              <text fg={props.theme.text}>{field().description ?? formLabel(field())}</text>
              <text fg={props.theme.highlight} wrapMode="word">
                {field().url}
              </text>
              <text fg={props.theme.muted}>
                {state().answers[field().key] === true
                  ? "Acknowledged"
                  : state().externalReady[field().key]
                    ? "Press enter to acknowledge completion"
                    : "Press enter to open the URL"}
              </text>
            </box>
          )}
        </Show>
        <Show when={!unsupported() && answerField() && !confirm()}>
          <box flexDirection="column" gap={1}>
            <text fg={props.theme.text} wrapMode="word">
              {answerField()!.description ?? formLabel(answerField()!)}
              {answerField()!.required ? " (required)" : ""}
              {multiple() ? " (select all that apply)" : ""}
            </text>
            <Show when={textual() || state().editing}>
              <textarea
                ref={(item: TextareaRenderable) => {
                  area = item
                }}
                width="100%"
                minHeight={1}
                maxHeight={3}
                initialValue={formInput(state(), current())}
                placeholder={formPlaceholder(answerField())}
                placeholderColor={props.theme.muted}
                textColor={props.theme.text}
                focusedTextColor={props.theme.text}
                backgroundColor={props.theme.surface}
                focusedBackgroundColor={props.theme.surface}
                cursorColor={props.theme.text}
                focused
                onSubmit={commitInput}
                onContentChange={() => {
                  const currentArea = area
                  if (!currentArea || currentArea.isDestroyed) return
                  setState((previous) => formSetDraft(previous, current(), currentArea.plainText))
                }}
                onKeyDown={(event) => {
                  if (event.name === "escape") {
                    event.preventDefault()
                    void cancel()
                  }
                }}
              />
            </Show>
            <Show when={!textual() && !state().editing}>
              <box flexDirection="column">
                <For each={rows()}>
                  {(row, index) => {
                    const active = () => state().selected === index()
                    const picked = () => {
                      const field = current()
                      if (!field) return false
                      const value = state().answers[field.key]
                      return Array.isArray(value) ? value.includes(String(row.value)) : value === row.value
                    }
                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseOver={() => setState((previous) => formSetSelected(previous, index()))}
                        onMouseUp={() => choose(index())}
                      >
                        <text fg={active() ? props.theme.highlight : props.theme.muted}>{index() + 1}.</text>
                        <text fg={active() ? props.theme.text : props.theme.muted}>
                          {multiple() ? `[${picked() ? "x" : " "}] ` : ""}
                          {row.label}
                          {!multiple() && picked() ? " *" : ""}
                        </text>
                        <Show when={row.description}>
                          <text fg={props.theme.muted}>{row.description}</text>
                        </Show>
                      </box>
                    )
                  }}
                </For>
                <Show when={custom()}>
                  <box flexDirection="row" gap={1} onMouseUp={() => choose(rows().length)}>
                    <text fg={state().selected === rows().length ? props.theme.highlight : props.theme.muted}>
                      {rows().length + 1}.
                    </text>
                    <text fg={state().selected === rows().length ? props.theme.text : props.theme.muted}>
                      Type your own answer
                    </text>
                  </box>
                </Show>
              </box>
            </Show>
          </box>
        </Show>
        <Show when={!unsupported() && confirm()}>
          <box flexDirection="column">
            <For each={props.request.fields}>
              {(field) => (
                <text fg={props.theme.muted} wrapMode="none" truncate>
                  {formLabel(field)}:{" "}
                  {field.type === "external"
                    ? state().answers[field.key] === true
                      ? "acknowledged"
                      : "required"
                    : formDisplay(field, state().answers[field.key]) || "(not answered)"}
                </text>
              )}
            </For>
          </box>
        </Show>
      </box>
      <box
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        flexShrink={0}
      >
        <text fg={props.theme.muted}>
          {state().submitting
            ? "submitting..."
            : unsupported()
              ? "esc dismiss"
              : confirm()
                ? "enter submit   esc dismiss"
                : textual() || state().editing
                  ? "enter save   esc dismiss"
                  : "↑↓ select   enter choose   tab next   esc dismiss"}
        </text>
        <Show when={state().error}>
          <text fg={props.theme.error} wrapMode="none" truncate>
            {state().error}
          </text>
        </Show>
      </box>
    </box>
  )
}
