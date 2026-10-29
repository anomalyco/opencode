import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { IconButton } from "@opencode/ui/icon-button"
import { RollingNumber } from "@opencode/ui/rolling-number"
import { Tooltip } from "@opencode/ui/tooltip"
import { DockPrompt } from "@opencode/session-ui/dock-prompt"
import { Icon } from "@opencode/ui/icon"
import { frameLoop, Spring, type DurationOptions } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"
import { showToast } from "@/shell/notifications/toast"
import type { FormAnswer, FormInfo, FormMultiselectField, FormStringField } from "@opencode/client/promise"
import { useLanguage } from "@/runtime/i18n/language"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { useServerSDK } from "@/runtime/server/client"
import { ScopedKey } from "@/runtime/server/scope"
import { useCommand } from "@/shell/commands/command"
import { questionKey, type QuestionKeyZone } from "./question-keys"
import { questionMotion } from "./question-motion"

const cache = new Map<string, { tab: number; answers: string[][]; custom: string[]; customOn: boolean[] }>()

const IS_MAC = /(Mac|iPod|iPhone|iPad)/.test(navigator.platform)

const group = "Timeline"

const subsection = "Question"

const target = '[data-component="dock-prompt"][data-kind="question"]'

// The question text and the answers box follow their new heights on this spring.
const resize = motionTuning.spring("question.height", {
  label: "Height",
  group,
  subsection,
  target,
  shipped: "smooth",
  presets: {
    snappy: { duration: 0.35, bounce: 0 },
    smooth: { duration: 0.45, bounce: 0 },
    calm: { duration: 0.55, bounce: 0 },
  },
})

// Switching questions reshapes the card as one surface: the old question blurs, shrinks and fades away while the new
// one resolves out of the same blur. Both copies move on the switch spring: `fadeIn` and `fadeOut` say how far through
// it the new question is fully shown and the old one fully gone, while blur and scale ease out over the whole of it.
// `launch` starts the spring at that multiple of its natural speed, so it answers the key at once without overshooting.
const meta = { group, subsection, target }

const tuning = {
  spring: motionTuning.spring("question.switch", {
    label: "Switch",
    description: "Moving between questions with ← and →",
    ...meta,
    presets: {
      snappy: { duration: 0.375, bounce: 0 },
      smooth: { duration: 0.5, bounce: 0 },
      calm: { duration: 0.65, bounce: 0 },
    },
  }),
  launch: motionTuning.number("question.launch", {
    label: "Launch speed",
    ...meta,
    min: 0,
    max: 1,
    step: 0.05,
    value: 0.3,
  }),
  travel: motionTuning.number("question.travel", {
    label: "Travel",
    ...meta,
    min: 0,
    max: 48,
    step: 1,
    unit: "px",
    value: 0,
  }),
  fadeIn: motionTuning.number("question.fade-in", {
    label: "Fade in by",
    ...meta,
    min: 0.05,
    max: 1,
    step: 0.05,
    value: 0.45,
  }),
  fadeOut: motionTuning.number("question.fade-out", {
    label: "Fade out by",
    ...meta,
    min: 0.05,
    max: 1,
    step: 0.05,
    value: 0.6,
  }),
  // More blur costs more to paint and looks no better.
  blur: motionTuning.number("question.blur", {
    label: "Blur",
    ...meta,
    min: 0,
    max: 2,
    step: 0.25,
    unit: "px",
    value: 2,
  }),
  scale: motionTuning.number("question.scale", {
    label: "Scale from",
    ...meta,
    min: 0.85,
    max: 1,
    step: 0.005,
    value: 0.97,
  }),
}

type Tuning = typeof tuning

// The footer follows the switch: Back resolves in from beside Next the way the question does, out of `travel` px,
// the blur and the scale, and goes the same way. Next and Submit share one place, so turning one into the other
// crossfades them while the button's edge sweeps to the new width. Each is fully shown `fade` of the way through, and
// its label resolves in, out of the blur, only as the other one's goes, so the two words never read over each other.
const footer = {
  spring: motionTuning.spring("question.footer", {
    label: "Footer buttons",
    description: "Back coming and going, and Next turning into Submit",
    ...meta,
    presets: {
      snappy: { duration: 0.375, bounce: 0 },
      smooth: { duration: 0.5, bounce: 0 },
      calm: { duration: 0.65, bounce: 0 },
    },
  }),
  travel: motionTuning.number("question.footer-travel", {
    label: "Back travel",
    ...meta,
    min: 0,
    max: 24,
    step: 1,
    unit: "px",
    value: 6,
  }),
  fade: motionTuning.number("question.footer-fade", {
    label: "Footer fade by",
    ...meta,
    min: 0.05,
    max: 1,
    step: 0.05,
    value: 0.6,
  }),
}

const minimizing: DurationOptions = { duration: 0.3, bounce: 0 }

// How far a list that scrolls fades out at an edge with more answers past it.
const feather = 24

// Where a copy of the question sits on screen relative to its place at rest, how much of it shows, and how close it is
// to sharp and full size.
type Pose = { x: number; shown: number; settle: number }

const rest: Pose = { x: 0, shown: 1, settle: 1 }

// A copy of the question on its way somewhere: it set off from `from` toward the offset `to`, and its spring runs from 0
// to 1 along the way.
type Track = { from: Pose; to: number; spring: Spring }

// The question being left: inert copies of its text and its answers, how tall they are, and how far its answers were
// scrolled.
type Ghost = Track & { tab: number; els: HTMLElement[]; details: number; list: number; scroll: number }

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

  const [lit, setLit] = createSignal<"none" | "hover" | "keys">("none")

  let root: HTMLDivElement | undefined
  let chevron: HTMLButtonElement | undefined
  let detailsFrame: HTMLDivElement | undefined
  let detailsRef: HTMLDivElement | undefined
  let optionsRef: HTMLDivElement | undefined
  let optionsTrack: HTMLDivElement | undefined
  let listRef: HTMLDivElement | undefined
  let customRef: HTMLButtonElement | undefined
  let customRow: HTMLDivElement | undefined
  let highlightRef: HTMLSpanElement | undefined
  let customInput: HTMLTextAreaElement | undefined
  let optsRef: HTMLButtonElement[] = []
  let replied = false

  const question = createMemo(() => questions()[store.tab])
  const options = createMemo(() => question()?.options ?? [])
  const input = createMemo(() => store.custom[store.tab] ?? "")
  const on = createMemo(() => store.customOn[store.tab] === true)
  const multi = createMemo(() => question()?.multiple === true)
  const count = createMemo(() => options().length + 1)

  const current = createMemo(() => Math.min(store.tab + 1, total()))

  // "N of M questions", split around N so N can roll while the words around it stay put, wherever a language puts it.
  const summary = createMemo(() => {
    if (total() === 1) return [language.t("session.question.title")]

    return language.t("session.question.progress", { current: "\u0000", total: total() }).split("\u0000")
  })

  const customLabel = () => language.t("ui.question.custom.answerPlaceholder")

  const last = createMemo(() => store.tab >= total() - 1)
  // The question text and the answers box follow their measured heights on springs, so the dock grows and shrinks with
  // each question, and the answers box folds away when the dock is minimized. One frame job steps these springs and the
  // switch between questions, and writes the results straight to the elements. Without the dock's motion (its knob is
  // off by default, and reduced motion turns it off) every spring lands on its target and is painted at once.
  const content = { details: 0, list: 0 }
  const boxes = { details: new Spring(0), list: new Spring(0), folded: new Spring(0) }
  let ghost: Ghost | undefined
  let into: Track | undefined
  let stop: VoidFunction | undefined
  // The current question's bar rests on the first dash and slides along the progress row to the current one, by how
  // far that dash is from the first, so it mirrors in RTL.
  const bar = new Spring(0)
  const dashes: HTMLElement[] = []
  let pip: HTMLElement | undefined
  const dash = (tab: number) => (dashes[tab]?.offsetLeft ?? 0) - (dashes[0]?.offsetLeft ?? 0)
  // The footer: how far Back is shown, how far the shared button is Submit rather than Next, and how far Back still
  // sits from its place after the button beside it changed width. Widths are read when a switch starts, never per frame.
  const foot = { back: new Spring(store.tab > 0 ? 1 : 0), submit: new Spring(last() ? 1 : 0), shift: new Spring(0) }
  let nextFace: HTMLElement | undefined
  let submitFace: HTMLElement | undefined
  let nextLabel: HTMLElement | undefined
  let submitLabel: HTMLElement | undefined
  const widths = { next: 0, submit: 0 }
  let backBox: HTMLElement | undefined
  let rtl = false

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

  const resizeInput = (el: HTMLTextAreaElement) => {
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }

  createEffect(() => {
    input()

    if (customInput) resizeInput(customInput)
  })

  // The dock's heights from its last measure: at most, and of everything but the question text and the answers box.
  // The answers box takes what the question text leaves, and opens only to the room it will have at rest, so it never
  // grows past it and springs back.
  const limit = { max: Infinity, chrome: 0 }
  const cap = () => limit.max - limit.chrome
  // The room the answers box has now, while the question text springs to its height, and once it is there.
  const room = () => cap() - boxes.details.value
  const settled = (details = content.details) => cap() - details
  const scroll = { top: 0, view: 0 }

  const measure = () => {
    if (!root) return

    const scroller = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    const head = scroller instanceof HTMLElement ? scroller.firstElementChild : undefined

    // The timeline starts under its sticky header, or at its own top when it has none.
    const top =
      head instanceof HTMLElement && head.classList.contains("sticky")
        ? head.getBoundingClientRect().bottom
        : scroller instanceof HTMLElement
          ? scroller.getBoundingClientRect().top
          : 0

    const dock = root.closest('[data-component="session-composer-dock"]')
    // The dock sits at the foot of the column it shares with the timeline, in the app inside a zero-height row that it
    // overflows upward. Grown past the column it spills out of it, so the column bounds it, not the dock's own edge.
    const column = bounds(dock?.parentElement)
    const bottom = Math.min(window.innerHeight, column?.bottom ?? window.innerHeight)

    // Whatever the dock holds besides the question, above it or below, takes from the same height.
    const around =
      dock instanceof HTMLElement
        ? Math.max(0, dock.getBoundingClientRect().height - root.getBoundingClientRect().height)
        : 0

    const gap = 8
    const height = bottom - Math.max(0, top, column?.top ?? 0) - around
    limit.max = Math.max(240, Math.floor(height - gap))

    // Minimized, the answers box is gone, so only an open dock is measured.
    if (!store.minimized && optionsRef && detailsFrame)
      limit.chrome = root.offsetHeight - optionsRef.offsetHeight - detailsFrame.offsetHeight
    root.style.setProperty("--question-prompt-max-height", `${limit.max}px`)

    if (content.list > 0) boxes.list.snap(Math.min(content.list, settled()))
    paint()
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
    el?.focus({ preventScroll: true })

    if (!how?.preventScroll) reveal(rowAt(next))
  }

  const rowAt = (i: number) => (i === options().length ? customRow : optsRef[i])

  // A list that scrolls follows the highlighted answer at once, keeping it clear of the feathered edges.
  const reveal = (row: HTMLElement | undefined, view = optionsRef?.clientHeight ?? 0) => {
    if (!row || !optionsRef || !listRef) return
    const top = row.offsetTop + listRef.offsetTop
    const edge = Math.min(feather, view / 4)
    optionsRef.scrollTop = Math.min(top - edge, Math.max(optionsRef.scrollTop, top + row.offsetHeight + edge - view))
    scroll.top = optionsRef.scrollTop
    pin()
  }

  // The leaving copy of the answers stays where they were on screen however far the live list scrolls under it.
  const pin = () => {
    const answers = ghost?.els[1]

    if (ghost && answers) answers.style.top = `${scroll.top - ghost.scroll}px`
  }

  // Measuring reads layout, so it waits while the dock's own springs are moving and runs once they come to rest.
  let measuring: number | undefined

  const requestMeasure = () => {
    if (stop || measuring !== undefined) return
    measuring = requestAnimationFrame(() => {
      measuring = undefined
      measure()
    })
  }

  onMount(() => {
    measure()

    makeEventListener(window, "resize", requestMeasure)

    const dock = root?.closest('[data-component="session-composer-dock"]')
    const scroller = document.querySelector('[data-slot="session-timeline-scroll"] > .scroll-view__viewport')
    createResizeObserver([dock, scroller], requestMeasure)

    onCleanup(() => {
      if (measuring !== undefined) cancelAnimationFrame(measuring)
    })

    focus(pickFocus())
  })

  createEffect(() => {
    const list = listRef
    const details = detailsRef

    if (!list || !details) return

    const observer = new ResizeObserver((entries) => {
      const fresh = { details: content.details === 0, list: content.list === 0 }

      entries.forEach((entry) => {
        const size = entry.borderBoxSize[0]?.blockSize

        if (size === undefined) return
        const key = entry.target === list ? "list" : "details"
        content[key] = size

        if (key === "list") setStore("listHeight", size)
      })

      // The answers box opens only as far as the room the new question text leaves it at rest.
      ;(["details", "list"] as const).forEach((key) => {
        const spring = boxes[key]
        const size = key === "list" ? Math.min(content.list, settled()) : content.details

        if (spring.target === size) return

        if (fresh[key] || !questionMotion()) spring.snap(size)
        else tune(spring, resize()).set(size)
      })
      wake()
    })

    observer.observe(list)
    observer.observe(details)
    onCleanup(() => observer.disconnect())
  })

  // One highlight card jumps between answers by its clip, so only one answer ever looks highlighted.
  createEffect(() => {
    const el = highlightRef
    const index = store.focus
    const row = rowAt(index)
    void store.listHeight

    if (!el || !row || !listRef) return
    el.style.clipPath = `inset(${row.offsetTop}px 0 ${listRef.offsetHeight - row.offsetTop - row.offsetHeight}px round 6px)`
  })

  onCleanup(() => {
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

  // Scrolling the list under a still cursor makes the browser fire a pointermove at the same spot; it is not the user.
  let pointer = { x: -1, y: -1 }

  // The pointer moves the highlight like the arrows do, but never takes focus from the custom answer's field.
  const hover = (i: number, event: PointerEvent) => {
    const still = event.clientX === pointer.x && event.clientY === pointer.y
    pointer = { x: event.clientX, y: event.clientY }

    if (event.pointerType !== "mouse" || still || store.editing || sending()) return
    setLit("hover")
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

    if (intent.type === "move" || intent.type === "edge") setLit("keys")

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

  // Switching questions: the question being left is copied into a still, inert ghost over its place, while the live
  // text and answers show the new question. One spring then moves both: the ghost blurs, shrinks and fades away while
  // the new question resolves in its place, each shifted by `travel` toward the way they go. The ghost is gone only once
  // the new question has fully arrived, so the card is never empty.
  //
  // A key pressed mid-switch carries on from what is on screen, at the speed it is moving. Going back to the question
  // still leaving brings that copy back from where it is, while the live one turns into the leaving ghost. Going on to
  // another question keeps only the more visible of the two copies on screen as the one ghost, and the new question
  // comes in.
  const depart = (tab: number) => {
    if (!detailsRef || !listRef || !detailsFrame || !optionsTrack) return
    const v = tuning
    const step = Math.sign(tab - store.tab)
    const dir = root?.matches(":dir(rtl)") ? -step : step
    const reach = v.travel()
    const options = v.spring()
    const live = into ? arriving(into, v) : rest
    const moving = into ? speed(into) : 0
    const back = ghost?.tab === tab ? ghost : undefined
    const kept = !back && ghost && leaving(ghost, v, into).shown > live.shown ? ghost : undefined

    if (ghost && ghost !== kept) ghost.els.forEach((el) => el.remove())
    // A kept ghost leaves on the new switch's spring from where it is, so it fades no faster than the next question
    // arrives.
    ghost = kept
      ? { ...kept, ...track(leaving(kept, v, into), kept.to, speed(kept), options, v.launch()) }
      : {
          ...track(live, -dir * reach, moving, options, v.launch()),
          tab: store.tab,
          // The answers box scrolls back to the top for the new question, so the copy keeps its place on screen.
          els: [copy(detailsRef, detailsFrame), copy(listRef, optionsTrack, -scroll.top)],
          details: content.details,
          list: content.list,
          scroll: scroll.top,
        }
    into = back
      ? track(leaving(back, v, into), 0, speed(back), options, v.launch())
      : track({ x: dir * reach, shown: 0, settle: 0 }, 0, 0, options, v.launch())
  }

  const dropSwitch = () => {
    ghost?.els.forEach((el) => el.remove())
    ghost = undefined
    into = undefined
  }

  const paint = () => {
    const sliding = !!(into || ghost)

    const live = look(into ? arriving(into, tuning) : rest)

    ;[detailsRef, listRef].forEach((el) => el && place(el, live))

    if (ghost) {
      const pose = look(leaving(ghost, tuning, into))
      ghost.els.forEach((el) => place(el, pose))
    }

    const folded = Math.max(0, Math.min(1, boxes.folded.value))
    // Without motion the boxes keep their natural heights, so a new question lays out at its size on the same frame.
    const sized = questionMotion()

    if (detailsFrame && content.details > 0) {
      const shown = boxes.details.value
      detailsFrame.style.height = sized ? `${shown.toFixed(2)}px` : ""
      mask(detailsFrame, 0, Math.max(content.details, ghost?.details ?? 0) - shown, shown, sliding)
    }

    if (optionsRef && content.list > 0) {
      // Without motion the dock's max height caps the answers box, which scrolls inside the room it leaves.
      const shown = sized
        ? Math.min(boxes.list.value, room()) * (1 - folded)
        : folded > 0
          ? 0
          : Math.min(content.list, room())

      optionsRef.style.height = sized ? `${shown.toFixed(2)}px` : folded > 0 ? "0px" : ""
      scroll.view = shown
      feathers()
    }

    if (optionsRef) {
      optionsRef.style.opacity = folded > 0 ? (1 - folded).toFixed(4) : ""
      // Restoring shows the answers again at once, so the highlighted one can take focus.
      optionsRef.style.visibility = folded > 0.98 && boxes.folded.target > 0 ? "hidden" : ""
    }

    if (chevron) chevron.style.transform = folded > 0 ? `rotate(${(folded * 180).toFixed(2)}deg)` : ""

    if (pip) pip.style.transform = `translate3d(${bar.value.toFixed(2)}px,0,0)`

    paintFooter()
  }

  // The answers fade out at whichever edge has more of them past it, while they open or scroll.
  // It reads where the list is scrolled from the last scroll, never from layout, since it runs every frame.
  const feathers = () => {
    if (!optionsRef) return
    const above = scroll.top
    const shown = scroll.view
    mask(optionsRef, above, Math.max(content.list, ghost?.list ?? 0) - above - shown, shown, !!(into || ghost))
  }

  const paintFooter = () => {
    if (backBox) {
      const shown = unit(foot.back.value)
      const hidden = 1 - shown
      const x = foot.shift.value + (rtl ? -1 : 1) * footer.travel() * hidden
      const scale = 1 - (1 - tuning.scale()) * hidden
      const moving = !foot.back.resting || !foot.shift.resting
      backBox.style.transform = moving ? `translate3d(${x.toFixed(2)}px,0,0) scale(${scale.toFixed(4)})` : ""
      backBox.style.opacity = moving ? shown.toFixed(4) : ""
      backBox.style.filter =
        moving && tuning.blur() * hidden >= 0.05 ? `blur(${(tuning.blur() * hidden).toFixed(2)}px)` : ""
      backBox.style.visibility = moving ? "visible" : ""
    }

    if (!nextFace || !submitFace || !nextLabel || !submitLabel) return
    const s = unit(foot.submit.value)

    if (foot.submit.resting || !widths.next || !widths.submit) {
      ;[nextFace, submitFace, nextLabel, submitLabel].forEach((el) => el.removeAttribute("style"))

      return
    }

    // The wider face is cut back from its start edge to the width the button has reached.
    const width = widths.next + (widths.submit - widths.next) * s
    const wide = widths.submit > widths.next ? submitFace : nextFace
    const cut = Math.max(widths.next, widths.submit) - width
    const clip = cut < 0.5 ? "" : `inset(0 ${rtl ? cut.toFixed(2) : 0}px 0 ${rtl ? 0 : cut.toFixed(2)}px round 6px)`

    const by = footer.fade()
    showFace(nextFace, nextLabel, unit((1 - s) / by), unit(1 - s / by), nextFace === wide ? clip : "")
    showFace(submitFace, submitLabel, unit(s / by), unit(1 - (1 - s) / by), submitFace === wide ? clip : "")
  }

  const tick = (dt: number) => {
    into?.spring.step(dt)
    ghost?.spring.step(dt)
    boxes.details.step(dt)
    boxes.list.step(dt)
    boxes.folded.step(dt)
    bar.step(dt)
    Object.values(foot).forEach((spring) => spring.step(dt))

    if (into?.spring.resting) into = undefined

    if (ghost && leaving(ghost, tuning, into).shown <= 0) {
      ghost.els.forEach((el) => el.remove())
      ghost = undefined
    }

    paint()

    const footing = Object.values(foot).some((spring) => !spring.resting)

    if (
      into ||
      ghost ||
      footing ||
      !bar.resting ||
      !boxes.details.resting ||
      !boxes.list.resting ||
      !boxes.folded.resting
    )
      return true
    stop = undefined
    requestMeasure()

    return false
  }

  const wake = () => {
    if (!questionMotion()) return still()
    stop ??= frameLoop.add(tick)
  }

  // Everything lands where it is going, now: no frame job runs.
  const still = () => {
    stop?.()
    stop = undefined
    dropSwitch()
    ;[...Object.values(boxes), ...Object.values(foot), bar].forEach((spring) => spring.snap(spring.target))
    paint()
  }

  // Turning the knob off also lands any running pick or dash transition.
  createEffect(() => {
    if (questionMotion()) return
    still()
    root?.getAnimations({ subtree: true }).forEach((animation) => animation.cancel())
  })
  onCleanup(() => stop?.())

  const jump = (tab: number) => {
    if (sending() || tab === store.tab) return
    const animate = !store.minimized && questionMotion()

    if (animate) depart(tab)
    else dropSwitch()

    rtl = !!root?.matches(":dir(rtl)")
    widths.next = nextFace?.offsetWidth ?? 0
    widths.submit = submitFace?.offsetWidth ?? 0
    const before = backBox?.offsetLeft ?? 0
    // The highlight's index moves before the question does, so it lands on the new question's answer instead of
    // gliding from the old one.
    batch(() => {
      setStore("focus", pickFocus(tab))

      if (lit() === "hover") setLit("none")
      setStore("tab", tab)
      setStore("editing", false)
    })
    optsRef.length = options().length

    if (optionsRef) optionsRef.scrollTop = scroll.top = 0

    const reduced = !questionMotion()

    if (reduced) bar.snap(dash(tab))
    else tune(bar, tuning.spring()).set(dash(tab))

    // Back stays where it was on screen while the button beside it changes width, and slides to its new place.
    foot.shift.value += before - (backBox?.offsetLeft ?? 0)

    const targets = { back: tab > 0 ? 1 : 0, submit: tab >= total() - 1 ? 1 : 0, shift: 0 }

    ;(["back", "submit", "shift"] as const).forEach((key) => {
      if (reduced) foot[key].snap(targets[key])
      else tune(foot[key], footer.spring()).set(targets[key])
    })
    // The first frame is painted now, so the new question never shows at rest before it arrives.
    paint()

    if (store.minimized) {
      // A button that just gave way to the other one can no longer hold focus.
      if (document.activeElement?.closest("[inert]")) (last() ? submitFace : nextFace)?.querySelector("button")?.focus()
      wake()

      return
    }

    // The answers box is still springing to the new list's height, so the answer that takes focus comes into view of
    // the height it will rest at.
    focus(pickFocus(tab), { preventScroll: true })

    if (optionsRef && detailsRef)
      reveal(rowAt(store.focus), Math.min(optionsRef.scrollHeight, settled(detailsRef.offsetHeight)))

    wake()
  }

  const cycle = (by: number) => {
    if (total() < 2) return
    jump((store.tab + by + total()) % total())
  }

  onCleanup(
    motionTuning.action({ id: "question.next", label: "Next question", group, subsection, run: () => cycle(1) }),
  )
  onCleanup(
    motionTuning.action({ id: "question.back", label: "Previous question", group, subsection, run: () => cycle(-1) }),
  )

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
    fold(1)
  }

  const restore = () => {
    if (sending()) return
    setStore("minimized", false)
    fold(0)
    paint()
    // The answers box is still opening, so its answer comes into view of the height it will rest at.
    const index = pickFocus()
    focus(index, { preventScroll: true })

    if (detailsRef) reveal(rowAt(index), Math.min(content.list, settled(detailsRef.offsetHeight)))
  }

  const fold = (target: number) => {
    tune(boxes.folded, minimizing).set(target)
    wake()
  }

  return (
    <div data-component="session-question-dock" data-animated={questionMotion()}>
      <DockPrompt
        kind="question"
        ref={(el) => (root = el)}
        onKeyDown={nav}
        header={
          <>
            <div data-slot="question-header-top">
              <div data-slot="question-header-title">
                <bdi>
                  {summary()[0]}
                  <Show when={summary().length > 1}>
                    <Show when={questionMotion()} fallback={current()}>
                      <RollingNumber value={current()} spring={tuning.spring()} />
                    </Show>
                    {summary().slice(1).join("")}
                  </Show>
                </bdi>
              </div>
              <div data-slot="question-header-actions">
                <Show when={total() > 1}>
                  <div data-slot="question-progress">
                    {/* Without motion there is no sliding bar: the current question's dash lights instead. */}
                    <Show when={questionMotion()}>
                      <div data-slot="question-progress-track" aria-hidden="true">
                        <span
                          data-slot="question-progress-current"
                          ref={(el) => {
                            pip = el
                            onCleanup(() => (pip = undefined))
                            // Dashes have their places once the row is laid out.
                            queueMicrotask(() => {
                              bar.snap(dash(store.tab))
                              paint()
                            })
                          }}
                        />
                      </div>
                    </Show>
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
                          <span data-slot="question-progress-bar" aria-hidden="true" ref={(el) => (dashes[i()] = el)} />
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <IconButton
                  ref={(el: HTMLButtonElement) => (chevron = el)}
                  icon={<Icon name="outline-chevron-down" size="normal" />}
                  variant="ghost"
                  size="large"
                  disabled={sending()}
                  onClick={store.minimized ? restore : minimize}
                  aria-label={language.t(store.minimized ? "session.question.restore" : "session.question.minimize")}
                />
              </div>
            </div>
            <div data-slot="question-details-frame" ref={(el) => (detailsFrame = el)}>
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
            </div>
          </>
        }
        footer={
          <>
            <Button variant="ghost" size="large" disabled={sending()} onClick={reject} aria-keyshortcuts="Escape">
              {language.t("ui.common.dismiss")}
            </Button>
            <div data-slot="question-footer-actions">
              {/* Back stays in place while hidden, so it can come and go without moving anything. */}
              <div
                data-slot="question-footer-back"
                data-shown={store.tab > 0}
                inert={store.tab === 0}
                ref={(el) => (backBox = el)}
              >
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
              </div>
              {/* Next and Submit share one place and one tooltip; the one not in use lies under it, inert. */}
              <Tooltip
                placement="top"
                value={
                  <>
                    {last() ? language.t("ui.common.submit") : language.t("ui.common.next")}
                    <span style={{ opacity: 0.6 }}>{submitShortcut()}</span>
                  </>
                }
              >
                <div data-slot="question-advance">
                  <div
                    data-slot="question-advance-face"
                    data-active={!last()}
                    inert={last()}
                    ref={(el) => (nextFace = el)}
                  >
                    <Button
                      variant="neutral"
                      size="large"
                      disabled={sending()}
                      onClick={next}
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                    >
                      <span data-slot="question-advance-label" ref={(el) => (nextLabel = el)}>
                        {language.t("ui.common.next")}
                        <span data-slot="question-submit-shortcut" aria-hidden="true">
                          {submitShortcut()}
                        </span>
                      </span>
                    </Button>
                  </div>
                  <div
                    data-slot="question-advance-face"
                    data-active={last()}
                    inert={!last()}
                    ref={(el) => (submitFace = el)}
                  >
                    <Button
                      variant="submit"
                      size="large"
                      disabled={sending()}
                      onClick={next}
                      aria-keyshortcuts="Meta+Enter Control+Enter"
                    >
                      <span data-slot="question-advance-label" ref={(el) => (submitLabel = el)}>
                        {language.t("ui.common.submit")}
                        <span data-slot="question-submit-shortcut" aria-hidden="true">
                          {submitShortcut()}
                        </span>
                      </span>
                    </Button>
                  </div>
                </div>
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
          aria-hidden={store.minimized ? "true" : undefined}
          onScroll={(event) => {
            scroll.top = event.currentTarget.scrollTop
            pin()
            feathers()
          }}
          // Space already acted on key down; its release must not click the button again.
          onKeyUp={(event) => {
            if (event.key !== " ") return
            const where = zone(event.target)

            if (where === "option" || where === "custom") event.preventDefault()
          }}
        >
          <div data-slot="question-options-track" ref={(el) => (optionsTrack = el)}>
            <div
              data-slot="question-options-list"
              ref={(el) => (listRef = el)}
              onPointerDown={(event) => setLit(event.pointerType === "mouse" ? "hover" : "none")}
              onPointerLeave={() => {
                pointer = { x: -1, y: -1 }

                if (lit() === "hover") setLit("none")
              }}
            >
              <span
                data-slot="question-highlight"
                data-shown={lit() !== "none"}
                ref={(el) => (highlightRef = el)}
                aria-hidden="true"
              />
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
                <textarea
                  ref={(el) => {
                    customInput = el
                    resizeInput(el)
                  }}
                  class="question-custom-field"
                  rows={1}
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

                    if (e.key !== "Enter" || e.shiftKey) return
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
        </div>
      </DockPrompt>
    </div>
  )
}

// Comes into place from where it set off, fully shown by the fade-in point, which is never after the fade-out point, so
// the two copies together always show at least one whole question. It sharpens and grows over the whole spring.
function arriving(track: Track, v: Tuning): Pose {
  const p = unit(track.spring.value)

  return {
    x: track.from.x + (track.to - track.from.x) * p,
    shown: track.from.shown + (1 - track.from.shown) * unit(p / Math.min(v.fadeIn(), v.fadeOut())),
    settle: track.from.settle + (1 - track.from.settle) * p,
  }
}

// Leaves from where it set off, fully gone by the fade-out point, but never fading faster than `next` arrives, so a
// copy kept through rapid keys holds the card until the new question has caught up.
function leaving(track: Track, v: Tuning, next?: Track): Pose {
  const p = unit(track.spring.value)
  const gone = unit(p / v.fadeOut())
  const arrived = next ? arriving(next, v).shown : 1

  return {
    x: track.from.x + (track.to - track.from.x) * p,
    shown: Math.max(track.from.shown * (1 - gone), Math.min(track.from.shown, 1 - arrived)),
    settle: track.from.settle * (1 - gone),
  }
}

function unit(value: number) {
  return Math.max(0, Math.min(1, value))
}

function speed(track: Track) {
  return (track.to - track.from.x) * track.spring.velocity
}

// Sets off from `from` at the speed it already had on screen, plus the key's launch. The start is capped at the
// spring's natural speed so it never overshoots its place.
function track(from: Pose, to: number, moving: number, options: DurationOptions, launch: number): Track {
  const spring = Spring.fromDuration(0, options)
  const distance = to - from.x
  const carried = Math.abs(distance) < 0.5 ? 0 : moving / distance

  return {
    from,
    to,
    spring: spring.set(1, { velocity: Math.min(spring.omega, carried + spring.omega * launch) }),
  }
}

type Look = { transform: string; opacity: string; blur: number }

// How a copy in `pose` is drawn: it blurs and shrinks toward the top of the card as it goes.
function look(pose: Pose): Look {
  const unsettled = 1 - pose.settle
  const scale = 1 - (1 - tuning.scale()) * unsettled
  const blur = tuning.blur() * unsettled
  const moved = Math.abs(pose.x) >= 0.01 || scale < 0.9999

  return {
    transform: moved ? `translate3d(${pose.x.toFixed(2)}px,0,0) scale(${scale.toFixed(4)})` : "",
    opacity: pose.shown >= 1 ? "" : pose.shown.toFixed(4),
    blur: blur < 0.05 ? 0 : blur,
  }
}

function tune(spring: Spring, options: DurationOptions) {
  spring.omega = (2 * Math.PI) / options.duration
  spring.zeta = 1 - options.bounce

  return spring
}

// The label's opacity is relative to its face's, which already applies.
function showFace(face: HTMLElement, label: HTMLElement, opacity: number, shown: number, clip: string) {
  face.style.visibility = "visible"
  face.style.opacity = opacity.toFixed(4)
  face.style.clipPath = clip
  label.style.opacity = opacity > 0 ? Math.min(1, shown / opacity).toFixed(4) : "0"
  label.style.filter = shown < 0.98 ? `blur(${(tuning.blur() * (1 - shown)).toFixed(2)}px)` : ""
}

function place(el: HTMLElement, look: Look) {
  el.style.transform = look.transform
  el.style.opacity = look.opacity
  el.style.filter = look.blur === 0 ? "" : `blur(${look.blur.toFixed(2)}px)`
}

// While a switch is under way, content sliding into a box's side gutters fades out there. While a box is shorter than
// what it holds, its bottom fades instead of ending hard, over no more than a third of the box.
function mask(el: HTMLElement, above: number, below: number, shown: number, sliding: boolean) {
  const top = Math.min(feather, above, shown / 3)
  const bottom = Math.min(feather, below, shown / 3)

  const layers = [
    sliding
      ? "linear-gradient(to right, transparent, #000 var(--question-gutter), #000 calc(100% - var(--question-gutter)), transparent)"
      : "",
    top > 0.5 ? `linear-gradient(to bottom, transparent, #000 ${top.toFixed(2)}px)` : "",
    bottom > 0.5 ? `linear-gradient(to top, transparent, #000 ${bottom.toFixed(2)}px)` : "",
  ].filter(Boolean)

  if (layers.length === 0) return el.style.removeProperty("mask-image")
  el.style.setProperty("mask-image", layers.join(", "))
}

// A still copy of `el` laid over it in `host`, after the live content so it never comes first in the DOM, inert and
// hidden from assistive tech. Ids are dropped so they stay unique, and typed text is carried over.
function copy(el: HTMLElement, host: HTMLElement, top = 0) {
  // SAFETY: a deep clone of an element is an element of the same kind.
  const clone = el.cloneNode(true) as HTMLElement
  clone.removeAttribute("id")
  clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"))
  // The answer highlight jumps; the leaving copy never carries a second one off with it.
  clone.querySelector('[data-slot="question-highlight"]')?.remove()
  const inputs = el.querySelectorAll("input")
  clone.querySelectorAll("input").forEach((input, index) => (input.value = inputs[index]?.value ?? ""))
  clone.dataset.ghost = "true"
  clone.inert = true
  clone.setAttribute("aria-hidden", "true")
  clone.style.position = "absolute"
  clone.style.top = `${top}px`
  clone.style.insetInline = "var(--question-gutter)"
  clone.style.pointerEvents = "none"
  host.append(clone)

  return clone
}

// The nearest of `el` and its ancestors that has a height.
function bounds(el: Element | null | undefined): DOMRect | undefined {
  if (!el) return undefined
  const rect = el.getBoundingClientRect()

  return rect.height >= 1 ? rect : bounds(el.parentElement)
}
