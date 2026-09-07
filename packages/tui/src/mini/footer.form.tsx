/** @jsxImportSource @opentui/solid */
import type { BoxRenderable, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
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
import { stringWidth } from "../util/string-width"

export function RunFormBody(props: {
  request: MiniFormRequest
  theme: RunFooterTheme
  onReply: (input: FormReply) => void | Promise<void>
  onCancel: (input: FormCancel) => void | Promise<void>
  openExternal?: (url: string) => Promise<unknown>
  state?: FormBodyState
  onState?: (state: FormBodyState) => void
  mono?: boolean
}) {
  const dims = useTerminalDimensions()
  const [size, setSize] = createSignal(dims())
  const [contentHeight, setContentHeight] = createSignal(1)
  const [viewportHeight, setViewportHeight] = createSignal(0)
  const compact = () => size().width < 56 || size().height < 12
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
  const editing = () => !unsupported() && !confirm() && (textual() || state().editing)
  const message = createMemo(() => {
    const value = props.request.metadata?.message
    return typeof value === "string" ? value : undefined
  })
  let area: TextareaRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined
  const choices = new Map<number, BoxRenderable>()

  const revealChoice = () => {
    const row = choices.get(state().selected)
    if (!scroll || scroll.isDestroyed || !row || row.isDestroyed || state().editing || confirm()) return
    if (row.y < scroll.viewport.y) scroll.scrollBy(row.y - scroll.viewport.y)
    const height = Math.min(row.height, scroll.viewport.height)
    if (row.y + height > scroll.viewport.y + scroll.viewport.height)
      scroll.scrollBy(row.y + height - scroll.viewport.y - scroll.viewport.height)
  }

  createEffect(() => {
    state().field
    state().selected
    size()
    revealChoice()
  })

  const action = createMemo(() => {
    if (confirm()) return "submit"
    if (textual() || state().editing) return "save"
    const field = externalField()
    if (!field) return "choose"
    if (state().answers[field.key] === true) return formSingle(props.request) ? "submit" : "next"
    return state().externalReady[field.key] ? (size().width < 24 ? "done" : "acknowledge") : "open URL"
  })

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
    const row = choices.get(selected)
    if (scroll && row && (row.y < scroll.viewport.y || row.y >= scroll.viewport.y + scroll.viewport.height)) {
      setState(base)
      revealChoice()
      return
    }
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
    if (event.name === "pageup" || event.name === "pagedown") {
      scroll?.scrollBy(event.name === "pageup" ? -1 : 1, "viewport")
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
    <box
      width="100%"
      height="100%"
      minHeight={0}
      flexDirection="column"
      backgroundColor={props.theme.surface}
      paddingLeft={compact() ? 0 : 2}
      paddingRight={compact() ? 0 : 3}
      paddingTop={compact() ? 0 : 1}
      paddingBottom={compact() ? 0 : 1}
      onSizeChange={function () {
        setSize({ width: this.width, height: this.height })
      }}
    >
      <box height={1} flexDirection="row" gap={1} flexShrink={0} marginBottom={compact() ? 0 : 1}>
        <text fg={unsupported() ? props.theme.warning : props.theme.question} wrapMode="none" flexShrink={0}>
          {props.mono ? "*" : "◆"}
        </text>
        <text fg={props.theme.text} wrapMode="none" truncate minWidth={0}>
          {props.request.title}
        </text>
        <Show when={!unsupported() && !formSingle(props.request)}>
          <text fg={props.theme.muted} wrapMode="none" flexShrink={0}>
            {confirm()
              ? "Review"
              : `${Math.min(state().field + 1, props.request.fields.length)}/${props.request.fields.length}`}
          </text>
        </Show>
      </box>
      <scrollbox
        width="100%"
        height={!compact() && editing() ? Math.min(contentHeight(), Math.max(1, size().height - 9)) : undefined}
        flexGrow={!compact() && editing() ? 0 : 1}
        minHeight={0}
        viewportOptions={{
          paddingRight: props.mono ? 0 : 1,
          onSizeChange() {
            setViewportHeight(this.height)
          },
        }}
        verticalScrollbarOptions={{
          visible: !props.mono && contentHeight() > viewportHeight(),
          trackOptions: { backgroundColor: props.theme.surface, foregroundColor: props.theme.line },
        }}
        onSizeChange={revealChoice}
        ref={(item) => {
          scroll = item
        }}
      >
        <box
          width="100%"
          flexDirection="column"
          flexShrink={0}
          gap={compact() ? 0 : 1}
          onSizeChange={function () {
            setContentHeight(this.height)
          }}
        >
          <Show when={message()}>
            {(value) => (
              <text width="100%" fg={props.theme.muted} flexShrink={0}>
                {value()}
              </text>
            )}
          </Show>
          <Show when={unsupported()}>
            {(value) => (
              <box width="100%" flexDirection="column" flexShrink={0} gap={compact() ? 0 : 1}>
                <text width="100%" fg={props.theme.warning} wrapMode="word" flexShrink={0}>
                  {value()}
                </text>
                <text width="100%" fg={props.theme.muted} flexShrink={0}>
                  This request remains pending until you dismiss it.
                </text>
              </box>
            )}
          </Show>
          <Show when={!unsupported() && externalField()}>
            {(field) => (
              <box width="100%" flexDirection="column" flexShrink={0} gap={compact() ? 0 : 1}>
                <text width="100%" fg={props.theme.text} wrapMode="word" flexShrink={0}>
                  {field().description ?? formLabel(field())}
                </text>
                <text width="100%" fg={props.theme.link} wrapMode="word" flexShrink={0}>
                  {field().url}
                </text>
                <text
                  width="100%"
                  fg={state().answers[field().key] === true ? props.theme.selection : props.theme.muted}
                  flexShrink={0}
                >
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
            <box width="100%" flexDirection="column" flexShrink={0} gap={compact() ? 0 : 1}>
              <text width="100%" fg={props.theme.text} wrapMode="word" flexShrink={0}>
                {answerField()!.description ?? formLabel(answerField()!)}
                {answerField()!.required ? " (required)" : ""}
                {multiple() ? " (select all that apply)" : ""}
              </text>
              <Show when={!textual() && !state().editing}>
                <box width="100%" flexDirection="column" flexShrink={0}>
                  <For each={rows()}>
                    {(row, index) => {
                      const active = () => state().selected === index()
                      const picked = () => {
                        const field = current()
                        if (!field) return false
                        const value = state().answers[field.key]
                        return Array.isArray(value) ? value.includes(String(row.value)) : value === row.value
                      }
                      const ordinal = () => (props.mono ? `${active() ? ">" : " "}${index() + 1}.` : `${index() + 1}.`)
                      const inline = () =>
                        !!row.description &&
                        stringWidth(ordinal()) +
                          2 +
                          stringWidth(row.label) +
                          (multiple() ? 4 : picked() ? 2 : 0) +
                          stringWidth(row.description) <=
                          size().width - (compact() ? 0 : 5) - (props.mono ? 0 : 1)
                      return (
                        <box
                          ref={(item) => {
                            choices.set(index(), item)
                          }}
                          onSizeChange={revealChoice}
                          flexShrink={0}
                          flexDirection="row"
                          gap={1}
                          alignItems="flex-start"
                          onMouseMove={() => setState((previous) => formSetSelected(previous, index()))}
                          backgroundColor={active() ? props.theme.formfieldFocusedBg : "transparent"}
                          onMouseUp={() => choose(index())}
                        >
                          <text
                            fg={active() ? props.theme.formfieldFocusedText : props.theme.formfieldText}
                            wrapMode="none"
                            flexShrink={0}
                          >
                            {ordinal()}
                          </text>
                          <box
                            flexDirection={inline() ? "row" : "column"}
                            gap={inline() ? 1 : 0}
                            flexGrow={1}
                            minWidth={0}
                          >
                            <text
                              fg={active() ? props.theme.formfieldFocusedText : props.theme.formfieldText}
                              wrapMode="word"
                              flexShrink={0}
                            >
                              <span style={{ fg: picked() ? props.theme.selection : undefined }}>
                                {multiple() ? `[${picked() ? "x" : " "}] ` : ""}
                              </span>
                              {row.label}
                              <span style={{ fg: props.theme.selection }}>{!multiple() && picked() ? " *" : ""}</span>
                            </text>
                            <Show when={row.description}>
                              <text fg={props.theme.muted} wrapMode="word" flexShrink={0}>
                                {row.description}
                              </text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                  <Show when={custom()}>
                    <box
                      ref={(item) => {
                        choices.set(rows().length, item)
                      }}
                      onSizeChange={revealChoice}
                      flexShrink={0}
                      flexDirection="row"
                      gap={1}
                      backgroundColor={
                        state().selected === rows().length ? props.theme.formfieldFocusedBg : "transparent"
                      }
                      onMouseUp={() => choose(rows().length)}
                    >
                      <text
                        wrapMode="none"
                        flexShrink={0}
                        fg={
                          state().selected === rows().length
                            ? props.theme.formfieldFocusedText
                            : props.theme.formfieldText
                        }
                      >
                        {props.mono
                          ? `${state().selected === rows().length ? ">" : " "}${rows().length + 1}.`
                          : `${rows().length + 1}.`}
                      </text>
                      <text
                        wrapMode="word"
                        flexGrow={1}
                        minWidth={0}
                        fg={
                          state().selected === rows().length
                            ? props.theme.formfieldFocusedText
                            : props.theme.formfieldText
                        }
                      >
                        Type your own answer
                      </text>
                    </box>
                  </Show>
                </box>
              </Show>
            </box>
          </Show>
          <Show when={!unsupported() && confirm()}>
            <box width="100%" flexDirection="column" flexShrink={0}>
              <For each={props.request.fields}>
                {(field) => (
                  <text width="100%" fg={props.theme.muted} wrapMode="word" flexShrink={0}>
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
          <Show when={stringWidth(state().error) > size().width || state().error.includes("\n")}>
            <text width="100%" fg={props.theme.error} wrapMode="word" flexShrink={0}>
              {state().error}
            </text>
          </Show>
        </box>
      </scrollbox>
      <Show when={!unsupported() && answerField() && editing()}>
        <textarea
          ref={(item: TextareaRenderable) => {
            area = item
          }}
          width="100%"
          minHeight={1}
          maxHeight={Math.max(1, Math.min(3, size().height - 6))}
          flexShrink={0}
          marginTop={compact() ? 0 : 1}
          initialValue={formInput(state(), current())}
          placeholder={formPlaceholder(answerField())}
          placeholderColor={props.theme.muted}
          textColor={props.theme.formfieldText}
          focusedTextColor={props.theme.formfieldFocusedText}
          backgroundColor={props.theme.surface}
          focusedBackgroundColor={props.theme.formfieldFocusedBg}
          cursorColor={props.theme.formfieldFocusedText}
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
      <Show when={state().error && compact()}>
        <text height={1} fg={props.theme.error} wrapMode="none" truncate flexShrink={0}>
          {state().error}
        </text>
      </Show>
      <Show when={!compact() && editing()}>
        <box flexGrow={1} minHeight={0} />
      </Show>
      <Show
        when={compact()}
        fallback={
          <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
            <text
              fg={state().submitting ? props.theme.running : props.theme.muted}
              wrapMode="word"
              flexShrink={1}
              minWidth={0}
            >
              {state().submitting
                ? "submitting…"
                : unsupported()
                  ? "esc dismiss"
                  : confirm()
                    ? "enter submit   esc dismiss"
                    : editing()
                      ? "enter save   esc dismiss"
                      : externalField()
                        ? `enter ${action()}   esc dismiss`
                        : props.mono
                          ? "up/down select   enter choose   tab next   esc dismiss"
                          : "↑↓ select   enter choose   tab next   esc dismiss"}
            </text>
            <Show when={state().error}>
              <text fg={props.theme.error} wrapMode="none" truncate flexShrink={1}>
                {state().error}
              </text>
            </Show>
          </box>
        }
      >
        <box flexDirection="row" flexWrap="wrap" columnGap={1} flexShrink={0}>
          <Show when={!unsupported()}>
            <text
              height={1}
              fg={state().submitting ? props.theme.running : props.theme.muted}
              wrapMode="none"
              flexShrink={0}
            >
              {state().submitting ? "submitting…" : `enter ${action()}`}
            </text>
          </Show>
          <Show when={!state().submitting}>
            <text height={1} fg={props.theme.muted} wrapMode="none" flexShrink={0}>
              esc dismiss
            </text>
          </Show>
          <Show when={!state().submitting && size().height >= 10}>
            <text fg={props.theme.muted} wrapMode="word" maxWidth="100%" flexShrink={0}>
              {size().width >= 56 && rows().length > 0 && !state().editing ? "up/down select  tab next  " : ""}pgup/pgdn
              scroll
            </text>
          </Show>
        </box>
      </Show>
    </box>
  )
}
