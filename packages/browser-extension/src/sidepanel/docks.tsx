// Requests that block the agent: permissions and questions. Forked from the desktop docks
// (packages/app/src/session/requests) onto the shared DockPrompt surface and its styles.
import type {
  FormAnswer,
  FormInfo,
  FormMultiselectField,
  FormStringField,
  PermissionRequest,
} from "@opencode/client/promise"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"

export function PermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (decision: "once" | "always" | "reject") => void
}) {
  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">Permission required</div>
        </div>
      }
      footer={
        <>
          <div />
          <div data-slot="permission-footer-actions">
            <Button variant="ghost" size="normal" disabled={props.responding} onClick={() => props.onDecide("reject")}>
              Deny
            </Button>
            <Button
              variant="neutral"
              size="normal"
              disabled={props.responding}
              onClick={() => props.onDecide("always")}
            >
              Allow always
            </Button>
            <Button variant="submit" size="normal" disabled={props.responding} onClick={() => props.onDecide("once")}>
              Allow once
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="permission-row">
        <span data-slot="permission-spacer" aria-hidden="true" />
        <div data-slot="permission-hint">
          {props.request.message || `The agent wants to use “${props.request.action}”.`}
        </div>
      </div>
      <Show when={props.request.resources.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.resources}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}

type QuestionField = FormStringField | FormMultiselectField

function questionField(field: FormInfo["fields"][number]): field is QuestionField {
  return field.type === "string" || field.type === "multiselect"
}

function visible(field: FormInfo["fields"][number]) {
  return field.type === "external" || !field.hidden
}

/** Whether the question dock can render every visible field of this form. */
export function answerable(form: FormInfo) {
  return form.fields.filter(visible).every(questionField)
}

export function QuestionDock(props: {
  request: FormInfo
  sending: boolean
  onReply: (answer: FormAnswer) => void
  onDismiss: () => void
}) {
  const questions = createMemo(() =>
    props.request.fields
      .filter(visible)
      .filter(questionField)
      .map((field) => ({
        field,
        question: field.description ?? field.title ?? props.request.title,
        options: field.options ?? [],
        multiple: field.type === "multiselect",
        custom: field.custom !== false,
      })),
  )
  // Keyed by request in the parent, so this state starts fresh for every question.
  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as string[][],
    custom: [] as string[],
    customOn: [] as boolean[],
  })
  const question = () => questions()[store.tab]
  const last = () => store.tab >= questions().length - 1
  const picked = (value: string) => store.answers[store.tab]?.includes(value) ?? false
  const customText = () => store.custom[store.tab] ?? ""
  const customOn = () => store.customOn[store.tab] === true
  const placeholder = () => {
    const field = question()?.field
    return (field?.type === "string" && field.placeholder) || "Your answer"
  }

  const pick = (value: string) => {
    if (!question()?.multiple) {
      setStore("answers", store.tab, [value])
      setStore("customOn", store.tab, false)
      return
    }
    setStore("answers", store.tab, (current = []) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

  const answerFor = (index: number) => {
    const item = questions()[index]
    const custom = store.customOn[index] ? (store.custom[index] ?? "").trim() : ""
    const values = [...(store.answers[index] ?? []), ...(custom ? [custom] : [])]
    if (values.length === 0) return
    return item.multiple ? values : custom || values[0]
  }

  const submit = () =>
    props.onReply(
      Object.fromEntries(
        questions().flatMap((item, index) => {
          const value = answerFor(index)
          return value === undefined ? [] : [[item.field.key, value]]
        }),
      ),
    )

  const next = () => {
    if (props.sending) return
    if (last()) return submit()
    setStore("tab", store.tab + 1)
  }

  return (
    <div data-component="session-question-dock">
      <DockPrompt
        kind="question"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            props.onDismiss()
            return
          }
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          next()
        }}
        header={
          <>
            <div data-slot="question-header-title">
              {questions().length > 1 ? `Question ${store.tab + 1} of ${questions().length}` : "Question"}
            </div>
            <Show when={questions().length > 1}>
              <div data-slot="question-header-actions">
                <div data-slot="question-progress">
                  <For each={questions()}>
                    {(_, index) => (
                      <button
                        type="button"
                        data-slot="question-progress-segment"
                        data-active={index() === store.tab}
                        data-answered={answerFor(index()) !== undefined}
                        disabled={props.sending}
                        aria-label={`Question ${index() + 1}`}
                        onClick={() => setStore("tab", index())}
                      />
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={props.sending} onClick={props.onDismiss}>
              Dismiss
            </Button>
            <div data-slot="question-footer-actions">
              <Show when={store.tab > 0}>
                <Button
                  variant="neutral"
                  size="large"
                  disabled={props.sending}
                  onClick={() => setStore("tab", store.tab - 1)}
                >
                  Back
                </Button>
              </Show>
              <Button variant={last() ? "submit" : "neutral"} size="large" disabled={props.sending} onClick={next}>
                {last() ? "Submit" : "Next"}
              </Button>
            </div>
          </>
        }
      >
        <div data-slot="question-text">{question()?.question}</div>
        <Show when={(question()?.options.length ?? 0) > 0}>
          <div data-slot="question-hint">{question()?.multiple ? "Select all that apply" : "Select one answer"}</div>
        </Show>
        <div data-slot="question-options">
          <For each={question()?.options ?? []}>
            {(option) => (
              <button
                type="button"
                data-slot="question-option"
                data-picked={picked(option.value)}
                role={question()?.multiple ? "checkbox" : "radio"}
                aria-checked={picked(option.value)}
                disabled={props.sending}
                onClick={() => pick(option.value)}
              >
                <Mark multi={!!question()?.multiple} picked={picked(option.value)} />
                <span data-slot="question-option-main">
                  <span data-slot="option-label">{option.label}</span>
                  <Show when={option.description}>
                    <span data-slot="option-description">{option.description}</span>
                  </Show>
                </span>
              </button>
            )}
          </For>
          <Show when={question()?.custom}>
            <label
              data-slot="question-option"
              data-custom="true"
              data-picked={customOn()}
              role={question()?.multiple ? "checkbox" : "radio"}
              aria-checked={customOn()}
            >
              <Mark multi={!!question()?.multiple} picked={customOn()} />
              <span data-slot="question-option-main">
                <span data-slot="option-label">Type your own answer</span>
                <textarea
                  data-slot="question-custom-input"
                  dir="auto"
                  rows={1}
                  placeholder={placeholder()}
                  value={customText()}
                  disabled={props.sending}
                  class="[field-sizing:content]"
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    setStore("custom", store.tab, value)
                    setStore("customOn", store.tab, !!value.trim())
                    if (value.trim() && !question()?.multiple) setStore("answers", store.tab, [])
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return
                    event.preventDefault()
                    next()
                  }}
                />
              </span>
            </label>
          </Show>
        </div>
      </DockPrompt>
    </div>
  )
}

/** A form the side panel cannot render; the agent waits until it is answered elsewhere or dismissed. */
export function UnsupportedFormDock(props: { request: FormInfo; sending: boolean; onDismiss: () => void }) {
  return (
    <DockPrompt
      kind="question"
      header={<div data-slot="question-header-title">{props.request.title}</div>}
      footer={
        <>
          <Button variant="ghost" size="large" disabled={props.sending} onClick={props.onDismiss}>
            Dismiss
          </Button>
          <div />
        </>
      }
    >
      <div data-slot="question-text">
        The agent is waiting for an answer. Open this session in the opencode app to respond.
      </div>
    </DockPrompt>
  )
}

function Mark(props: { multi: boolean; picked: boolean }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true">
      <span data-slot="question-option-box" data-type={props.multi ? "checkbox" : "radio"} data-picked={props.picked}>
        <Show when={props.multi} fallback={<span data-slot="question-option-radio-dot" />}>
          <Icon name="check-small" size="small" />
        </Show>
      </span>
    </span>
  )
}
