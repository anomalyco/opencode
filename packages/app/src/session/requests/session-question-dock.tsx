import { For, Show, createEffect, createMemo, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@bolt-ai/ui/button"
import { DockPrompt } from "@bolt-ai/session-ui/dock-prompt"
import { Icon } from "@bolt-ai/ui/icon"
import { useSpring } from "@bolt-ai/ui/motion-spring"
import { showToast } from "@/utils/toast"
import type { QuestionAnswer, QuestionRequest } from "@bolt-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { useCommand } from "@/shell/commands/command"

const cache = new Map<string, { tab: number; answers: string[][]; custom: string[]; customOn: boolean[] }>()

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

type QuestionField = FormStringField | FormMultiselectField

function questionField(field: FormInfo["fields"][number]): field is QuestionField {
  return field.type === "string" || field.type === "multiselect"
}

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
  shortcut?: string
  disabled: boolean
  ref?: (el: HTMLButtonElement) => void
  onFocus?: VoidFunction
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
      disabled={props.disabled}
      onFocus={props.onFocus}
      onClick={props.onClick}
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
    optionsHeight: 180,
  })

  let root: HTMLDivElement | undefined
  let optionsRef: HTMLDivElement | undefined
  let customRef: HTMLButtonElement | undefined
  let customInput: HTMLInputElement | undefined
  let optsRef: HTMLButtonElement[] = []
  let replied = false
  let focusFrame: number | undefined

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

    const scroller = document.querySelector(".scroll-view__viewport")
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

  const focus = (i: number) => {
    const next = clamp(i)
    setStore("focus", next)

    if (store.editing) return

    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      const el = next === options().length ? customRef : optsRef[next]
      el?.focus()
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

    update()

    makeEventListener(window, "resize", update)

    const dock = root?.closest('[data-component="session-composer-dock"]')
    const scroller = document.querySelector(".scroll-view__viewport")
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

  const customToggle = () => {
    if (sending()) return
    setStore("focus", options().length)

    if (!multi()) {
      setStore("customOn", store.tab, true)
      setStore("editing", true)
      customUpdate(input(), true)
      customInput?.focus()

      return
    }

    const next = !on()
    setStore("customOn", store.tab, next)

    if (next) {
      setStore("editing", true)
      customUpdate(input(), true)
      customInput?.focus()

      return
    }

    const value = input().trim()

    if (value) setStore("answers", store.tab, (current = []) => current.filter((item) => item.trim() !== value))
    setStore("editing", false)
    focus(options().length)
  }

  const move = (step: number) => {
    if (store.editing || sending()) return
    focus(store.focus + step)
  }

  const nav = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return

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
      if (event.repeat || event.isComposing || store.minimized || sending()) return
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

  const jump = (tab: number) => {
    if (sending() || tab === store.tab) return
    setStore("tab", tab)
    setStore("editing", false)

    if (optionsRef) setStore("optionsHeight", optionsRef.scrollHeight)

    if (!store.minimized) focus(pickFocus(tab))
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
                        />
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
            <div data-slot="question-details">
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
              <Show when={!store.minimized}>
                <div data-slot="question-hint">
                  {language.t(multi() ? "ui.question.multiHint" : "ui.question.singleHint")}
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
            "max-height": `${Math.max(0, store.optionsHeight * (1 - hidden()))}px`,
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
                shortcut={i() < 9 ? String(i() + 1) : undefined}
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
              setStore("customOn", store.tab, true)
              setStore("editing", true)
              customUpdate(input(), true)
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
              onClick={() => {
                setStore("customOn", store.tab, true)
                customUpdate(input(), true)
              }}
              onBlur={() => setStore("editing", false)}
              onKeyDown={(e) => {
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
              onInput={(e) => {
                setStore("customOn", store.tab, true)
                customUpdate(e.currentTarget.value, true)
              }}
            />
          </div>
        </div>
      </DockPrompt>
    </div>
  )
}
