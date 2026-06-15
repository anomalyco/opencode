import { For, Show, createMemo, createSignal, createEffect, on as onDep, onCleanup, onMount, type Component } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { QuestionRequest } from "@opencode-ai/sdk/v2"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { useParentParams } from "@/context/parent-params"
import { useClientEnv } from "@/context/client-env"
import { label } from "@/components/blocksuite/actor"
import { loadActor, saveActor } from "@/components/prompt-input/doc-actor"
import { DialogDocSubmit, type DocSubmitKind } from "@/components/doc-submit/dialog-doc-submit"
import {
  connectQuestionDraft,
  connectQuestionSubmit,
  respondQuestionSubmit,
  startQuestionSubmit,
  type DocSubmitState,
  type QuestionDraftChannel,
  type QuestionDraftOp,
  type QuestionPresenceEntry,
} from "@/components/prompt-input/doc-submit"

type Actor = { actorID: string; name: string; color: string }

// `picked` = this participant's own choice (strong). `soft` = only OTHERS picked it (muted/gray).
function Mark(props: { multi: boolean; picked: boolean; soft?: boolean; onClick?: (event: MouseEvent) => void }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true" onClick={props.onClick}>
      <span
        data-slot="question-option-box"
        data-type={props.multi ? "checkbox" : "radio"}
        data-picked={props.picked}
        data-soft={props.soft && !props.picked ? true : undefined}
      >
        <Show when={props.multi} fallback={<span data-slot="question-option-radio-dot" />}>
          <Icon name="check-small" size="small" />
        </Show>
      </span>
    </span>
  )
}

// Small attributed presence chips so everyone sees who currently has an option selected.
function Avatars(props: { items: { actorID: string; name: string; color: string }[] }) {
  return (
    <Show when={props.items.length > 0}>
      <span data-slot="question-option-avatars" aria-hidden="true">
        <For each={props.items}>
          {(item) => (
            <span
              data-slot="question-option-avatar"
              title={item.name}
              style={{ "background-color": item.color }}
            >
              {((item.name || "?").trim().slice(-2) || "?").toUpperCase()}
            </span>
          )}
        </For>
      </span>
    </Show>
  )
}

function Option(props: {
  multi: boolean
  picked: boolean
  soft: boolean
  label: string
  description?: string
  disabled: boolean
  avatars: { actorID: string; name: string; color: string }[]
  onClick: VoidFunction
}) {
  return (
    <button
      type="button"
      data-slot="question-option"
      data-picked={props.picked}
      data-soft={props.soft && !props.picked ? true : undefined}
      role={props.multi ? "checkbox" : "radio"}
      aria-checked={props.picked}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Mark multi={props.multi} picked={props.picked} soft={props.soft} />
      <span data-slot="question-option-main">
        <span data-slot="option-label">{props.label}</span>
        <Show when={props.description}>
          <span data-slot="option-description">{props.description}</span>
        </Show>
      </span>
      <Avatars items={props.avatars} />
    </button>
  )
}

export const SessionQuestionDock: Component<{ request: QuestionRequest; onSubmit: () => void }> = (props) => {
  const sdk = useSDK()
  const language = useLanguage()
  const dialog = useDialog()
  const parentParams = useParentParams()
  const clientEnv = useClientEnv()

  const sessionID = props.request.sessionID
  const requestID = props.request.id
  const questions = createMemo(() => props.request.questions)
  const total = createMemo(() => questions().length)

  // Navigation + edit cursor stay LOCAL — each participant browses freely.
  const [tab, setTab] = createSignal(0)
  const [editing, setEditing] = createSignal(false)
  // While my custom textarea is open, it binds to this LOCAL buffer — not the shared draft — so the
  // server echo never resets the value mid-keystroke (which broke Korean IME composition). The
  // shared text is still pushed out on every input; remote edits are adopted only when not editing.
  const [localText, setLocalText] = createSignal("")

  // The shared answer draft is authoritative on the server; this mirrors the last broadcast.
  const [draft, setDraft] = createStore<{
    answers: string[][]
    custom: string[]
    customOn: boolean[]
    step: number
    rev: number
  }>({
    answers: [],
    custom: [],
    customOn: [],
    step: 0,
    rev: -1,
  })
  // Each participant's own PREDEFINED selections on their tab (custom is tracked separately below).
  const [mine, setMine] = createStore<string[][]>([])
  // Whether I have the custom option selected — per-person, independent of the (shared) text, and
  // broadcast via presence.customFocused so others see me selected even before any text is typed.
  const [myCustomOn, setMyCustomOn] = createStore<boolean[]>([])
  const [presence, setPresence] = createSignal<QuestionPresenceEntry[]>([])
  const [actor, setActor] = createSignal<Actor>()

  let channel: QuestionDraftChannel | undefined
  let root: HTMLDivElement | undefined
  // Live ref + IME state for the custom textarea so remote edits can be applied imperatively
  // without clobbering an in-progress Korean composition.
  let customField: HTMLTextAreaElement | undefined
  let composing = false

  const question = createMemo(() => questions()[tab()])
  const options = createMemo(() => question()?.options ?? [])
  const multi = createMemo(() => question()?.multiple === true)
  // Custom text is SHARED (collaborative simultaneous editing); the on-state is per-person.
  const input = createMemo(() => draft.custom[tab()] ?? "")
  const on = createMemo(() => myCustomOn[tab()] === true)

  // A participant's effective answer for question `i`: their predefined picks plus the shared custom
  // text when they have custom selected (and the text is non-empty). Drives the gate and submit.
  const effective = (i: number, predefined: string[], customOn: boolean) => {
    const text = draft.custom[i] ?? ""
    return customOn && text.trim() ? [...predefined, text] : predefined
  }
  const last = createMemo(() => tab() >= total() - 1)

  const customLabel = () => language.t("ui.messagePart.option.typeOwnAnswer")
  const customPlaceholder = () => language.t("ui.question.custom.placeholder")
  const summary = createMemo(() =>
    language.t("session.question.progress", { current: Math.min(tab() + 1, total()), total: total() }),
  )

  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    showToast({ title: language.t("common.requestFailed"), description: message })
  }

  // ── Presence ────────────────────────────────────────────────────────────────────────────────
  const broadcastPresence = () => {
    const a = actor()
    if (!a || !channel) return
    channel.sendPresence({
      actorID: a.actorID,
      name: a.name,
      color: a.color,
      qIndex: tab(),
      selection: mine[tab()] ?? [],
      // Repurposed: "this participant currently has the custom option selected".
      customFocused: myCustomOn[tab()] === true,
    })
  }
  createEffect(() => {
    // Re-broadcast whenever this participant's tab, predefined picks, or custom-on state changes.
    tab()
    void mine[tab()]
    void myCustomOn[tab()]
    broadcastPresence()
  })
  // Navigation is group-synced: follow the shared step the moment the server broadcasts a change.
  // Track only draft.step (via `on`) so an optimistic local `goto` isn't reverted by the stale step.
  createEffect(
    onDep(
      () => draft.step,
      (step) => {
        if (step === tab()) return
        setTab(step)
        setEditing(false)
      },
    ),
  )
  // Seed the local textarea buffer from the shared text whenever I open the editor.
  createEffect(
    onDep(
      () => editing(),
      (isEditing) => {
        if (isEditing) {
          setLocalText(draft.custom[tab()] ?? "")
        } else {
          customField = undefined
        }
      },
    ),
  )
  // Live collaborative editing: apply remote text changes into the open textarea imperatively, but
  // never while the user is mid-IME-composition, and never when it already matches (my own echo).
  createEffect(() => {
    const text = draft.custom[tab()] ?? ""
    if (!editing()) return
    const el = customField
    if (!el || composing || el.value === text) return
    const start = el.selectionStart
    const end = el.selectionEnd
    el.value = text
    setLocalText(text)
    resizeInput(el)
    try {
      el.setSelectionRange(Math.min(start, text.length), Math.min(end, text.length))
    } catch {
      // setSelectionRange can throw on detached nodes — safe to ignore.
    }
  })

  // Everyone (including me) who has this option selected on the current tab — me sorted first.
  const avatarsFor = (optLabel: string) => {
    const self = actor()?.actorID
    return presence()
      .filter((item) => item.qIndex === tab() && item.selection.includes(optLabel))
      .map((item) => ({ actorID: item.actorID, name: item.name, color: item.color }))
      .sort((a, b) => (a.actorID === self ? -1 : b.actorID === self ? 1 : 0))
  }

  // Some OTHER participant has this option selected on the current tab (drives the muted radio).
  const othersPicked = (optLabel: string) =>
    presence().some(
      (item) => item.actorID !== actor()?.actorID && item.qIndex === tab() && item.selection.includes(optLabel),
    )

  // Who has the custom option selected on the current tab (presence.customFocused), self reflecting
  // my live `on()`. Independent of whether any text has been typed.
  const customSelectors = () => {
    const self = actor()
    const list = presence()
      .filter((item) => item.qIndex === tab())
      .map((item) => ({
        actorID: item.actorID,
        name: item.name,
        color: item.color,
        on: item.actorID === self?.actorID ? on() : item.customFocused,
      }))
      .filter((item) => item.on)
    if (self && on() && !list.some((item) => item.actorID === self.actorID))
      list.unshift({ actorID: self.actorID, name: self.name, color: self.color, on: true })
    return list.sort((a, b) => (a.actorID === self?.actorID ? -1 : b.actorID === self?.actorID ? 1 : 0))
  }
  // Everyone (including me) who has custom selected — me sorted first (for the avatar chips).
  const customAvatars = () => customSelectors().map(({ actorID, name, color }) => ({ actorID, name, color }))
  // Some OTHER participant has custom selected (drives the custom option's muted radio).
  const othersCustom = () => customSelectors().some((item) => item.actorID !== actor()?.actorID)

  // Other participants (not me) currently viewing question `index` — shown stacked above its segment.
  const othersOnTab = (index: number) =>
    presence()
      .filter((item) => item.actorID !== actor()?.actorID && item.qIndex === index)
      .map((item) => ({ actorID: item.actorID, name: item.name, color: item.color }))

  // ── Draft ops ───────────────────────────────────────────────────────────────────────────────
  const sendOp = (op: QuestionDraftOp) => channel?.sendOp(op)

  // The strong radio reflects MY own selection (not the shared last-writer draft).
  const picked = (answer: string) => mine[tab()]?.includes(answer) ?? false

  const pick = (answer: string) => {
    setMine(tab(), [answer])
    setMyCustomOn(tab(), false) // single-select: choosing a predefined option drops my custom answer
    sendOp({ kind: "single", q: tab(), value: answer })
    setEditing(false)
  }

  const toggle = (answer: string) => {
    const next = !(mine[tab()]?.includes(answer) ?? false)
    setMine(tab(), (current = []) => (next ? [...current.filter((x) => x !== answer), answer] : current.filter((x) => x !== answer)))
    sendOp({ kind: "toggle", q: tab(), label: answer, on: next })
  }

  // Custom: the on-state is per-person (myCustomOn); the text is shared (broadcast via the custom op
  // so everyone co-edits the same field). For single-select, selecting custom drops my predefined pick.
  const customUpdate = (value: string, selected: boolean = on()) => {
    setMyCustomOn(tab(), selected)
    if (selected && !multi()) setMine(tab(), [])
    sendOp({ kind: "custom", q: tab(), text: value, on: selected, multi: multi() })
  }

  const customToggle = () => {
    if (busy()) return
    if (!multi()) {
      setEditing(true)
      customUpdate(input(), true)
      return
    }
    const next = !on()
    setEditing(next)
    customUpdate(input(), next)
  }

  const customOpen = () => {
    if (busy()) return
    setEditing(true)
    customUpdate(input(), true)
  }

  const commitCustom = () => {
    customUpdate(localText())
    setEditing(false)
  }

  const selectOption = (optIndex: number) => {
    if (busy()) return
    if (optIndex === options().length) {
      customOpen()
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

  // Answered = I have a non-empty effective selection (predefined pick, or custom with shared text).
  const answered = (i: number) => effective(i, mine[i] ?? [], myCustomOn[i] ?? false).length > 0

  // ── Unanimity gate ───────────────────────────────────────────────────────────────────────────
  // Next/Submit unlocks only when every participant on the current question has picked the SAME
  // (non-empty) answer. Order-independent compare covers both single- and multi-select. Solo ⇒
  // simply "I answered". My own latest pick (`mine`) is used directly so the gate doesn't lag a
  // presence round-trip.
  const selectionKey = (selection: string[]) => [...selection].sort().join("\u0000")
  const mineEffective = () => effective(tab(), mine[tab()] ?? [], on())
  const consensus = createMemo(() => {
    const self = actor()?.actorID
    const here = presence().filter((item) => item.qIndex === tab())
    const selections = here.map((item) =>
      item.actorID === self ? mineEffective() : effective(tab(), item.selection, item.customFocused),
    )
    if (self && !here.some((item) => item.actorID === self)) selections.push(mineEffective())
    if (selections.length === 0) return false
    const keys = selections.map(selectionKey)
    if (keys.some((key) => key === "")) return false
    return keys.every((key) => key === keys[0])
  })

  // ── Consent (send / dismiss) ────────────────────────────────────────────────────────────────
  const [approval, setApproval] = createSignal<DocSubmitState>()
  const [voteKind, setVoteKind] = createSignal<DocSubmitKind>("question-send")
  const [pendingSend, setPendingSend] = createSignal(false)
  // Direct question reply in flight (replaces the old send-consent vote).
  const [submitting, setSubmitting] = createSignal(false)
  let approvalID: string | undefined
  let finalizedID: string | undefined

  const sending = createMemo(() => pendingSend() || approval()?.status === "pending")
  // Any in-flight action that should freeze the dock's controls.
  const busy = createMemo(() => sending() || submitting())

  // What the consent dialog shows. A back vote shows just the question we'd return to; a dismiss
  // shows every question (no answers); a send would show each question + its agreed answer.
  const previewItems = () => {
    if (voteKind() === "question-back") {
      const target = questions()[Math.max(0, tab() - 1)]
      return target ? [{ question: target.question, answers: [] }] : []
    }
    return questions().map((q, i) => ({
      question: q.question,
      answers: voteKind() === "question-dismiss" ? [] : (draft.answers[i] ?? []),
    }))
  }

  const closeApproval = () => {
    dialog.close()
    approvalID = undefined
    setApproval(undefined)
  }

  const showApproval = (state: DocSubmitState) => {
    const a = actor()
    if (!a) return
    if (!state.actors.some((item) => item.actorID === a.actorID)) return
    // Show the right copy even for participants who did not start the vote.
    if (state.questionAction)
      setVoteKind(
        state.questionAction === "dismiss"
          ? "question-dismiss"
          : state.questionAction === "back"
            ? "question-back"
            : "question-send",
      )
    // Terminal states handled exactly once: a reconnect replay must not re-open or re-fire.
    if (state.status !== "pending") {
      if (finalizedID === state.submitID) return
      finalizedID = state.submitID
    }
    if (state.status === "sent") {
      if (approvalID === state.submitID) closeApproval()
      props.onSubmit()
      return
    }
    setApproval(state)
    if (approvalID === state.submitID) return
    approvalID = state.submitID
    dialog.show(
      () => (
        <DialogDocSubmit
          state={approval}
          actorID={a.actorID}
          kind={voteKind()}
          preview={previewItems}
          approve={() => {
            const current = approval()
            if (!current) return
            void respondQuestionSubmit({
              baseUrl: sdk.url,
              directory: sdk.directory,
              sessionID,
              submitID: current.submitID,
              actorID: a.actorID,
              action: "approve",
            })
              .then(setApproval)
              .catch(() => showToast({ title: "전송 동의 실패", description: language.t("common.requestFailed") }))
          }}
          cancel={() => {
            const current = approval()
            if (!current) return
            void respondQuestionSubmit({
              baseUrl: sdk.url,
              directory: sdk.directory,
              sessionID,
              submitID: current.submitID,
              actorID: a.actorID,
              action: "cancel",
            })
              .then(setApproval)
              .catch(() => showToast({ title: "전송 동의 취소 실패", description: language.t("common.requestFailed") }))
          }}
          close={closeApproval}
        />
      ),
      () => {
        const current = approval()
        if (current?.status === "pending") {
          approvalID = undefined
          window.setTimeout(() => {
            const next = approval()
            if (next?.status === "pending") showApproval(next)
          }, 120)
          return
        }
        approvalID = undefined
        setApproval(undefined)
      },
    )
  }

  const roster = () => {
    const a = actor()
    const names: Record<string, string> = {}
    const ids = new Set<string>()
    if (a) {
      ids.add(a.actorID)
      if (a.name && a.name !== a.actorID) names[a.actorID] = a.name
    }
    for (const item of presence()) {
      ids.add(item.actorID)
      if (item.name && item.name !== item.actorID) names[item.actorID] = item.name
    }
    return { actorIDs: Array.from(ids), names }
  }

  const startVote = async (kind: DocSubmitKind, payload: { answers?: string[][]; reject?: boolean; step?: number }) => {
    const a = actor()
    if (!a || sending()) return
    setVoteKind(kind)
    setPendingSend(true)
    try {
      const { actorIDs, names } = roster()
      const state = await startQuestionSubmit({
        baseUrl: sdk.url,
        directory: sdk.directory,
        sessionID,
        requestID,
        actorID: a.actorID,
        actorIDs,
        names,
        payload: { requestID, ...payload },
      })
      showApproval(state)
    } catch (err) {
      fail(err)
    } finally {
      setPendingSend(false)
    }
  }

  // No consent vote: the gate already guarantees unanimity, so the first press replies directly to
  // the AI (resolving the question for everyone). Uses the shared draft, which holds the agreed
  // answers (unanimous ⇒ last-writer value == everyone's).
  const submit = async () => {
    if (submitting()) return
    if (editing()) commitCustom()
    setSubmitting(true)
    try {
      // The app SDK client is configured with throwOnError, so a failed reply rejects here.
      // Use my own effective selections: the gate guarantees unanimity, so mine == everyone's.
      await sdk.client.question.reply({
        requestID,
        directory: sdk.directory,
        answers: questions().map((_, i) => effective(i, mine[i] ?? [], myCustomOn[i] ?? false)),
      })
      props.onSubmit()
    } catch (err) {
      setSubmitting(false)
      fail(err)
    }
  }

  const dismiss = () => void startVote("question-dismiss", { reject: true })

  // ── Navigation (group-synced via the shared draft `step`) ─────────────────────────────────────
  const goto = (value: number) => {
    const clamped = Math.max(0, Math.min(total() - 1, value))
    sendOp({ kind: "step", value: clamped })
    setTab(clamped) // optimistic; the server echo confirms for everyone
    setEditing(false)
  }
  const next = () => {
    if (busy()) return
    if (editing()) commitCustom()
    if (last()) {
      void submit()
      return
    }
    goto(tab() + 1)
  }
  // Going back needs group consent (like send/dismiss): on approval the server moves the shared step.
  const back = () => {
    if (busy() || tab() <= 0) return
    void startVote("question-back", { step: tab() - 1 })
  }
  const jump = (value: number) => {
    if (busy()) return
    // Forward movement must pass through the gated Next; only review backward / answered questions.
    if (value > tab() && !answered(value)) return
    goto(value)
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────
  let disposed = false
  const init = async () => {
    const user = parentParams.user[0]
    const stored = loadActor(sessionID, user?.id)
    // The dock mounts before the server may be reachable; without retry the actor registration would
    // fail once and the dock would stay dead until a manual reload. Back off until it succeeds or the
    // dock is torn down.
    let a: Awaited<ReturnType<typeof sdk.client.session.actor.upsert>>["data"] | undefined
    let delay = 500
    while (!disposed) {
      try {
        const res = await sdk.client.session.actor.upsert({
          sessionID,
          directory: sdk.directory,
          ...(stored ? { actorID: stored } : {}),
          ...(user ? { userID: user.id, name: user.name } : {}),
        })
        a = res.data
        if (a) break
      } catch {
        // fall through to backoff
      }
      await new Promise<void>((r) => setTimeout(r, delay))
      delay = Math.min(delay * 2, 8000)
    }
    if (disposed || !a) return
    saveActor(sessionID, a.actorID, user?.id)
    setActor({ actorID: a.actorID, name: label(a.actorID, a.name), color: a.color })

    channel = connectQuestionDraft({
      baseUrl: sdk.url,
      directory: sdk.directory,
      sessionID,
      requestID,
      actorID: a.actorID,
      onDraft: (d) => setDraft({ answers: d.answers, custom: d.custom, customOn: d.customOn, step: d.step ?? 0, rev: d.rev }),
      onPresence: (list) => setPresence(list),
    })
    broadcastPresence()

    const stopVote = connectQuestionSubmit({
      baseUrl: sdk.url,
      directory: sdk.directory,
      sessionID,
      requestID,
      actorID: a.actorID,
      event: (event) => showApproval(event.state),
    })
    onCleanup(stopVote)
  }

  onMount(() => void init().catch(fail))
  onCleanup(() => {
    disposed = true
    channel?.close()
  })

  // Keep the dock from overflowing the prompt area (matches the previous local-state behavior).
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
    const dock = root.closest('[data-component="session-prompt-dock"]')
    if (!(dock instanceof HTMLElement)) return
    const dockBottom = dock.getBoundingClientRect().bottom
    const below = Math.max(0, dockBottom - root.getBoundingClientRect().bottom)
    const max = Math.max(240, Math.floor(dockBottom - top - 8 - below))
    root.style.setProperty("--question-prompt-max-height", `${max}px`)
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
    window.addEventListener("resize", update)
    const dock = root?.closest('[data-component="session-prompt-dock"]')
    const scroller = document.querySelector(".scroll-view__viewport")
    const observer = new ResizeObserver(update)
    if (dock instanceof HTMLElement) observer.observe(dock)
    if (scroller instanceof HTMLElement) observer.observe(scroller)
    onCleanup(() => {
      window.removeEventListener("resize", update)
      observer.disconnect()
      if (raf !== undefined) cancelAnimationFrame(raf)
    })
  })

  const resizeInput = (el: HTMLTextAreaElement) => {
    el.style.height = "0px"
    el.style.height = `${el.scrollHeight}px`
  }
  const focusCustom = (el: HTMLTextAreaElement) => {
    // Seed once from the shared text; remote edits are applied imperatively by the effect below.
    customField = el
    el.value = draft.custom[tab()] ?? ""
    setTimeout(() => {
      el.focus()
      resizeInput(el)
    }, 0)
  }
  const toggleCustomMark = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    customToggle()
  }

  return (
    <DockPrompt
      kind="question"
      ref={(el) => (root = el)}
      header={
        <>
          <div data-slot="question-header-title">{summary()}</div>
          <div data-slot="question-progress">
            <For each={questions()}>
              {(_, i) => (
                <button
                  type="button"
                  data-slot="question-progress-segment"
                  data-active={i() === tab()}
                  data-answered={answered(i())}
                  disabled={busy()}
                  onClick={() => jump(i())}
                  aria-label={`${language.t("ui.tool.questions")} ${i() + 1}`}
                >
                  <Show when={othersOnTab(i()).length > 0}>
                    <span data-slot="question-progress-presence" aria-hidden="true">
                      <For each={othersOnTab(i())}>
                        {(item) => (
                          <span
                            data-slot="question-progress-dot"
                            title={item.name}
                            style={{ "background-color": item.color }}
                          />
                        )}
                      </For>
                    </span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </>
      }
      footer={
        <>
          <Show when={!clientEnv.disableAnswerClose()}>
            <Button variant="ghost" size="large" disabled={busy()} onClick={dismiss}>
              {language.t("ui.common.dismiss")}
            </Button>
          </Show>
          <div data-slot="question-footer-actions">
            <Show when={tab() > 0}>
              <Button variant="secondary" size="large" disabled={busy()} onClick={back}>
                {language.t("ui.common.back")}
              </Button>
            </Show>
            <Button
              variant={last() ? "primary" : "secondary"}
              size="large"
              disabled={busy() || !consensus()}
              onClick={next}
            >
              {last() ? language.t("ui.common.submit") : language.t("ui.common.next")}
            </Button>
          </div>
        </>
      }
    >
      <div data-slot="question-text">{question()?.question}</div>
      <Show when={multi()} fallback={<div data-slot="question-hint">{language.t("ui.question.singleHint")}</div>}>
        <div data-slot="question-hint">{language.t("ui.question.multiHint")}</div>
      </Show>
      <div data-slot="question-options">
        <For each={options()}>
          {(opt, i) => (
            <Option
              multi={multi()}
              picked={picked(opt.label)}
              soft={othersPicked(opt.label)}
              label={opt.label}
              description={opt.description}
              disabled={busy()}
              avatars={avatarsFor(opt.label)}
              onClick={() => selectOption(i())}
            />
          )}
        </For>

        <Show
          when={editing()}
          fallback={
            <button
              type="button"
              data-slot="question-option"
              data-custom="true"
              data-picked={on()}
              data-soft={othersCustom() && !on() ? true : undefined}
              role={multi() ? "checkbox" : "radio"}
              aria-checked={on()}
              disabled={busy()}
              onClick={customOpen}
            >
              <Mark multi={multi()} picked={on()} soft={othersCustom()} onClick={toggleCustomMark} />
              <span data-slot="question-option-main">
                <span data-slot="option-label">{customLabel()}</span>
                <span data-slot="option-description">{input() || customPlaceholder()}</span>
              </span>
              <Avatars items={customAvatars()} />
            </button>
          }
        >
          <form
            data-slot="question-option"
            data-custom="true"
            data-picked={on()}
            data-soft={othersCustom() && !on() ? true : undefined}
            role={multi() ? "checkbox" : "radio"}
            aria-checked={on()}
            onMouseDown={(e) => {
              if (busy()) {
                e.preventDefault()
                return
              }
              if (e.target instanceof HTMLTextAreaElement) return
              const field = e.currentTarget.querySelector('[data-slot="question-custom-input"]')
              if (field instanceof HTMLTextAreaElement) field.focus()
            }}
            onSubmit={(e) => {
              e.preventDefault()
              commitCustom()
            }}
          >
            <Mark multi={multi()} picked={on()} soft={othersCustom()} onClick={toggleCustomMark} />
            <span data-slot="question-option-main">
              <span data-slot="option-label">{customLabel()}</span>
              {/* Uncontrolled while editing: seeded once via ref, never re-bound, so IME is safe. */}
              <textarea
                ref={focusCustom}
                data-slot="question-custom-input"
                placeholder={customPlaceholder()}
                rows={1}
                disabled={busy()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault()
                    setEditing(false)
                    return
                  }
                  if (e.key !== "Enter" || e.shiftKey) return
                  e.preventDefault()
                  commitCustom()
                }}
                onCompositionStart={() => {
                  composing = true
                }}
                onCompositionEnd={(e) => {
                  composing = false
                  setLocalText(e.currentTarget.value)
                  customUpdate(e.currentTarget.value)
                }}
                onInput={(e) => {
                  // Update the local buffer first (IME-safe), then share the text.
                  setLocalText(e.currentTarget.value)
                  customUpdate(e.currentTarget.value)
                  resizeInput(e.currentTarget)
                }}
              />
            </span>
            <Avatars items={customAvatars()} />
          </form>
        </Show>
      </div>
    </DockPrompt>
  )
}
