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
  const single = createMemo(() => questions().length === 1 && questions()[0]?.multiple !== true)

  const [store, setStore] = createStore({
    tab: 0,
    answers: [] as QuestionAnswer[],
    custom: [] as string[],
    editing: false,
    sending: false,
  })

  const question = createMemo(() => questions()[store.tab])
  const confirm = createMemo(() => !single() && store.tab === questions().length)
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const multi = createMemo(() => question()?.multiple === true)
  const customPicked = createMemo(() => {
    const value = input()
    if (!value) return false
    return store.answers[store.tab]?.includes(value) ?? false
  })

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  const reply = (answers: QuestionAnswer[]) => {
    if (store.sending) return

    setStore("sending", true)
    sdk.client.question
      .reply({ requestID: props.request.id, answers })
      .catch(fail)
      .finally(() => setStore("sending", false))
  }

  const reject = () => {
    if (store.sending) return

    setStore("sending", true)
    sdk.client.question
      .reject({ requestID: props.request.id })
      .catch(fail)
      .finally(() => setStore("sending", false))
  }

  const submit = () => {
    reply(questions().map((_, i) => store.answers[i] ?? []))
  }

  const pick = (answer: string, custom: boolean = false) => {
    const answers = [...store.answers]
    answers[store.tab] = [answer]
    setStore("answers", answers)

    if (custom) {
      const inputs = [...store.custom]
      inputs[store.tab] = answer
      setStore("custom", inputs)
    }

    if (single()) {
      reply([[answer]])
      return
    }

    setStore("tab", store.tab + 1)
  }

  const toggle = (answer: string) => {
    const existing = store.answers[store.tab] ?? []
    const next = [...existing]
    const index = next.indexOf(answer)
    if (index === -1) next.push(answer)
    if (index !== -1) next.splice(index, 1)

    const answers = [...store.answers]
    answers[store.tab] = next
    setStore("answers", answers)
  }

  const selectTab = (index: number) => {
    setStore("tab", index)
    setStore("editing", false)
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

  const handleCustomSubmit = (e: Event) => {
    e.preventDefault()
    if (store.sending) return

    const value = input().trim()
    if (!value) {
      setStore("editing", false)
      return
    }

    if (multi()) {
      const existing = store.answers[store.tab] ?? []
      const next = [...existing]
      if (!next.includes(value)) next.push(value)

      const answers = [...store.answers]
      answers[store.tab] = next
      setStore("answers", answers)
      setStore("editing", false)
      return
    }

    pick(value, true)
    setStore("editing", false)
  }

  return (
    <div data-component="question-prompt">
      <Show when={!single()}>
        <div data-slot="question-tabs">
          <For each={questions()}>
            {(q, index) => {
              const active = () => index() === store.tab
              const answered = () => (store.answers[index()]?.length ?? 0) > 0
              return (
                <button
                  data-slot="question-tab"
                  data-active={active()}
                  data-answered={answered()}
                  disabled={store.sending}
                  onClick={() => selectTab(index())}
                >
                  {q.header}
                </button>
              )
            }}
          </For>
          <button
            data-slot="question-tab"
            data-active={confirm()}
            disabled={store.sending}
            onClick={() => selectTab(questions().length)}
          >
            {language.t("ui.common.confirm")}
          </button>
        </div>
      </Show>

      <Show when={!confirm()}>
        <div data-slot="question-content">
          <div data-slot="question-text">
            {question()?.question}
            {multi() ? " " + language.t("ui.question.multiHint") : ""}
          </div>
          <div data-slot="question-options">
            <For each={options()}>
              {(opt, i) => {
                const picked = () => store.answers[store.tab]?.includes(opt.label) ?? false
                return (
                  <button
                    data-slot="question-option"
                    data-picked={picked()}
                    disabled={store.sending}
                    onClick={() => selectOption(i())}
                  >
                    <span data-slot="option-label">{opt.label}</span>
                    <Show when={opt.description}>
                      <span data-slot="option-description">{opt.description}</span>
                    </Show>
                    <Show when={picked()}>
                      <Icon name="check-small" size="normal" />
                    </Show>
                  </button>
                )
              }}
            </For>
            <button
              data-slot="question-option"
              data-picked={customPicked()}
              disabled={store.sending}
              onClick={() => selectOption(options().length)}
            >
              <span data-slot="option-label">{language.t("ui.messagePart.option.typeOwnAnswer")}</span>
              <Show when={!store.editing && input()}>
                <span data-slot="option-description">{input()}</span>
              </Show>
              <Show when={customPicked()}>
                <Icon name="check-small" size="normal" />
              </Show>
            </button>
            <Show when={store.editing}>
              <form data-slot="custom-input-form" onSubmit={handleCustomSubmit}>
                <input
                  ref={(el) => setTimeout(() => el.focus(), 0)}
                  type="text"
                  data-slot="custom-input"
                  placeholder={language.t("ui.question.custom.placeholder")}
                  value={input()}
                  disabled={store.sending}
                  onInput={(e) => {
                    const inputs = [...store.custom]
                    inputs[store.tab] = e.currentTarget.value
                    setStore("custom", inputs)
                  }}
                />
                <Button type="submit" variant="primary" size="small" disabled={store.sending}>
                  {multi() ? language.t("ui.common.add") : language.t("ui.common.submit")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  disabled={store.sending}
                  onClick={() => setStore("editing", false)}
                >
                  {language.t("ui.common.cancel")}
                </Button>
              </form>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={confirm()}>
        <div data-slot="question-review">
          <div data-slot="review-title">{language.t("ui.messagePart.review.title")}</div>
          <For each={questions()}>
            {(q, index) => {
              const value = () => store.answers[index()]?.join(", ") ?? ""
              const answered = () => Boolean(value())
              return (
                <div data-slot="review-item">
                  <span data-slot="review-label">{q.question}</span>
                  <span data-slot="review-value" data-answered={answered()}>
                    {answered() ? value() : language.t("ui.question.review.notAnswered")}
                  </span>
                </div>
              )
            }}
          </For>
        </div>
      </Show>

      <div data-slot="question-actions">
        <Button variant="ghost" size="small" onClick={reject} disabled={store.sending}>
          {language.t("ui.common.dismiss")}
        </Button>
        <Show when={!single()}>
          <Show when={confirm()}>
            <Button variant="primary" size="small" onClick={submit} disabled={store.sending}>
              {language.t("ui.common.submit")}
            </Button>
          </Show>
          <Show when={!confirm() && multi()}>
            <Button
              variant="secondary"
              size="small"
              onClick={() => selectTab(store.tab + 1)}
              disabled={store.sending || (store.answers[store.tab]?.length ?? 0) === 0}
            >
              {language.t("ui.common.next")}
            </Button>
          </Show>
        </Show>
      </div>
    </div>
  )
}
