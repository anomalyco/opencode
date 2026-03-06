import { For, Index, Show } from "solid-js"
import { useI18n } from "../../context/i18n"
import { Icon } from "../icon"

interface Option {
  label: string
  description?: string
}

interface Base {
  text?: string
  options?: Option[]
  index?: number
  total?: number
  multi?: boolean
  answered?: boolean[]
}

interface BodyProps extends Base {
  selected: string[]
  custom: string
  customOn: boolean
  busy?: boolean
  onToggle: (label: string) => void
  onCustomOn: (value: boolean) => void
  onCustom: (value: string) => void
  onJump?: (index: number) => void
}

function Header(props: Base & { onJump?: (index: number) => void; click?: boolean }) {
  const i18n = useI18n()
  const tab = () => props.index ?? 0
  const done = (i: number) => {
    if (props.answered) return props.answered[i] === true
    return i < tab()
  }

  return (
    <Show when={(props.total ?? 0) > 0}>
      <div data-slot="question-header">
        <div data-slot="question-header-title">
          {i18n.t("ui.question.progress", { index: tab() + 1, total: props.total ?? 0 })}
        </div>
        <div data-slot="question-progress">
          <Index each={Array.from({ length: props.total ?? 0 })}>
            {(_, i) => (
              <Show
                when={props.click}
                fallback={
                  <span data-slot="question-progress-segment" data-active={i === tab()} data-answered={done(i)} />
                }
              >
                <button
                  type="button"
                  data-slot="question-progress-segment"
                  data-active={i === tab()}
                  data-answered={done(i)}
                  onClick={() => props.onJump?.(i)}
                />
              </Show>
            )}
          </Index>
        </div>
      </div>
    </Show>
  )
}

export function QuestionBody(props: BodyProps) {
  const i18n = useI18n()
  const multi = () => props.multi ?? false
  const selected = (label: string) => props.selected.includes(label)
  const customPicked = () => {
    if (props.customOn) return true
    if (!multi()) return false
    const text = props.custom.trim()
    if (!text) return false
    return props.selected.some((item) => item.trim() === text)
  }

  return (
    <>
      <Header index={props.index} total={props.total} answered={props.answered} onJump={props.onJump} click />
      <div data-slot="question-content">
        <div data-slot="question-text">{props.text}</div>
        <Show when={multi()} fallback={<div data-slot="question-hint">{i18n.t("ui.question.singleHint")}</div>}>
          <div data-slot="question-hint">{i18n.t("ui.question.multiHint")}</div>
        </Show>
        <div data-slot="question-options" style={{ "padding-bottom": "8px" }}>
          <For each={props.options}>
            {(opt) => {
              const picked = () => selected(opt.label)
              return (
                <button
                  data-slot="question-option"
                  data-picked={picked()}
                  onClick={() => props.onToggle(opt.label)}
                  disabled={props.busy}
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

          <form
            data-slot="question-option"
            data-custom="true"
            data-picked={customPicked()}
            onMouseDown={(event) => {
              if (event.target instanceof HTMLTextAreaElement) return
              const input = event.currentTarget.querySelector('[data-slot="question-custom-input"]')
              if (input instanceof HTMLTextAreaElement) input.focus()
            }}
            onSubmit={(event) => event.preventDefault()}
          >
            <span
              data-slot="question-option-check"
              aria-hidden="true"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                const next = multi() ? !props.customOn : true
                props.onCustomOn(next)

                const form = event.currentTarget.closest("form")
                const input = form?.querySelector('[data-slot="question-custom-input"]')
                if (!(input instanceof HTMLTextAreaElement)) return
                if (!next) {
                  input.blur()
                  return
                }
                input.focus()
              }}
            >
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
              <span data-slot="option-label">{i18n.t("ui.messagePart.option.typeOwnAnswer")}</span>
              <textarea
                data-slot="question-custom-input"
                placeholder={i18n.t("ui.question.custom.placeholder")}
                value={props.custom}
                disabled={props.busy}
                onFocus={() => props.onCustomOn(true)}
                onInput={(event) => {
                  const value = event.currentTarget.value
                  props.onCustom(value)
                  props.onCustomOn(value.trim().length > 0)
                }}
                rows={1}
              />
            </span>
          </form>
        </div>
      </div>
    </>
  )
}

export function QuestionSizer(props: Base) {
  const i18n = useI18n()
  return (
    <>
      <Header index={props.index} total={props.total} answered={props.answered} />
      <div data-slot="question-content">
        <div data-slot="question-text">{props.text}</div>
        <div data-slot="question-hint">
          {props.multi ? i18n.t("ui.question.multiHint") : i18n.t("ui.question.singleHint")}
        </div>
        <div data-slot="question-options" style={{ overflow: "hidden", "padding-bottom": "8px" }}>
          <For each={props.options}>
            {(opt) => (
              <div data-slot="question-option" style={{ "pointer-events": "none" }}>
                <span data-slot="question-option-main">
                  <span data-slot="option-label">{opt.label}</span>
                  <Show when={opt.description}>
                    <span data-slot="option-description">{opt.description}</span>
                  </Show>
                </span>
              </div>
            )}
          </For>
          <div data-slot="question-option" style={{ "pointer-events": "none" }}>
            <span data-slot="question-option-main">
              <span data-slot="option-label">{i18n.t("ui.messagePart.option.typeOwnAnswer")}</span>
              <span data-slot="option-description">{i18n.t("ui.question.custom.placeholder")}</span>
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
