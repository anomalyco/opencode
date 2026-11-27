import { For, Show, createEffect, createMemo, createUniqueId, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { LinkedText } from "@opencode/session-ui/linked-text"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { useSpring } from "@opencode/ui/motion-spring"
import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import type { FormInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useCommand } from "@/shell/commands/command"
import { useServerSDK } from "@/runtime/server/client"
import { createQuestionDock } from "./question-controller"
import type { QuestionSendAction } from "./question-machine"
import "./question-answer-composer.css"
import { questionEnter, type QuestionSubmitKey } from "./question-keys"
import { fitCustomAnswer, questionSubmitShortcuts } from "./question-submit"
import { useSettings } from "@/settings/model"

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

function Mark(props: { multi: boolean; picked: boolean }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true">
      <span data-slot="question-option-box" data-type={props.multi ? "checkbox" : "radio"} data-picked={props.picked}>
        <Show when={props.multi} fallback={<span data-slot="question-option-radio-dot" />}>
          <Icon name="check" size="normal" />
        </Show>
      </span>
    </span>
  )
}

function Option(props: {
  id?: string
  active?: boolean
  multi: boolean
  picked: boolean
  label: string
  description?: string
  number: number
  disabled: boolean
  submit: QuestionSubmitKey
  ref?: (el: HTMLDivElement) => void
  onFocus?: VoidFunction
  onClick: VoidFunction
  onCommit: VoidFunction
}) {
  let pointer: { x: number; y: number } | undefined

  return (
    <div
      ref={props.ref}
      id={props.id}
      data-slot="question-option"
      data-active={props.active || undefined}
      data-picked={props.picked}
      data-disabled={props.disabled}
      role={props.id ? "option" : props.multi ? "checkbox" : "radio"}
      aria-selected={props.id ? props.picked : undefined}
      aria-checked={props.id ? undefined : props.picked}
      aria-keyshortcuts={props.number <= 9 ? String(props.number) : undefined}
      aria-disabled={props.disabled}
      tabindex={props.id ? undefined : props.disabled ? -1 : 0}
      onFocus={props.onFocus}
      onPointerDown={(event) => (pointer = { x: event.clientX, y: event.clientY })}
      onClick={(event) => {
        const moved = pointer && (event.clientX !== pointer.x || event.clientY !== pointer.y)

        pointer = undefined

        if (props.disabled) return

        const selection = window.getSelection()

        // Padding and nonselectable marks can retain an old highlight without selecting text.
        if (
          event.detail > 0 &&
          (moved || event.shiftKey) &&
          !(event.target instanceof Element && event.target.closest('[data-slot="question-option-check"]')) &&
          selection &&
          !selection.isCollapsed &&
          selection.getRangeAt(0).intersectsNode(event.currentTarget)
        )
          return

        props.onClick()
      }}
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return

        const enter = questionEnter(event, props.submit)

        if (event.key !== " " && !enter) return
        event.preventDefault()

        if (event.repeat || props.disabled) return

        if (enter === "submit") return props.onCommit()

        props.onClick()
      }}
    >
      <Mark multi={props.multi} picked={props.picked} />
      <span data-slot="question-option-main">
        <span data-slot="option-label">
          <bdi>{props.label}</bdi>
        </span>
        <Show when={props.description}>
          <span data-slot="option-description">
            <bdi>{props.description}</bdi>
          </span>
        </Show>
      </span>
      <Show when={props.number <= 9}>
        <Keybind
          keys={[String(props.number)]}
          variant={props.picked ? "outline" : "neutral"}
          data-slot="question-option-shortcut"
          aria-hidden="true"
        />
      </Show>
    </div>
  )
}

export const SessionQuestionDockClassic: Component<{
  request: FormInfo
  onSubmit?: () => void
  // Answers from the composer: preset answers above, a custom answer field with the actions below.
  composer?: boolean
  respond?: (action: QuestionSendAction) => void
}> = (props) => {
  const language = useLanguage()
  const command = useCommand()
  const settings = useSettings()
  const submitKey = settings.general.questionSubmitKey

  const form = createQuestionDock({
    ...(props.respond ? { respond: props.respond } : { sdk: useServerSDK() }),
    language,
    request: () => props.request,
    onSubmit: () => props.onSubmit?.(),
  })

  const questions = form.questions

  const total = createMemo(() => questions().length)

  const [store, setStore] = createStore({
    editing: false,
    // The answer the composer's arrow keys or the pointer highlight; focus stays in the composer.
    // SAFETY: widens the initial undefined to the type of a highlighted answer's index.
    activeOption: undefined as number | undefined,
    keyboard: false,
    reducedMotion: prefersReducedMotion(),
    focus: 0,
    minimized: false,
    optionsHeight: 180,
  })

  onCleanup(observeReducedMotion(() => setStore("reducedMotion", prefersReducedMotion())))

  let root: HTMLDivElement | undefined
  let detailsRef: HTMLDivElement | undefined
  let optionsRef: HTMLDivElement | undefined
  let customRef: HTMLButtonElement | undefined
  let customInput: HTMLTextAreaElement | undefined
  let optsRef: HTMLDivElement[] = []
  let focusFrame: number | undefined

  const question = createMemo(() => questions()[form.tab()])
  const options = createMemo(() => question()?.options ?? [])
  const input = () => form.draft(form.tab()).customText
  const on = () => form.draft(form.tab()).customSelected
  const multi = createMemo(() => question()?.multiple === true)
  const count = createMemo(() => options().length + (props.composer ? 0 : 1))

  const summary = createMemo(() => {
    if (total() === 1) return language.t("session.question.title")
    const n = Math.min(form.tab() + 1, total())

    return language.t("session.question.progress", { current: n, total: total() })
  })

  const customLabel = () => language.t("ui.question.custom.answerPlaceholder")

  const answerLabel = () => (props.composer ? language.t("ui.question.custom.placeholder") : customLabel())

  const activeOption = () => store.activeOption

  const setActiveOption = (index: number | undefined) => setStore("activeOption", index)

  const listID = createUniqueId()

  const questionID = `${listID}-question`

  const optionID = (index: number) => `${listID}-${form.tab()}-${index}`

  const activeDescendant = () => {
    const index = activeOption()

    return index === undefined ? undefined : optionID(index)
  }

  const last = createMemo(() => form.tab() >= total() - 1)

  const showSendButton = () => !!props.composer && last()

  const advanceLabel = () =>
    language.t(showSendButton() ? "ui.promptInput.send" : last() ? "ui.common.submit" : "ui.common.next")

  const collapse = useSpring(
    () => (store.minimized ? 1 : 0),
    { visualDuration: 0.3, bounce: 0 },
    () => (store.reducedMotion || store.keyboard ? store.minimized : undefined),
  )

  const hidden = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const optionsOff = createMemo(() => hidden() > 0.98)

  const measure = () => {
    if (!root) return

    if (customInput) fitCustomAnswer(customInput)

    const scroller = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined

    const top =
      head instanceof HTMLElement && head.classList.contains("sticky")
        ? head.getBoundingClientRect().bottom
        : scroller instanceof HTMLElement
          ? scroller.getBoundingClientRect().top
          : 0

    const dock = root.closest('[data-component="session-composer-dock"]')
    // In the app this row can have zero height and overflow upward; the containing panel bounds the question.
    const column = bounds(dock?.parentElement)
    const parent = dock?.parentElement?.getBoundingClientRect()
    const edge = parent && parent.width > 0 ? parent.bottom : Infinity
    const view = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : Infinity
    const bottom = Math.min(window.innerHeight, view, column?.bottom ?? Infinity, edge)

    const around =
      dock instanceof HTMLElement
        ? Math.max(0, dock.getBoundingClientRect().height - root.getBoundingClientRect().height)
        : 0

    const gap = 8
    const max = Math.max(240, Math.floor(bottom - Math.max(0, top, column?.top ?? 0) - around - gap))
    root.style.setProperty("--question-prompt-max-height", `${max}px`)
  }

  const clamp = (i: number) => Math.max(0, Math.min(count() - 1, i))

  const pickFocus = (tab: number = form.tab()) => {
    const list = questions()[tab]?.options ?? []
    const draft = form.draft(tab)

    if (draft.customSelected) return list.length

    return Math.max(
      0,
      list.findIndex((item) => draft.selected.includes(item.value)),
    )
  }

  const reveal = (row: HTMLElement | null | undefined) => {
    if (!row || !optionsRef) return
    optionsRef.scrollTop = Math.min(
      row.offsetTop,
      Math.max(optionsRef.scrollTop, row.offsetTop + row.offsetHeight - optionsRef.clientHeight),
    )
  }

  const highlight = (index: number) => {
    setActiveOption(index)
    reveal(optsRef[index])
  }

  const focusField = () => {
    if (!matchMedia("(pointer: coarse)").matches) customInput?.focus({ preventScroll: true })
  }

  // The answer the list highlights when it takes focus: the first picked one, or the first.
  const restingOption = () =>
    Math.max(
      0,
      options().findIndex((item) => picked(item.value)),
    )

  // Where a question starts: on its answers, or in the field when it has none or already holds a typed answer.
  const land = () => {
    setActiveOption(undefined)

    if (options().length === 0 || (on() && input())) return focusField()
    optionsRef?.focus({ preventScroll: true })
    highlight(restingOption())
  }

  // The arrow keys and End land in the custom answer's field rather than on its toggle, so the answer is typed at once.
  const focus = (i: number, field = false) => {
    const next = clamp(i)
    setStore("focus", next)

    if (store.editing) return

    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      const custom = field ? customInput : customRef
      const el = next === options().length ? custom : optsRef[next]
      el?.focus({ preventScroll: true })
      reveal(el?.closest<HTMLElement>('[data-slot="question-option"]'))
    })
  }

  onMount(() => {
    let raf: number | undefined

    const update = () => {
      if (raf !== undefined) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = undefined
        measure()
      })
    }

    measure()
    makeEventListener(window, "resize", update)

    if (window.visualViewport) {
      makeEventListener(window.visualViewport, "resize", update)
      makeEventListener(window.visualViewport, "scroll", update)
    }

    const dock = root?.closest('[data-component="session-composer-dock"]')
    const scroller = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    createResizeObserver([dock, scroller, customInput], update)

    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    })

    if (props.composer) return land()

    focus(pickFocus())
  })

  createEffect(() => {
    const el = optionsRef

    if (!el) return
    const update = () => setStore("optionsHeight", (height) => Math.max(height, el.scrollHeight))
    update()
    createResizeObserver(el, update)
  })

  onCleanup(() => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  })

  // The custom answer's field fits its text as it is typed and when another question's answer shows in it.
  createEffect(() => {
    input()

    if (customInput) fitCustomAnswer(customInput)
  })

  const sending = form.busy
  const shortcuts = createMemo(() => questionSubmitShortcuts(submitKey(), IS_MAC, language.t("common.key.ctrl")))
  const backShortcut = () => (IS_MAC ? "⌘[" : `${language.t("common.key.alt")}+←`)

  const reject = form.dismiss

  const picked = (answer: string) => form.draft(form.tab()).selected.includes(answer)

  const customToggle = () => {
    if (sending()) return
    setStore("focus", options().length)

    if (props.composer || !multi() || !on()) {
      form.selectCustom()
      setStore("editing", true)
      customInput?.focus()

      return
    }

    form.deselectCustom()
    setStore("editing", false)
    focus(options().length)
  }

  const move = (step: number) => {
    if (store.editing || sending()) return
    focus(store.focus + step, true)
  }

  // Keys on the answer list, which keeps focus while the highlight moves. Typing a custom answer needs the field.
  const listKeys = (event: KeyboardEvent) => {
    if (sending() || event.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey)
      return

    const size = options().length

    const active = activeOption()

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()

      const step = event.key === "ArrowDown" ? 1 : -1

      if (active === undefined) return highlight(step > 0 ? 0 : size - 1)

      // Down from the last answer goes on to the field; Up from the first wraps to the last.
      if (active + step === size) {
        setActiveOption(undefined)

        return customInput?.focus({ preventScroll: true })
      }

      highlight(active + step < 0 ? size - 1 : active + step)

      return
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault()
      highlight(event.key === "Home" ? 0 : size - 1)

      return
    }

    const enter = questionEnter(event, submitKey())

    if (enter === "submit") {
      event.preventDefault()

      if (!event.repeat) enterAnswer()

      return
    }

    const index =
      event.key === " " || enter === "select" ? active : /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : undefined

    if (index === undefined || index >= size) return
    event.preventDefault()

    if (event.repeat) return
    selectOption(index)
  }

  const nav = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return

    if (event.key === "Escape") {
      event.preventDefault()
      reject()

      return
    }

    const previous = IS_MAC
      ? event.metaKey && !event.ctrlKey && !event.altKey && event.key === "["
      : event.altKey && !event.ctrlKey && !event.metaKey && event.key === "ArrowLeft"

    if (previous) {
      if (event.repeat) return
      event.preventDefault()
      back()

      return
    }

    const mod = (event.metaKey || event.ctrlKey) && !event.altKey

    if (mod && event.key === "Enter") {
      if (event.repeat) return
      event.preventDefault()
      enterAnswer()

      return
    }

    const target =
      event.target instanceof HTMLElement ? event.target.closest('[data-slot="question-options"]') : undefined

    if (store.editing || event.target === customInput) return

    if (event.altKey || event.ctrlKey || event.metaKey) return

    if (/^[1-9]$/.test(event.key)) {
      if (event.repeat || store.minimized || sending()) return
      const index = Number(event.key) - 1

      if (index >= count()) return
      event.preventDefault()

      if (index === options().length) {
        customToggle()

        return
      }

      selectOption(index)
      focus(index)

      return
    }

    if (!(target instanceof HTMLElement)) return

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault()
      move(1)

      return
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault()
      move(-1)

      return
    }

    if (event.key === "Home") {
      event.preventDefault()
      focus(0)

      return
    }

    if (event.key !== "End") return
    event.preventDefault()
    focus(count() - 1, true)
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return
    const opt = options()[optIndex]

    if (!opt) return
    setStore("editing", false)
    form.pick(opt.value)

    if (props.composer) highlight(optIndex)
  }

  const commitCustom = () => {
    setStore("editing", false)
    focus(options().length)
  }

  // The submit key on an answer picks it first on a single-choice question; on a multiple-choice one, it moves on with
  // the answers already marked.
  const commit = (optIndex: number) => {
    if (sending()) return

    if (!multi()) selectOption(optIndex)
    next()
  }

  // The submit key on the custom answer's toggle opens its field while it is still empty on a single-choice question,
  // since there is nothing to pick yet.
  const commitCustomToggle = () => {
    if (sending()) return

    if (multi()) return next()

    if (!input().trim()) return customToggle()
    form.selectCustom()
    next()
  }

  const answerFieldFocused = () => !!props.composer && document.activeElement === customInput

  const enterAnswer = () => {
    const active = activeOption()

    if (active !== undefined) return commit(active)
    next()
  }

  const next = () => {
    if (sending()) return

    if (store.editing && !props.composer) commitCustom()

    if (form.tab() >= total() - 1) {
      form.reply()

      return
    }

    const tab = form.tab() + 1

    const focusFirst = answerFieldFocused() && questions()[tab]?.options.length

    jump(tab, focusFirst ? 0 : undefined)
  }

  const back = () => {
    if (sending() || form.tab() <= 0) return
    jump(form.tab() - 1)
  }

  const jump = (tab: number, focusIndex?: number) => {
    if (sending() || tab === form.tab()) return
    const keepAnswerFocus = focusIndex === undefined && answerFieldFocused()

    setActiveOption(undefined)
    form.selectTab(tab)
    setStore("editing", keepAnswerFocus)

    if (detailsRef) detailsRef.scrollTop = 0

    if (optionsRef) {
      optionsRef.scrollTop = 0
      setStore("optionsHeight", optionsRef.scrollHeight)
    }

    if (props.composer) return land()

    if (!store.minimized && !keepAnswerFocus) focus(focusIndex ?? pickFocus(tab))
  }

  command.register("session.question.back", () => [
    {
      id: "session.question.back",
      title: language.t("ui.common.back"),
      keybind: IS_MAC ? "mod+[" : "alt+arrowleft",
      hidden: true,
      // Stay registered while sending so the shortcut does not fall through to history navigation.
      disabled: form.tab() <= 0,
      when: () => form.tab() > 0,
      onSelect: back,
    },
  ])

  const minimize = () => {
    if (sending()) return

    if (optionsRef) setStore("optionsHeight", optionsRef.offsetHeight)
    setStore("editing", false)
    setStore("minimized", true)
  }

  const restore = () => {
    if (sending()) return
    setStore("minimized", false)
    focus(pickFocus())
  }

  const customField = () => (
    <textarea
      ref={(el) => (customInput = el)}
      class="question-custom-field"
      data-slot="question-custom-input"
      data-scrollable={props.composer || undefined}
      rows={1}
      dir="auto"
      aria-label={answerLabel()}
      aria-describedby={props.composer ? questionID : undefined}
      placeholder={answerLabel()}
      value={!props.composer || on() ? input() : ""}
      disabled={sending()}
      onFocus={() => {
        if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
        focusFrame = undefined
        setStore("focus", clamp(options().length))
        setStore("editing", true)
        setActiveOption(undefined)
      }}
      onClick={() => {
        if (!props.composer) form.selectCustom()
      }}
      onBlur={() => setStore("editing", false)}
      onKeyDown={(e) => {
        if (e.isComposing || e.keyCode === 229) return

        if (e.key === "Escape" && !props.composer) {
          e.preventDefault()
          setStore("editing", false)
          focus(options().length)

          return
        }

        if ((e.metaKey || e.ctrlKey) && !e.altKey) return

        // Up from the first line of the composer's field returns to the last answer.
        if (
          props.composer &&
          options().length > 0 &&
          e.key === "ArrowUp" &&
          !e.shiftKey &&
          !e.altKey &&
          e.currentTarget.selectionStart === e.currentTarget.selectionEnd &&
          caretOnFirstLine(e.currentTarget)
        ) {
          e.preventDefault()
          optionsRef?.focus({ preventScroll: true })
          highlight(options().length - 1)

          return
        }

        // Up from the start of the inline field returns to the answers above it.
        if (
          !props.composer &&
          e.key === "ArrowUp" &&
          !e.shiftKey &&
          !e.altKey &&
          e.currentTarget.selectionStart === 0 &&
          e.currentTarget.selectionEnd === 0
        ) {
          e.preventDefault()
          setStore("editing", false)
          focus(options().length - 1)

          return
        }

        // The other Enter starts a new line, as the field does by itself.
        if (questionEnter(e, submitKey()) !== "submit") return
        e.preventDefault()

        if (!e.repeat) next()
      }}
      onInput={(e) => form.input(e.currentTarget.value)}
    />
  )

  return (
    <div
      data-component="session-question-dock"
      data-keyboard={store.keyboard}
      data-composer={props.composer || undefined}
      onPointerDown={() => setStore("keyboard", false)}
      onKeyDown={() => setStore("keyboard", true)}
    >
      <DockPrompt
        kind="question"
        ref={(el) => (root = el)}
        onKeyDown={nav}
        header={
          <>
            <div data-slot="question-header-top">
              <Show when={!props.composer}>
                <div data-slot="question-header-title">
                  <bdi>{summary()}</bdi>
                </div>
              </Show>
              <div data-slot="question-header-actions">
                <Show when={total() > 1}>
                  <div data-slot="question-progress">
                    <For each={questions()}>
                      {(_, i) => (
                        <button
                          type="button"
                          data-slot="question-progress-segment"
                          data-active={i() === form.tab()}
                          data-answered={form.answered(i())}
                          disabled={sending()}
                          onClick={() => jump(i())}
                          aria-label={language.t("ui.tool.questions.numbered", { number: i() + 1 })}
                          aria-current={i() === form.tab() ? "step" : undefined}
                        >
                          <span data-slot="question-progress-bar" aria-hidden="true" />
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <div class="flex items-center">
                  <Show when={!props.composer}>
                    <IconButton
                      icon={<Icon name="chevron-down" size="normal" />}
                      variant="ghost"
                      size="large"
                      disabled={sending()}
                      style={{ transform: `rotate(${hidden() * 180}deg)` }}
                      onClick={store.minimized ? restore : minimize}
                      aria-label={language.t(
                        store.minimized ? "session.question.restore" : "session.question.minimize",
                      )}
                    />
                  </Show>
                  <Show when={props.composer}>
                    <Tooltip placement="top" value={language.t("ui.common.dismiss")}>
                      <IconButton
                        icon={<Icon name="close" size="normal" />}
                        variant="ghost"
                        size="large"
                        disabled={sending()}
                        onClick={reject}
                        aria-label={language.t("ui.common.dismiss")}
                        aria-keyshortcuts="Escape"
                      />
                    </Tooltip>
                  </Show>
                </div>
              </div>
            </div>
            <div
              data-slot="question-details"
              data-scrollable={!store.minimized || undefined}
              ref={(el) => (detailsRef = el)}
            >
              <div
                data-slot="question-text"
                id={props.composer ? questionID : undefined}
                style={{
                  display: store.minimized ? "-webkit-box" : undefined,
                  "-webkit-line-clamp": store.minimized ? "3" : undefined,
                  "-webkit-box-orient": store.minimized ? "vertical" : undefined,
                  overflow: store.minimized ? "hidden" : undefined,
                }}
              >
                <bdi>
                  <LinkedText text={question()?.question ?? ""} />
                </bdi>
              </div>
              <Show when={!props.composer && !store.minimized}>
                <div data-slot="question-hint">
                  {language.t(multi() ? "ui.question.classic.multiHint" : "ui.question.singleHint")}
                </div>
              </Show>
            </div>
          </>
        }
        footer={
          <>
            <Show when={props.composer}>{customField()}</Show>
            <Show when={!props.composer}>
              <Button variant="ghost" size="large" disabled={sending()} onClick={reject} aria-keyshortcuts="Escape">
                {language.t("ui.common.dismiss")}
              </Button>
            </Show>
            <div data-slot="question-footer-actions">
              <Show when={form.tab() > 0 && !props.composer}>
                <Tooltip
                  placement="top"
                  value={
                    <>
                      {language.t("ui.common.back")}
                      <span style={{ opacity: 0.6 }}>{backShortcut()}</span>
                    </>
                  }
                >
                  <Button
                    variant="neutral"
                    size="large"
                    disabled={sending()}
                    onClick={back}
                    aria-keyshortcuts={IS_MAC ? "Meta+[" : "Alt+ArrowLeft"}
                  >
                    {language.t("ui.common.back")}
                  </Button>
                </Tooltip>
              </Show>
              <Tooltip
                placement="top"
                value={
                  <>
                    {advanceLabel()}
                    <span style={{ opacity: 0.6 }}>{shortcuts().label}</span>
                  </>
                }
              >
                <Show
                  when={props.composer}
                  fallback={
                    <Button
                      variant={last() ? "contrast" : "neutral"}
                      size="large"
                      disabled={sending()}
                      onClick={next}
                      aria-label={advanceLabel()}
                      aria-keyshortcuts={shortcuts().aria}
                    >
                      <span data-slot="question-advance-labels" aria-hidden="true">
                        <span data-slot="question-advance-label" data-active={!last()}>
                          {language.t("ui.common.next")}
                        </span>
                        <span data-slot="question-advance-label" data-active={last()}>
                          {language.t("ui.common.submit")}
                        </span>
                      </span>
                    </Button>
                  }
                >
                  <IconButton
                    icon={<Icon name={showSendButton() ? "arrow-up" : "arrow-right"} />}
                    variant={showSendButton() ? "submit" : "neutral"}
                    size="large"
                    disabled={sending()}
                    onClick={next}
                    aria-label={advanceLabel()}
                    aria-keyshortcuts={shortcuts().aria}
                  />
                </Show>
              </Tooltip>
            </div>
          </>
        }
      >
        <div
          ref={(el) => (optionsRef = el)}
          id={props.composer && options().length > 0 ? listID : undefined}
          data-slot="question-options"
          data-browsing={activeOption() !== undefined || undefined}
          data-scrollable
          role={props.composer ? (options().length > 0 ? "listbox" : undefined) : multi() ? "group" : "radiogroup"}
          aria-multiselectable={props.composer && multi() ? true : undefined}
          aria-label={!props.composer || options().length > 0 ? question()?.question : undefined}
          aria-activedescendant={props.composer ? activeDescendant() : undefined}
          tabindex={props.composer && options().length > 0 ? 0 : undefined}
          onKeyDown={(event) => {
            if (props.composer) listKeys(event)
          }}
          onFocus={(event) => {
            if (props.composer && event.target === event.currentTarget && activeOption() === undefined)
              highlight(restingOption())
          }}
          onFocusOut={(event) => {
            const next = event.relatedTarget

            if (props.composer && !(next instanceof Node && event.currentTarget.contains(next)))
              setActiveOption(undefined)
          }}
          inert={store.minimized}
          aria-hidden={store.minimized || optionsOff() ? "true" : undefined}
          classList={{ "pointer-events-none": hidden() > 0.1 }}
          onPointerMove={(event) => {
            if (!props.composer || (!event.movementX && !event.movementY)) return

            // The highlight follows the pointer, as in the model picker.
            const row = event.target instanceof Element ? event.target.closest('[data-slot="question-option"]') : null
            const index = row instanceof HTMLDivElement ? optsRef.indexOf(row) : -1

            if (index >= 0 && index !== activeOption()) setActiveOption(index)
          }}
          style={{
            "max-height": hidden() > 0 ? `${Math.max(0, store.optionsHeight * (1 - hidden()))}px` : undefined,
            opacity: `${Math.max(0, Math.min(1, 1 - hidden()))}`,
            visibility: optionsOff() ? "hidden" : "visible",
          }}
        >
          <For each={options()}>
            {(opt, i) => (
              <Option
                id={props.composer ? optionID(i()) : undefined}
                active={activeOption() === i()}
                multi={multi()}
                picked={picked(opt.value)}
                label={opt.label}
                description={opt.description}
                number={i() + 1}
                disabled={sending()}
                submit={submitKey()}
                ref={(el) => (optsRef[i()] = el)}
                onFocus={() => setStore("focus", i())}
                onClick={() => selectOption(i())}
                onCommit={() => commit(i())}
              />
            )}
          </For>

          <Show when={!props.composer}>
            <div
              data-slot="question-option"
              data-custom="true"
              data-picked={on()}
              data-editing={store.editing}
              data-disabled={sending()}
              onClick={(event) => {
                if (event.target !== event.currentTarget || sending()) return
                setStore("focus", options().length)
                form.selectCustom()
                setStore("editing", true)
                customInput?.focus()
              }}
            >
              <button
                type="button"
                ref={customRef}
                data-slot="question-custom-toggle"
                role={multi() ? "checkbox" : "radio"}
                aria-checked={on()}
                aria-label={customLabel()}
                aria-keyshortcuts={count() <= 9 ? String(count()) : undefined}
                disabled={sending()}
                onFocus={() => setStore("focus", options().length)}
                onClick={customToggle}
                onKeyDown={(event) => {
                  if (event.ctrlKey || event.metaKey || questionEnter(event, submitKey()) !== "submit") return
                  event.preventDefault()

                  if (!event.repeat) commitCustomToggle()
                }}
              >
                <Mark multi={multi()} picked={on()} />
              </button>
              {customField()}
              <Show when={count() <= 9}>
                <Keybind
                  keys={[String(count())]}
                  variant={on() ? "outline" : "neutral"}
                  data-slot="question-option-shortcut"
                  aria-hidden="true"
                />
              </Show>
            </div>
          </Show>
        </div>
      </DockPrompt>
    </div>
  )
}

// Measures the text before the caret in a hidden copy of the field, so wrapped lines count too.
function caretOnFirstLine(field: HTMLTextAreaElement) {
  // SAFETY: cloning a textarea returns a textarea.
  const probe = field.cloneNode() as HTMLTextAreaElement

  probe.removeAttribute("id")
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    height: "auto",
    width: `${field.offsetWidth}px`,
  })
  field.parentElement?.append(probe)
  probe.value = field.value.slice(0, field.selectionStart)

  const before = probe.scrollHeight

  probe.value = ""

  const single = probe.scrollHeight

  probe.remove()

  return before <= single
}

function bounds(el: Element | null | undefined): DOMRect | undefined {
  if (!el) return undefined

  const rect = el.getBoundingClientRect()

  return rect.height >= 1 ? rect : bounds(el.parentElement)
}
