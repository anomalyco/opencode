import { For, Show, createMemo, createSignal, createEffect, onCleanup, onMount, type Component } from "solid-js"
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

function Mark(props: { multi: boolean; picked: boolean; onClick?: (event: MouseEvent) => void }) {
  return (
    <span data-slot="question-option-check" aria-hidden="true" onClick={props.onClick}>
      <span data-slot="question-option-box" data-type={props.multi ? "checkbox" : "radio"} data-picked={props.picked}>
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
      role={props.multi ? "checkbox" : "radio"}
      aria-checked={props.picked}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <Mark multi={props.multi} picked={props.picked} />
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

  const sessionID = props.request.sessionID
  const requestID = props.request.id
  const questions = createMemo(() => props.request.questions)
  const total = createMemo(() => questions().length)

  // Navigation + edit cursor stay LOCAL — each participant browses freely.
  const [tab, setTab] = createSignal(0)
  const [editing, setEditing] = createSignal(false)

  // The shared answer draft is authoritative on the server; this mirrors the last broadcast.
  const [draft, setDraft] = createStore<{ answers: string[][]; custom: string[]; customOn: boolean[]; rev: number }>({
    answers: [],
    custom: [],
    customOn: [],
    rev: -1,
  })
  // Each participant's own current selection on their tab (for per-option avatars).
  const [mine, setMine] = createStore<string[][]>([])
  const [presence, setPresence] = createSignal<QuestionPresenceEntry[]>([])
  const [actor, setActor] = createSignal<Actor>()

  let channel: QuestionDraftChannel | undefined
  let root: HTMLDivElement | undefined

  const question = createMemo(() => questions()[tab()])
  const options = createMemo(() => question()?.options ?? [])
  const multi = createMemo(() => question()?.multiple === true)
  const input = createMemo(() => draft.custom[tab()] ?? "")
  const on = createMemo(() => draft.customOn[tab()] === true)
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
      customFocused: editing(),
    })
  }
  createEffect(() => {
    // Re-broadcast whenever this participant's tab, edit state, or own selection changes.
    tab()
    editing()
    void mine[tab()]
    broadcastPresence()
  })

  const avatarsFor = (optLabel: string) =>
    presence()
      .filter((item) => item.actorID !== actor()?.actorID && item.qIndex === tab() && item.selection.includes(optLabel))
      .map((item) => ({ actorID: item.actorID, name: item.name, color: item.color }))

  // Other participants (not me) currently viewing question `index` — shown stacked above its segment.
  const othersOnTab = (index: number) =>
    presence()
      .filter((item) => item.actorID !== actor()?.actorID && item.qIndex === index)
      .map((item) => ({ actorID: item.actorID, name: item.name, color: item.color }))

  // ── Draft ops ───────────────────────────────────────────────────────────────────────────────
  const sendOp = (op: QuestionDraftOp) => channel?.sendOp(op)

  const picked = (answer: string) => draft.answers[tab()]?.includes(answer) ?? false

  const pick = (answer: string) => {
    setMine(tab(), [answer])
    sendOp({ kind: "single", q: tab(), value: answer })
    setEditing(false)
  }

  const toggle = (answer: string) => {
    const next = !(draft.answers[tab()]?.includes(answer) ?? false)
    setMine(tab(), (current = []) => (next ? [...current.filter((x) => x !== answer), answer] : current.filter((x) => x !== answer)))
    sendOp({ kind: "toggle", q: tab(), label: answer, on: next })
  }

  const customUpdate = (value: string, selected: boolean = on()) => {
    sendOp({ kind: "custom", q: tab(), text: value, on: selected, multi: multi() })
    if (selected) setMine(tab(), multi() ? (current = []) => [...current.filter((x) => x !== input().trim()), value] : [value])
  }

  const customToggle = () => {
    if (sending()) return
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
    if (sending()) return
    setEditing(true)
    customUpdate(input(), true)
  }

  const commitCustom = () => {
    setEditing(false)
    customUpdate(input())
  }

  const selectOption = (optIndex: number) => {
    if (sending()) return
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

  const answered = (i: number) => {
    if ((draft.answers[i]?.length ?? 0) > 0) return true
    return draft.customOn[i] === true && (draft.custom[i] ?? "").trim().length > 0
  }

  // ── Consent (send / dismiss) ────────────────────────────────────────────────────────────────
  const [approval, setApproval] = createSignal<DocSubmitState>()
  const [voteKind, setVoteKind] = createSignal<DocSubmitKind>("question-send")
  const [pendingSend, setPendingSend] = createSignal(false)
  let approvalID: string | undefined
  let finalizedID: string | undefined

  const sending = createMemo(() => pendingSend() || approval()?.status === "pending")

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
    if (state.questionAction) setVoteKind(state.questionAction === "dismiss" ? "question-dismiss" : "question-send")
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

  const startVote = async (kind: DocSubmitKind, payload: { answers?: string[][]; reject?: boolean }) => {
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

  const submit = () => {
    if (editing()) commitCustom()
    void startVote("question-send", { answers: questions().map((_, i) => draft.answers[i] ?? []) })
  }

  const dismiss = () => void startVote("question-dismiss", { reject: true })

  // ── Navigation (local) ──────────────────────────────────────────────────────────────────────
  const next = () => {
    if (sending()) return
    if (editing()) commitCustom()
    if (tab() >= total() - 1) {
      submit()
      return
    }
    setTab(tab() + 1)
    setEditing(false)
  }
  const back = () => {
    if (sending() || tab() <= 0) return
    setTab(tab() - 1)
    setEditing(false)
  }
  const jump = (next: number) => {
    if (sending()) return
    setTab(next)
    setEditing(false)
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────────────────────
  const init = async () => {
    const user = parentParams.user[0]
    const stored = loadActor(sessionID, user?.id)
    const res = await sdk.client.session.actor.upsert({
      sessionID,
      directory: sdk.directory,
      ...(stored ? { actorID: stored } : {}),
      ...(user ? { userID: user.id, name: user.name } : {}),
    })
    const a = res.data
    if (!a) return
    saveActor(sessionID, a.actorID, user?.id)
    setActor({ actorID: a.actorID, name: label(a.actorID, a.name), color: a.color })

    channel = connectQuestionDraft({
      baseUrl: sdk.url,
      directory: sdk.directory,
      sessionID,
      requestID,
      actorID: a.actorID,
      onDraft: (d) => setDraft({ answers: d.answers, custom: d.custom, customOn: d.customOn, rev: d.rev }),
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
  onCleanup(() => channel?.close())

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
                  disabled={sending()}
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
          <Button variant="ghost" size="large" disabled={sending()} onClick={dismiss}>
            {language.t("ui.common.dismiss")}
          </Button>
          <div data-slot="question-footer-actions">
            <Show when={tab() > 0}>
              <Button variant="secondary" size="large" disabled={sending()} onClick={back}>
                {language.t("ui.common.back")}
              </Button>
            </Show>
            <Button variant={last() ? "primary" : "secondary"} size="large" disabled={sending()} onClick={next}>
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
              label={opt.label}
              description={opt.description}
              disabled={sending()}
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
              role={multi() ? "checkbox" : "radio"}
              aria-checked={on()}
              disabled={sending()}
              onClick={customOpen}
            >
              <Mark multi={multi()} picked={on()} onClick={toggleCustomMark} />
              <span data-slot="question-option-main">
                <span data-slot="option-label">{customLabel()}</span>
                <span data-slot="option-description">{input() || customPlaceholder()}</span>
              </span>
            </button>
          }
        >
          <form
            data-slot="question-option"
            data-custom="true"
            data-picked={on()}
            role={multi() ? "checkbox" : "radio"}
            aria-checked={on()}
            onMouseDown={(e) => {
              if (sending()) {
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
            <Mark multi={multi()} picked={on()} onClick={toggleCustomMark} />
            <span data-slot="question-option-main">
              <span data-slot="option-label">{customLabel()}</span>
              <textarea
                ref={focusCustom}
                data-slot="question-custom-input"
                placeholder={customPlaceholder()}
                value={input()}
                rows={1}
                disabled={sending()}
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
                onInput={(e) => {
                  customUpdate(e.currentTarget.value)
                  resizeInput(e.currentTarget)
                }}
              />
            </span>
          </form>
        </Show>
      </div>
    </DockPrompt>
  )
}
