import { For, Show, createEffect, createMemo, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { TextInput } from "@opencode/ui/text-input"
import { useSpring } from "@opencode/ui/motion-spring"
import { prefersReducedMotion } from "@opencode/ui/motion"
import { showToast } from "@/shell/notifications/toast"
import type { FormAnswer, FormInfo, FormMultiselectField, FormStringField } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { useCommand } from "@/shell/commands/command"
import { questionKey, type QuestionKeyZone } from "./question-keys"

const cache = new Map<string, { tab: number; answers: string[][]; custom: string[]; customOn: boolean[] }>()

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

// A bounce-0 spring with a 0.3s visual duration, sampled for the Web Animations API.
const SPRING_EASE =
  "linear(0, 0.04, 0.131, 0.243, 0.358, 0.466, 0.562, 0.645, 0.715, 0.774, 0.821, 0.859, 0.89, 0.914, 0.934, 0.949, 0.96, 0.97, 0.977, 0.982, 1)"

type QuestionField = FormStringField | FormMultiselectField

function questionField(field: FormInfo["fields"][number]): field is QuestionField {
  return field.type === "string" || field.type === "multiselect"
}

// The key that picks an answer is also its mark: round like a radio for one answer, a square like a checkbox for many.
function Mark(props: { multi: boolean; picked: boolean; shortcut?: string }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true">
      <span data-slot="question-option-key" data-type={props.multi ? "checkbox" : "radio"} data-picked={props.picked}>
        {props.shortcut}
      </span>
    </span>
  )
}

function Option(props: {
  multi: boolean
  picked: boolean
  label: string
  description?: string
  shortcut?: string
  disabled: boolean
  tabbable: boolean
  ref?: (el: HTMLButtonElement) => void
  onFocus?: VoidFunction
  onPointerMove?: (event: PointerEvent) => void
  onClick: VoidFunction
}) {
  return (
    <button
      type="button"
      ref={props.ref}
      data-slot="question-option"
      data-picked={props.picked}
      role={props.multi ? "checkbox" : "radio"}
      aria-checked={props.picked}
      aria-keyshortcuts={props.shortcut}
      tabindex={props.tabbable ? 0 : -1}
      disabled={props.disabled}
      onFocus={props.onFocus}
      onPointerMove={props.onPointerMove}
      onClick={props.onClick}
    >
      <Mark multi={props.multi} picked={props.picked} shortcut={props.shortcut} />
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
    </button>
  )
}

export const SessionQuestionDock: Component<{ request: FormInfo; onSubmit: () => void }> = (props) => {
  const serverSDK = useServerSDK()
  const language = useLanguage()
  const command = useCommand()
  const cacheKey = ScopedKey.from(serverSDK.scope, props.request.id)

  const questions = createMemo(() =>
    props.request.fields.filter(questionField).map((field) => ({
      field,
      header: field.title ?? "",
      question: field.description ?? field.title ?? "",
      options: field.type === "string" ? (field.options ?? []) : field.options,
      multiple: field.type === "multiselect",
    })),
  )

  const total = createMemo(() => questions().length)

  const cached = cache.get(cacheKey)

  const [store, setStore] = createStore({
    tab: cached?.tab ?? 0,
    answers: cached?.answers ?? [],
    custom: cached?.custom ?? [],
    customOn: cached?.customOn ?? [],
    editing: false,
    focus: 0,
    minimized: false,
    listHeight: 0,
  })

  let root: HTMLDivElement | undefined
  let detailsRef: HTMLDivElement | undefined
  let optionsRef: HTMLDivElement | undefined
  let listRef: HTMLDivElement | undefined
  let customRef: HTMLButtonElement | undefined
  let customRow: HTMLDivElement | undefined
  let highlightRef: HTMLSpanElement | undefined
  let customInput: HTMLInputElement | undefined
  let optsRef: HTMLButtonElement[] = []
  let replied = false
  const arrivals: Animation[] = []

  const question = createMemo(() => questions()[store.tab])
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const on = createMemo(() => store.customOn[store.tab] === true)
  const multi = createMemo(() => question()?.multiple === true)
  const count = createMemo(() => options().length + 1)

  const summary = createMemo(() => {
    if (total() === 1) return language.t("session.question.title")
    const n = Math.min(store.tab + 1, total())

    return language.t("session.question.progress", { current: n, total: total() })
  })

  const customLabel = () => language.t("ui.question.custom.answerPlaceholder")

  const last = createMemo(() => store.tab >= total() - 1)
  const collapse = useSpring(() => (store.minimized ? 1 : 0), { visualDuration: 0.3, bounce: 0 })
  const hidden = createMemo(() => Math.max(0, Math.min(1, collapse())))
  const optionsOff = createMemo(() => hidden() > 0.98)
  // The answers box follows its list's measured height, so the dock grows and shrinks with each question. Under
  // reduced motion it lands at once while the content fades.
  const listHeight = useSpring(
    () => store.listHeight,
    () => ({ visualDuration: prefersReducedMotion() ? 0.01 : 0.4, bounce: 0 }),
    () => store.listHeight > 0,
  )

  const customUpdate = (value: string, selected: boolean = on()) => {
    const prev = input().trim()
    const next = value.trim()

    setStore("custom", store.tab, value)

    if (!selected) return

    if (multi()) {
      setStore("answers", store.tab, (current = []) => {
        const removed = prev ? current.filter((item) => item.trim() !== prev) : current

        if (!next) return removed

        if (removed.some((item) => item.trim() === next)) return removed

        return [...removed, next]
      })

      return
    }

    setStore("answers", store.tab, next ? [next] : [])
  }

  const measure = () => {
    if (!root) return

    const scroller = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined

    const top =
      head instanceof HTMLElement && head.classList.contains("sticky") ? head.getBoundingClientRect().bottom : 0

    if (!top) {
      root.style.removeProperty("--question-prompt-max-height")

      return
    }

    const dock = root.closest('[data-component="session-composer-dock"]')

    if (!(dock instanceof HTMLElement)) return

    const dockBottom = dock.getBoundingClientRect().bottom
    const below = Math.max(0, dockBottom - root.getBoundingClientRect().bottom)
    const gap = 8
    const max = Math.max(240, Math.floor(dockBottom - top - gap - below))
    root.style.setProperty("--question-prompt-max-height", `${max}px`)
  }

  const clamp = (i: number) => Math.max(0, Math.min(count() - 1, i))

  const pickFocus = (tab: number = store.tab) => {
    const list = questions()[tab]?.options ?? []

    if (store.customOn[tab] === true) return list.length

    return Math.max(
      0,
      list.findIndex((item) => store.answers[tab]?.includes(item.value) ?? false),
    )
  }

  // Focus moves in the same task as the key that moved it, so the highlight and the focus never disagree for a frame.
  const focus = (i: number, how?: FocusOptions) => {
    const next = clamp(i)
    setStore("focus", next)

    if (store.editing) return
    const el = next === options().length ? customRef : optsRef[next]
    el?.focus(how)
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

    update()

    makeEventListener(window, "resize", update)

    const dock = root?.closest('[data-component="session-composer-dock"]')
    const scroller = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    createResizeObserver([dock, scroller], update)

    onCleanup(() => {
      if (raf !== undefined) cancelAnimationFrame(raf)
    })

    focus(pickFocus())
  })

  createEffect(() => {
    const el = listRef

    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const size = entries[0]?.borderBoxSize[0]?.blockSize
      if (size !== undefined) setStore("listHeight", size)
    })
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  // One highlight card glides between answers by its clip, so only one answer ever looks highlighted. It lands at once
  // on a new question, and under reduced motion it fades in at its new answer instead of gliding.
  let placed = { tab: -1, index: -1 }
  createEffect(() => {
    const el = highlightRef
    const index = store.focus
    const row = index === options().length ? customRow : optsRef[index]
    void store.listHeight

    if (!el || !row || !listRef) return
    const clip = `inset(${row.offsetTop}px 0 ${listRef.offsetHeight - row.offsetTop - row.offsetHeight}px round 6px)`
    const fresh = placed.tab !== store.tab
    const moved = fresh || placed.index !== index
    const reduced = prefersReducedMotion()
    placed = { tab: store.tab, index }

    if (!fresh && !reduced) {
      el.style.clipPath = clip

      return
    }

    el.style.transition = "none"
    el.style.clipPath = clip
    void el.offsetHeight
    el.style.removeProperty("transition")

    if (reduced && moved && el.animate)
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "linear" })
  })

  onCleanup(() => {
    arrivals.forEach((animation) => animation.cancel())

    if (replied) return
    cache.set(cacheKey, {
      tab: store.tab,
      answers: store.answers.map((a) => (a ? [...a] : [])),
      custom: store.custom.map((s) => s ?? ""),
      customOn: store.customOn.map((b) => b ?? false),
    })
  })

  const fail = (err: Error) => showToast({ title: language.t("common.requestFailed"), description: err.message })

  const replyMutation = useMutation(() => ({
    mutationFn: (answer: FormAnswer) =>
      serverSDK.api.session.form.reply({ sessionID: props.request.sessionID, formID: props.request.id, answer }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      replied = true
      cache.delete(cacheKey)
    },
    onError: fail,
  }))

  const rejectMutation = useMutation(() => ({
    mutationFn: () =>
      serverSDK.api.session.form.cancel({ sessionID: props.request.sessionID, formID: props.request.id }),
    onMutate: () => {
      props.onSubmit()
    },
    onSuccess: () => {
      replied = true
      cache.delete(cacheKey)
    },
    onError: fail,
  }))

  const sending = createMemo(() => replyMutation.isPending || rejectMutation.isPending)
  const submitShortcut = () => (IS_MAC ? "⌘⏎" : `${language.t("common.key.ctrl")}+⏎`)
  const backShortcut = () => (IS_MAC ? "⌘[" : `${language.t("common.key.alt")}+←`)

  const reply = (answer: FormAnswer) => {
    if (sending()) return
    replyMutation.mutate(answer)
  }

  const reject = () => {
    if (sending()) return
    rejectMutation.mutate()
  }

  const submit = () =>
    reply(
      Object.fromEntries(
        questions().flatMap((question, index) => {
          const answers = store.answers[index] ?? []

          if (answers.length === 0) return []

          return [[question.field.key, question.multiple ? answers : answers[0]]]
        }),
      ),
    )

  const answered = (i: number) => {
    if ((store.answers[i]?.length ?? 0) > 0) return true

    return store.customOn[i] === true && (store.custom[i] ?? "").trim().length > 0
  }

  const picked = (answer: string) => store.answers[store.tab]?.includes(answer) ?? false

  const pick = (answer: string) => {
    setStore("answers", store.tab, [answer])
    setStore("customOn", store.tab, false)
    setStore("editing", false)
  }

  const toggle = (answer: string) => {
    setStore("answers", store.tab, (current = []) => {
      if (current.includes(answer)) return current.filter((item) => item !== answer)

      return [...current, answer]
    })
  }

  const startCustom = () => {
    setStore("focus", options().length)
    setStore("customOn", store.tab, true)
    setStore("editing", true)
    customUpdate(input(), true)
    customInput?.focus()
    customInput?.setSelectionRange(input().length, input().length)
  }

  const customToggle = () => {
    if (sending()) return

    if (!multi() || !on()) return startCustom()

    setStore("customOn", store.tab, false)
    const value = input().trim()

    if (value) setStore("answers", store.tab, (current = []) => current.filter((item) => item.trim() !== value))
    setStore("editing", false)
    focus(options().length)
  }

  // The pointer moves the highlight like the arrows do, but never takes focus from the custom answer's field.
  const hover = (i: number, event: PointerEvent) => {
    if (event.pointerType !== "mouse" || store.editing || sending()) return
    setStore("focus", i)
  }

  // Enter picks the highlighted answer of a single-choice question, then moves on. An empty custom answer opens its
  // field instead, since there is nothing to pick yet.
  const commit = () => {
    if (multi()) return next()

    if (store.focus < options().length) {
      selectOption(store.focus)

      return next()
    }

    if (!input().trim()) return startCustom()
    setStore("customOn", store.tab, true)
    customUpdate(input(), true)
    next()
  }

  const zone = (target: EventTarget | null): QuestionKeyZone => {
    if (store.editing) return "input"

    if (!(target instanceof HTMLElement)) return "other"

    if (target.closest(".question-custom-field")) return "input"

    if (target.matches('[data-slot="question-custom-toggle"]')) return "custom"

    if (target.matches('[data-slot="question-option"]')) return "option"

    return "other"
  }

  const nav = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return

    const intent = questionKey(event, { mac: IS_MAC, zone: zone(event.target), count: count() })

    if (intent.type === "none") return

    if (intent.type === "dismiss") {
      event.preventDefault()
      reject()

      return
    }

    if (intent.type === "advance") {
      event.preventDefault()
      next()

      return
    }

    if (intent.type === "question") {
      event.preventDefault()
      const rtl = event.key.startsWith("Arrow") && !event.altKey && root?.matches(":dir(rtl)")
      const step = rtl ? -intent.step : intent.step

      if (step < 0) return back()

      if (!last()) jump(store.tab + 1)

      return
    }

    if (store.minimized || sending()) return

    if (intent.type === "number") {
      event.preventDefault()

      if (intent.index === options().length) return customToggle()

      selectOption(intent.index)
      focus(intent.index)

      return
    }

    event.preventDefault()

    if (intent.type === "type") {
      setStore("customOn", store.tab, true)
      customUpdate(input() + event.key, true)

      return startCustom()
    }

    if (intent.type === "swallow") return

    if (intent.type === "commit") return commit()

    if (intent.type === "activate") {
      if (store.focus === options().length) return customToggle()

      return selectOption(store.focus)
    }

    focus(intent.type === "edge" ? (intent.to === "first" ? 0 : count() - 1) : store.focus + intent.step)
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return

    const opt = options()[optIndex]

    if (!opt) return

    if (multi()) {
      setStore("editing", false)
      toggle(opt.value)

      return
    }

    pick(opt.value)
  }

  const commitCustom = () => {
    setStore("editing", false)
    customUpdate(input())
    focus(options().length)
  }

  const next = () => {
    if (sending()) return

    if (store.editing) commitCustom()

    if (store.tab >= total() - 1) {
      submit()

      return
    }

    jump(store.tab + 1)
  }

  const back = () => {
    if (sending()) return

    if (store.tab <= 0) return
    jump(store.tab - 1)
  }

  // The new question's text and answers slide in from the side they come from and fade up; under reduced motion they
  // only fade.
  const arrive = (step: number) => {
    arrivals.forEach((animation) => animation.cancel())
    arrivals.length = 0
    const reduced = prefersReducedMotion()
    const x = (root?.matches(":dir(rtl)") ? -step : step) * 12
    const frames = reduced
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
          { opacity: 0, transform: `translate3d(${x}px,0,0)` },
          { opacity: 1, transform: "none" },
        ]
    ;[detailsRef, optionsRef].forEach((el) => {
      if (el?.animate) arrivals.push(el.animate(frames, { duration: reduced ? 150 : 300, easing: SPRING_EASE }))
    })
  }

  const jump = (tab: number) => {
    if (sending() || tab === store.tab) return
    const step = Math.sign(tab - store.tab)
    // The highlight's index moves before the question does, so it lands on the new question's answer instead of
    // gliding from the old one.
    setStore("focus", pickFocus(tab))
    setStore("tab", tab)
    setStore("editing", false)

    if (store.minimized) return
    // The answers box is still springing to the new list's height, so focusing must not scroll it.
    focus(pickFocus(tab), { preventScroll: true })
    arrive(step)
  }

  command.register("session.question.back", () => [
    {
      id: "session.question.back",
      title: language.t("ui.common.back"),
      keybind: IS_MAC ? "mod+[" : "alt+arrowleft",
      hidden: true,
      // Stay registered while sending so the shortcut does not fall through to history navigation.
      disabled: store.tab <= 0,
      when: () => store.tab > 0,
      onSelect: back,
    },
  ])

  const minimize = () => {
    if (sending()) return
    setStore("editing", false)
    setStore("minimized", true)
  }

  const restore = () => {
    if (sending()) return
    setStore("minimized", false)
    focus(pickFocus())
  }

  return (
    <div data-component="session-question-dock">
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
                          data-active={i() === store.tab}
                          data-answered={answered(i())}
                          disabled={sending()}
                          onClick={() => jump(i())}
                          aria-label={language.t("ui.tool.questions.numbered", { number: i() + 1 })}
                          aria-current={i() === store.tab ? "step" : undefined}
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
            <div data-slot="question-details" ref={(el) => (detailsRef = el)}>
              <div
                data-slot="question-text"
                style={{
                  display: store.minimized ? "-webkit-box" : undefined,
                  "-webkit-line-clamp": store.minimized ? "3" : undefined,
                  "-webkit-box-orient": store.minimized ? "vertical" : undefined,
                  overflow: store.minimized ? "hidden" : undefined,
                }}
              >
                <bdi>{question()?.question}</bdi>
              </div>
              <Show when={!store.minimized && multi()}>
                <div data-slot="question-hint">{language.t("ui.question.multiHint")}</div>
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
              <Show when={store.tab > 0}>
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
                  variant={last() ? "submit" : "neutral"}
                  size="large"
                  disabled={sending()}
                  onClick={next}
                  aria-keyshortcuts="Meta+Enter Control+Enter"
                >
                  {language.t(last() ? "ui.common.submit" : "ui.common.next")}
                  <span data-slot="question-submit-shortcut" aria-hidden="true">
                    {submitShortcut()}
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
          role={multi() ? "group" : "radiogroup"}
          aria-label={question()?.question}
          inert={store.minimized}
          aria-hidden={store.minimized || optionsOff() ? "true" : undefined}
          classList={{ "pointer-events-none": hidden() > 0.1 }}
          style={{
            height: store.listHeight > 0 ? `${Math.max(0, listHeight() * (1 - hidden()))}px` : undefined,
            opacity: `${Math.max(0, Math.min(1, 1 - hidden()))}`,
            visibility: optionsOff() ? "hidden" : "visible",
          }}
          // Space already acted on key down; its release must not click the button again.
          onKeyUp={(event) => {
            if (event.key !== " ") return
            const where = zone(event.target)

            if (where === "option" || where === "custom") event.preventDefault()
          }}
        >
          <div data-slot="question-options-list" ref={(el) => (listRef = el)}>
            <span data-slot="question-highlight" ref={(el) => (highlightRef = el)} aria-hidden="true" />
            <For each={options()}>
              {(opt, i) => (
                <Option
                  multi={multi()}
                  picked={picked(opt.value)}
                  label={opt.label}
                  description={opt.description}
                  shortcut={i() < 9 ? String(i() + 1) : undefined}
                  disabled={sending()}
                  tabbable={store.focus === i()}
                  ref={(el) => (optsRef[i()] = el)}
                  onFocus={() => setStore("focus", i())}
                  onPointerMove={(event) => hover(i(), event)}
                  onClick={() => selectOption(i())}
                />
              )}
            </For>

            <div
              ref={(el) => (customRow = el)}
              data-slot="question-option"
              data-custom="true"
              data-picked={on()}
              data-editing={store.editing}
              data-disabled={sending()}
              onPointerMove={(event) => hover(options().length, event)}
              onClick={(event) => {
                if (event.target !== event.currentTarget || sending()) return
                startCustom()
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
                tabindex={store.focus === options().length ? 0 : -1}
                disabled={sending()}
                onFocus={() => setStore("focus", options().length)}
                onClick={customToggle}
              >
                <Mark multi={multi()} picked={on()} shortcut={count() <= 9 ? String(count()) : undefined} />
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
                  setStore("focus", options().length)
                  setStore("editing", true)
                }}
                onClick={() => {
                  setStore("customOn", store.tab, true)
                  customUpdate(input(), true)
                }}
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

                  if (!e.repeat) next()
                }}
                onInput={(e) => {
                  setStore("customOn", store.tab, true)
                  customUpdate(e.currentTarget.value, true)
                }}
              />
            </div>
          </div>
        </div>
      </DockPrompt>
    </div>
  )
}
