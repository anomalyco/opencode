import { For, Show, createMemo, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import type { QuestionAnswer, QuestionRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"

export const QuestionDock: Component<{ request: QuestionRequest }> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()

  const questions = createMemo(() => props.request.questions)
  const total = createMemo(() => questions().length)

  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    editing: false,
    sending: false,
  })

  const question = createMemo(() => questions()[store.tab])
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const answered = createMemo(() => (store.answers[store.tab]?.length ?? 0) > 0)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  const summary = createMemo(() => {
    const n = Math.min(store.tab + 1, total())
    return `${n} of ${total()} questions`
  })

  const last = createMemo(() => store.tab >= total() - 1)

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const reply = async (answers: QuestionAnswer[]) => {
    if (store.sending) return

    setStore("sending", true)
    try {
      await sdk.client.question.reply({ requestID: props.request.id, answers })
    } catch (err) {
      fail(err)
    } finally {
      setStore("sending", false)
    }
  }

  const reject = async () => {
    if (store.sending) return

    setStore("sending", true)
    try {
      await sdk.client.question.reject({ requestID: props.request.id })
    } catch (err) {
      fail(err)
    } finally {
      setStore("sending", false)
    }
  }

  const submit = () => void reply(questions().map((_, i) => store.answers[i] ?? []))

  const pick = (answer: string, custom: boolean = false) => {
    setStore("answers", store.tab, [answer])
    if (custom) setStore("custom", store.tab, answer)
  }

  const toggle = (answer: string) => {
    setStore("answers", store.tab, (current = []) => {
      if (current.includes(answer)) return current.filter((item) => item !== answer)
      return [...current, answer]
    })
  }

  const selectOption = (optIndex: number) => {
    if (store.sending) return

    if (optIndex === options().length) {
      setStore("editing", true)
      return
    }

    const opt = options()[optIndex]
    if (!opt) return
    if (multi()) {
      toggle(opt.label)
      return
    }
    pick(opt.label)
  }

  const commitCustom = () => {
    const value = input().trim()
    if (!value) {
      setStore("editing", false)
      return
    }

    if (multi()) {
      setStore("answers", store.tab, (current = []) => {
        if (current.includes(value)) return current
        return [...current, value]
      })
      setStore("editing", false)
      return
    }

    pick(value, true)
    setStore("editing", false)
  }

  const next = () => {
    if (store.sending) return
    if (store.editing) commitCustom()

    if (store.tab >= total() - 1) {
      submit()
      return
    }

    setStore("tab", store.tab + 1)
    setStore("editing", false)
  }

  const back = () => {
    if (store.sending) return
    if (store.tab <= 0) return
    setStore("tab", store.tab - 1)
    setStore("editing", false)
  }

  return (
    <div data-component="question-prompt">
      <div data-slot="question-body">
        <div data-slot="question-header">
          <div data-slot="question-header-title">{summary()}</div>
          <div data-slot="question-progress" aria-hidden="true">
            <For each={questions()}>
              {(_, i) => (
                <span
                  data-slot="question-progress-segment"
                  data-active={i() === store.tab}
                  data-answered={(store.answers[i()]?.length ?? 0) > 0}
                />
              )}
            </For>
          </div>
        </div>

        <div data-slot="question-content">
          <div data-slot="question-text">{question()?.question}</div>
          <Show when={multi()} fallback={<div data-slot="question-hint">{language.t("ui.question.singleHint")}</div>}>
            <div data-slot="question-hint">{language.t("ui.question.multiHint")}</div>
          </Show>
          <div data-slot="question-options">
            <For each={options()}>
              {(opt, i) => {
                const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                return (
                  <button
                    data-slot="question-option"
                    data-picked={picked()}
                    role={multi() ? "checkbox" : "radio"}
                    aria-checked={picked()}
                    disabled={store.sending}
                    onClick={() => selectOption(i())}
                  >
                    <span data-slot="question-option-check" aria-hidden="true">
                      <span
                        data-slot="question-option-box"
                        data-type={multi() ? "checkbox" : "radio"}
                        data-picked={picked()}
                      >
                        <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                          <Icon name="check-small" size="small" />
                        </Show>
                      </span>
                    </span>
                    <span data-slot="question-option-main">
                      <span data-slot="option-label">{opt.label}</span>
                      <Show when={opt.description}>
                        <span data-slot="option-description">{opt.description}</span>
                      </Show>
                    </span>
                  </button>
                )
              }}
            </For>

            <div data-slot="question-custom">
              <button
                data-slot="question-option"
                data-picked={customPicked()}
                role={multi() ? "checkbox" : "radio"}
                aria-checked={customPicked()}
                disabled={store.sending}
                onClick={() => selectOption(options().length)}
              >
                <span data-slot="question-option-check" aria-hidden="true">
                  <span
                    data-slot="question-option-box"
                    data-type={multi() ? "checkbox" : "radio"}
                    data-picked={customPicked()}
                  >
                    <Show when={multi()} fallback={<span data-slot="question-option-radio-dot" />}>
                      <Icon name="check-small" size="small" />
                    </Show>
                  </span>
                </span>
                <span data-slot="question-option-main">
                  <span data-slot="option-label">{language.t("ui.messagePart.option.typeOwnAnswer")}</span>
                  <Show when={!store.editing}>
                    <span data-slot="option-description">
                      {input() || language.t("ui.question.custom.placeholder")}
                    </span>
                  </Show>
                </span>
              </button>
              <Show when={store.editing}>
                <div data-slot="question-custom-input-wrap">
                  <input
                    ref={(el) => setTimeout(() => el.focus(), 0)}
                    type="text"
                    data-slot="question-custom-input"
                    placeholder={language.t("ui.question.custom.placeholder")}
                    value={input()}
                    disabled={store.sending}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setStore("editing", false)
                        return
                      }
                      if (e.key !== "Enter") return
                      e.preventDefault()
                      commitCustom()
                    }}
                    onInput={(e) => {
                      setStore("custom", store.tab, e.currentTarget.value)
                    }}
                  />
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>

      <div data-slot="question-footer">
        <Button variant="ghost" size="large" disabled={store.sending} onClick={reject}>
          {language.t("ui.common.dismiss")}
        </Button>
        <div data-slot="question-footer-actions">
          <Show when={store.tab > 0}>
            <Button variant="secondary" size="large" disabled={store.sending} onClick={back}>
              {language.t("ui.common.back")}
            </Button>
          </Show>
          <Button variant={last() ? "primary" : "secondary"} size="large" disabled={store.sending} onClick={next}>
            {last() ? language.t("ui.common.submit") : language.t("ui.common.next")}
          </Button>
        </div>
      </div>
    </div>
  )
}
