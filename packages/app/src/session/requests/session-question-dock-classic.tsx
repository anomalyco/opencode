import { For, Show, createEffect, createMemo, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { LinkedText } from "@opencode/session-ui/linked-text"
import { Icon } from "@opencode/ui/icon"
import { Keybind } from "@opencode/ui/keybind"
import { TextInput } from "@opencode/ui/text-input"
import { useSpring } from "@opencode/ui/motion-spring"
import { observeReducedMotion, prefersReducedMotion } from "@opencode/ui/motion"
import type { FormInfo } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useCommand } from "@/shell/commands/command"
import { useServerSDK } from "@/runtime/server/client"
import { createQuestionDock } from "./question-controller"

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
  multi: boolean
  picked: boolean
  label: string
  description?: string
  number: number
  disabled: boolean
  ref?: (el: HTMLDivElement) => void
  onFocus?: VoidFunction
  onClick: VoidFunction
}) {
  let pointer: { x: number; y: number } | undefined

  return (
    <div
      ref={props.ref}
      data-slot="question-option"
      data-picked={props.picked}
      data-disabled={props.disabled}
      role={props.multi ? "checkbox" : "radio"}
      aria-checked={props.picked}
      aria-keyshortcuts={props.number <= 9 ? String(props.number) : undefined}
      aria-disabled={props.disabled}
      tabindex={props.disabled ? -1 : 0}
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

        if (event.key !== " " && event.key !== "Enter") return
        event.preventDefault()

        if (event.key === " " && event.repeat) return

        if (!props.disabled) props.onClick()
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

export const SessionQuestionDockClassic: Component<{ request: FormInfo; onSubmit: () => void }> = (props) => {
  const language = useLanguage()
  const command = useCommand()

  const form = createQuestionDock({
    sdk: useServerSDK(),
    language,
    request: () => props.request,
    onSubmit: () => props.onSubmit(),
  })

  const questions = form.questions

  const total = createMemo(() => questions().length)

  const [store, setStore] = createStore({
    editing: false,
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
  let customInput: HTMLInputElement | undefined
  let optsRef: HTMLDivElement[] = []
  let focusFrame: number | undefined

  const question = createMemo(() => questions()[form.tab()])
  const options = createMemo(() => question()?.options ?? [])
  const input = () => form.draft(form.tab()).customText
  const on = () => form.draft(form.tab()).customSelected
  const multi = createMemo(() => question()?.multiple === true)
  const count = createMemo(() => options().length + 1)

  const summary = createMemo(() => {
    if (total() === 1) return language.t("session.question.title")
    const n = Math.min(form.tab() + 1, total())

    return language.t("session.question.progress", { current: n, total: total() })
  })

  const customLabel = () => language.t("ui.question.custom.answerPlaceholder")

  const last = createMemo(() => form.tab() >= total() - 1)

  const collapse = useSpring(
    () => (store.minimized ? 1 : 0),
    { visualDuration: 0.3, bounce: 0 },
    () => (store.reducedMotion || store.keyboard ? store.minimized : undefined),
  )

  const hidden = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const optionsOff = createMemo(() => hidden() > 0.98)

  const measure = () => {
    if (!root) return

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

  const focus = (i: number) => {
    const next = clamp(i)
    setStore("focus", next)

    if (store.editing) return

    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      const el = next === options().length ? customRef : optsRef[next]
      el?.focus({ preventScroll: true })
      const row = el?.closest<HTMLElement>('[data-slot="question-option"]')

      if (!row || !optionsRef) return
      optionsRef.scrollTop = Math.min(
        row.offsetTop,
        Math.max(optionsRef.scrollTop, row.offsetTop + row.offsetHeight - optionsRef.clientHeight),
      )
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
    createResizeObserver([dock, scroller], update)

    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    })

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

  const sending = form.busy
  const submitShortcut = () => (IS_MAC ? "⌘⏎" : `${language.t("common.key.ctrl")}+⏎`)
  const backShortcut = () => (IS_MAC ? "⌘[" : `${language.t("common.key.alt")}+←`)

  const reject = form.dismiss

  const picked = (answer: string) => form.draft(form.tab()).selected.includes(answer)

  const customToggle = () => {
    if (sending()) return
    setStore("focus", options().length)

    if (!multi() || !on()) {
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
    focus(store.focus + step)
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
      next()

      return
    }

    const target =
      event.target instanceof HTMLElement ? event.target.closest('[data-slot="question-options"]') : undefined

    if (store.editing) return

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
    focus(count() - 1)
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return
    const opt = options()[optIndex]

    if (!opt) return
    setStore("editing", false)
    form.pick(opt.value)
  }

  const commitCustom = () => {
    setStore("editing", false)
    focus(options().length)
  }

  const next = () => {
    if (sending()) return

    if (store.editing) commitCustom()

    if (form.tab() >= total() - 1) {
      form.reply()

      return
    }

    jump(form.tab() + 1)
  }

  const back = () => {
    if (sending() || form.tab() <= 0) return
    jump(form.tab() - 1)
  }

  const jump = (tab: number) => {
    if (sending() || tab === form.tab()) return
    form.selectTab(tab)
    setStore("editing", false)

    if (detailsRef) detailsRef.scrollTop = 0

    if (optionsRef) {
      optionsRef.scrollTop = 0
      setStore("optionsHeight", optionsRef.scrollHeight)
    }

    if (!store.minimized) focus(pickFocus(tab))
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

  return (
    <div
      data-component="session-question-dock"
      data-keyboard={store.keyboard}
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
              <div data-slot="question-header-title">
                <bdi>{summary()}</bdi>
              </div>
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
                <IconButton
                  icon={<Icon name="outline-chevron-down" size="normal" />}
                  variant="ghost"
                  size="large"
                  disabled={sending()}
                  style={{ transform: `rotate(${hidden() * 180}deg)` }}
                  onClick={store.minimized ? restore : minimize}
                  aria-label={language.t(store.minimized ? "session.question.restore" : "session.question.minimize")}
                />
              </div>
            </div>
            <div
              data-slot="question-details"
              data-scrollable={!store.minimized || undefined}
              ref={(el) => (detailsRef = el)}
            >
              <div
                data-slot="question-text"
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
              <Show when={!store.minimized}>
                <div data-slot="question-hint">
                  {language.t(multi() ? "ui.question.classic.multiHint" : "ui.question.singleHint")}
                </div>
              </Show>
            </div>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={sending()} onClick={reject} aria-keyshortcuts="Escape">
              {language.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions">
              <Show when={form.tab() > 0}>
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
                    {language.t(last() ? "ui.common.submit" : "ui.common.next")}
                    <span style={{ opacity: 0.6 }}>{submitShortcut()}</span>
                  </>
                }
              >
                <Button
                  variant={last() ? "contrast" : "neutral"}
                  size="large"
                  disabled={sending()}
                  onClick={next}
                  aria-label={language.t(last() ? "ui.common.submit" : "ui.common.next")}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
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
              </Tooltip>
            </div>
          </>
        }
      >
        <div
          ref={(el) => (optionsRef = el)}
          data-slot="question-options"
          data-scrollable
          role={multi() ? "group" : "radiogroup"}
          aria-label={question()?.question}
          inert={store.minimized}
          aria-hidden={store.minimized || optionsOff() ? "true" : undefined}
          classList={{ "pointer-events-none": hidden() > 0.1 }}
          style={{
            "max-height": hidden() > 0 ? `${Math.max(0, store.optionsHeight * (1 - hidden()))}px` : undefined,
            opacity: `${Math.max(0, Math.min(1, 1 - hidden()))}`,
            visibility: optionsOff() ? "hidden" : "visible",
          }}
        >
          <For each={options()}>
            {(opt, i) => (
              <Option
                multi={multi()}
                picked={picked(opt.value)}
                label={opt.label}
                description={opt.description}
                number={i() + 1}
                disabled={sending()}
                ref={(el) => (optsRef[i()] = el)}
                onFocus={() => setStore("focus", i())}
                onClick={() => selectOption(i())}
              />
            )}
          </For>

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
            >
              <Mark multi={multi()} picked={on()} />
            </button>
            <TextInput
              ref={(el) => (customInput = el)}
              class="question-custom-field"
              dir="auto"
              aria-label={customLabel()}
              placeholder={customLabel()}
              value={input()}
              disabled={sending()}
              onFocus={() => {
                if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
                focusFrame = undefined
                setStore("focus", options().length)
                setStore("editing", true)
              }}
              onClick={() => form.selectCustom()}
              onBlur={() => setStore("editing", false)}
              onKeyDown={(e) => {
                if (e.isComposing || e.keyCode === 229) return

                if (e.key === "Escape") {
                  e.preventDefault()
                  setStore("editing", false)
                  focus(options().length)

                  return
                }

                if ((e.metaKey || e.ctrlKey) && !e.altKey) return

                if (e.key !== "Enter") return
                e.preventDefault()
                commitCustom()
              }}
              onInput={(e) => form.input(e.currentTarget.value)}
            />
            <Show when={count() <= 9}>
              <Keybind
                keys={[String(count())]}
                variant={on() ? "outline" : "neutral"}
                data-slot="question-option-shortcut"
                aria-hidden="true"
              />
            </Show>
          </div>
        </div>
      </DockPrompt>
    </div>
  )
}

function bounds(el: Element | null | undefined): DOMRect | undefined {
  if (!el) return undefined

  const rect = el.getBoundingClientRect()

  return rect.height >= 1 ? rect : bounds(el.parentElement)
}
