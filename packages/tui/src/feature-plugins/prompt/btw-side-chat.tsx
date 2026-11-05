import type { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js"
import { Spinner } from "../../component/spinner"
import { useConfig, useCursorStyle } from "../../config"
import { useClipboard } from "../../context/clipboard"
import { Keymap } from "../../context/keymap"
import { useTheme, useThemes } from "../../context/theme"
import { usePlugin } from "../../plugin/context"
import { SimulationSemantics } from "../../simulation/semantics"
import { SplitBorder } from "../../ui/border"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"
import { getScrollAcceleration } from "../../util/scroll"
import {
  readSideChatAnswer,
  sharedThreadText,
  sideChatDescription,
  sideChatPrompt,
  sideNoteText,
} from "@opencode/util/side-chat"

export const SIDE_CHAT_PANEL = "btw"

type Turn = {
  id: string
  question: string
  answer?: string
  error?: string
  duration?: number
  /** A note the side model passed to the agent on its own, and the inbox item that carries it until delivery. */
  note?: { text: string; inboxID?: string; failed?: boolean; undone?: boolean }
}

type Thread = {
  id: string
  sessionID: string
  created: number
  turns: Turn[]
  /** How many leading turns were already shared with the agent. */
  shared: number
}

/**
 * Side threads per session. Threads are stored durably until the user deletes them or their session is deleted;
 * which thread is open and which turns are answering is client memory, so a turn left unanswered by a restart reads
 * as failed and can be retried. Returns `dispose`, which the plugin calls on cleanup.
 */
export function createSideChat(context: Plugin.Context) {
  const [saved, save] = context.storage.store("side-chat", { initial: { threads: [] as Thread[] } })
  const [live, update] = context.storage.memory("side-chat", {
    initial: { running: [] as string[], active: {} as Record<string, string | undefined> },
  })

  // Bumped by /btw so an already open panel takes focus again.
  const [focusRequest, setFocusRequest] = createSignal(0)
  const threads = (sessionID: string) => saved.threads.filter((thread) => thread.sessionID === sessionID)
  const active = (sessionID: string) => saved.threads.find((thread) => thread.id === live.active[sessionID])
  const running = (turnID: string) => live.running.includes(turnID)
  // A deleted session takes its threads with it, so the store only holds threads of sessions that exist.
  const dispose = context.data.on("session.deleted", (event) => {
    const sessionID = event.data.sessionID
    if (!saved.threads.some((thread) => thread.sessionID === sessionID)) return
    update((draft) => {
      draft.active[sessionID] = undefined
    })
    void save((draft) => {
      draft.threads = draft.threads.filter((thread) => thread.sessionID !== sessionID)
    })
  })

  const run = (sessionID: string, threadID: string, turnID: string) => {
    const thread = saved.threads.find((item) => item.id === threadID)
    const index = thread?.turns.findIndex((turn) => turn.id === turnID) ?? -1
    const turn = thread?.turns[index]
    if (!thread || !turn || running(turnID)) return
    const started = Date.now()
    update((draft) => {
      draft.running.push(turnID)
    })
    void save((draft) => {
      const target = findTurn(draft.threads, threadID, turnID)
      if (target) delete target.error
    })
    void context.client.session
      .generate({ sessionID, prompt: sideChatPrompt(answeredTurns(thread.turns.slice(0, index)), turn.question) })
      .then(async (result) => {
        const reply = readSideChatAnswer(result.text)
        await save((draft) => {
          const target = findTurn(draft.threads, threadID, turnID)
          if (!target) return
          if (!reply.answer && !reply.note) {
            target.error = "The model replied without any text."
            return
          }
          target.answer = reply.answer || "Passed on to the agent."
          target.duration = Date.now() - started
          if (reply.note) target.note = { text: reply.note }
        })
        if (reply.note) await relay(sessionID, threadID, turnID, reply.note, turn.question)
      })
      .catch((cause: unknown) =>
        save((draft) => {
          const target = findTurn(draft.threads, threadID, turnID)
          if (target) target.error = errorMessage(cause)
        }),
      )
      .finally(() =>
        update((draft) => {
          draft.running = draft.running.filter((id) => id !== turnID)
        }),
      )
  }

  // Passes a note the side model wrote to the agent, the same way a shared thread reaches it.
  const relay = (sessionID: string, threadID: string, turnID: string, note: string, question: string) =>
    context.client.session
      .synthetic({
        sessionID,
        text: sideNoteText(note, question),
        description: sideChatDescription(note),
        metadata: { source: "btw", threadID, turnID, relayed: true },
        delivery: "steer",
        resume: false,
      })
      .then(
        (item) =>
          save((draft) => {
            const target = findTurn(draft.threads, threadID, turnID)
            if (target?.note) target.note.inboxID = item.id
          }),
        () =>
          save((draft) => {
            const target = findTurn(draft.threads, threadID, turnID)
            if (target?.note) target.note.failed = true
          }),
      )

  /** Starts a new thread with the question and makes it the session's open thread. */
  const start = (sessionID: string, question: string) => {
    const thread: Thread = {
      id: crypto.randomUUID(),
      sessionID,
      created: Date.now(),
      turns: [{ id: crypto.randomUUID(), question }],
      shared: 0,
    }
    update((draft) => {
      draft.active[sessionID] = thread.id
    })
    void save((draft) => {
      draft.threads.push(thread)
    }).then(() => run(sessionID, thread.id, thread.turns[0]!.id))
  }

  /** Asks in the open thread, or starts one when none is open. */
  const ask = (sessionID: string, question: string) => {
    const thread = active(sessionID)
    if (!thread) return start(sessionID, question)
    const turn: Turn = { id: crypto.randomUUID(), question }
    void save((draft) => {
      draft.threads.find((item) => item.id === thread.id)?.turns.push(turn)
    }).then(() => run(sessionID, thread.id, turn.id))
  }

  return {
    dispose,
    threads,
    active,
    running,
    focusRequest,
    requestFocus: () => setFocusRequest((value) => value + 1),
    busy: (sessionID: string) => threads(sessionID).some((thread) => thread.turns.some((turn) => running(turn.id))),
    start,
    ask,
    retry(sessionID: string) {
      const turn = active(sessionID)?.turns.at(-1)
      const thread = active(sessionID)
      if (!thread || !turn || turn.answer || running(turn.id)) return false
      run(sessionID, thread.id, turn.id)
      return true
    },
    /** Whether a relayed note still waits in the session's inbox, where it can be taken back. */
    waiting: (sessionID: string, note: Turn["note"]) =>
      !!note?.inboxID &&
      !note.undone &&
      context.data.session.pending.list(sessionID).some((item) => item.id === note.inboxID),
    /** Takes back the open thread's latest relayed note while the agent has not read it yet. */
    async undo(sessionID: string) {
      const thread = active(sessionID)
      const turn = thread?.turns.findLast((item) => item.note?.inboxID && !item.note.undone)
      const inboxID = turn?.note?.inboxID
      if (!thread || !turn || !inboxID) return false
      if (!context.data.session.pending.list(sessionID).some((item) => item.id === inboxID)) return false
      await context.client.session.inbox.cancel({ sessionID, inboxID })
      await save((draft) => {
        const target = findTurn(draft.threads, thread.id, turn.id)
        if (target?.note) target.note.undone = true
      })
      return true
    },
    /** Deletes the open thread and opens the session's previous one, if any. */
    remove(sessionID: string) {
      const thread = active(sessionID)
      if (!thread) return
      const rest = threads(sessionID).filter((item) => item.id !== thread.id)
      update((draft) => {
        draft.active[sessionID] = rest.at(-1)?.id
        draft.running = draft.running.filter((id) => !thread.turns.some((turn) => turn.id === id))
      })
      void save((draft) => {
        draft.threads = draft.threads.filter((item) => item.id !== thread.id)
      })
    },
    /** Shows the empty state, so the next question starts a new thread. */
    fresh(sessionID: string) {
      update((draft) => {
        draft.active[sessionID] = undefined
      })
    },
    cycle(sessionID: string, step: 1 | -1) {
      const list = threads(sessionID)
      if (list.length === 0) return
      const current = list.findIndex((thread) => thread.id === live.active[sessionID])
      const next = current === -1 ? (step === 1 ? 0 : list.length - 1) : (current + step + list.length) % list.length
      update((draft) => {
        draft.active[sessionID] = list[next]!.id
      })
    },
    /**
     * Adds the open thread's answered turns that were not shared yet to the session as one synthetic message. It
     * steers, so a working agent reads it at its next step; an idle session keeps it pending for the next prompt
     * instead of waking the agent to react to it.
     */
    async share(sessionID: string) {
      const thread = active(sessionID)
      if (!thread) return "empty" as const
      const upTo = thread.turns.findLastIndex((turn) => turn.answer !== undefined) + 1
      const turns = thread.turns.slice(thread.shared, upTo).filter((turn) => turn.answer !== undefined)
      if (turns.length === 0) return "empty" as const
      const busy = context.data.session.status(sessionID) === "running"
      await context.client.session.synthetic({
        sessionID,
        text: sharedThreadText(answeredTurns(turns)),
        description: sideChatDescription(title(thread)),
        metadata: { source: "btw", threadID: thread.id, turns: upTo },
        delivery: "steer",
        resume: false,
      })
      await save((draft) => {
        const target = draft.threads.find((item) => item.id === thread.id)
        if (target) target.shared = upTo
      })
      return busy ? ("steered" as const) : ("pending" as const)
    },
  }
}

export type SideChat = ReturnType<typeof createSideChat>

export function SideChatPanel(props: { chat: SideChat; context: Plugin.Context; panel: PanelInput }) {
  const theme = useTheme()
  const syntax = useThemes().currentSyntax
  const config = useConfig().data
  const cursorStyle = useCursorStyle()
  const plugins = usePlugin()
  const toast = useToast()
  const clipboard = useClipboard()
  const sessionID = () => props.panel.sessionID
  const docked = () => props.panel.presentation === "panel"
  const surface = () => (docked() ? theme.background.raised.base : theme.background.base)
  const threads = createMemo(() => props.chat.threads(sessionID()))
  const thread = createMemo(() => props.chat.active(sessionID()))
  const position = createMemo(() => {
    const current = thread()
    const index = current ? threads().findIndex((item) => item.id === current.id) : -1
    return index === -1 ? undefined : `‹ ${index + 1}/${threads().length} ›`
  })
  const last = createMemo(() => thread()?.turns.at(-1))
  const answering = createMemo(() => {
    const turn = last()
    return turn !== undefined && props.chat.running(turn.id)
  })
  const unshared = createMemo(() => {
    const current = thread()
    if (!current) return 0
    return current.turns.slice(current.shared).filter((turn) => turn.answer !== undefined).length
  })
  const waitingNote = createMemo(() =>
    (thread()?.turns ?? []).some((turn) => props.chat.waiting(sessionID(), turn.note)),
  )
  let input: TextareaRenderable | undefined
  let scroll: ScrollBoxRenderable | undefined

  // Focusing the panel focuses its host box, so the question input takes focus back afterwards.
  createEffect(
    on(props.chat.focusRequest, () => {
      props.panel.focus()
      input?.focus()
    }),
  )
  createEffect(() => {
    if (props.panel.focused) input?.focus()
  })
  // A new answer or thread scrolls to the end, like the transcript.
  createEffect(
    on(
      () => [thread()?.id, thread()?.turns.length, last()?.answer, last()?.error],
      () => queueMicrotask(() => scroll?.scrollTo(scroll.scrollHeight)),
    ),
  )

  const submit = () => {
    if (!input) return
    const question = input.plainText.trim()
    if (!question) {
      props.chat.retry(sessionID())
      return
    }
    input.setText("")
    props.chat.ask(sessionID(), question)
  }

  const share = () => {
    props.chat
      .share(sessionID())
      .then((result) => {
        if (result === "empty") return toast.show({ message: "Nothing new to share yet", variant: "info" })
        toast.show({
          message:
            result === "steered"
              ? "Shared · the agent reads it at its next step"
              : "Shared · included with your next message",
          variant: "success",
        })
      })
      .catch(toast.error)
  }

  const copy = () => {
    const answer = last()?.answer
    if (!answer) return
    void clipboard
      .write(answer)
      .then(() => toast.show({ message: "Copied answer", variant: "success" }))
      .catch(toast.error)
  }

  Keymap.createLayer(() => ({
    enabled: () => props.panel.focused,
    priority: 1,
    commands: [
      { id: "btw.share", title: "Share side chat with the agent", group: "Side chat", bind: "ctrl+s", run: share },
      {
        id: "btw.new",
        title: "New side chat",
        group: "Side chat",
        bind: "ctrl+n",
        run: () => props.chat.fresh(sessionID()),
      },
      {
        id: "btw.delete",
        title: "Delete side chat",
        group: "Side chat",
        bind: "alt+x",
        run: () => props.chat.remove(sessionID()),
      },
      {
        id: "btw.next",
        title: "Next side chat",
        group: "Side chat",
        bind: "alt+.",
        run: () => props.chat.cycle(sessionID(), 1),
      },
      {
        id: "btw.previous",
        title: "Previous side chat",
        group: "Side chat",
        bind: "alt+,",
        run: () => props.chat.cycle(sessionID(), -1),
      },
      { id: "btw.copy", title: "Copy side chat answer", group: "Side chat", bind: "ctrl+y", run: copy },
      {
        id: "btw.undo",
        title: "Take back the note sent to the agent",
        group: "Side chat",
        bind: "alt+u",
        run: () => {
          props.chat
            .undo(sessionID())
            .then((undone) =>
              toast.show(
                undone
                  ? { message: "Took the note back", variant: "success" }
                  : { message: "The agent already read it", variant: "info" },
              ),
            )
            .catch(toast.error)
        },
      },
      {
        bind: "escape",
        title: "Close side chat",
        group: "Side chat",
        run: () => {
          if (input?.plainText) {
            input.setText("")
            return
          }
          props.panel.close()
        },
      },
      { bind: "pageup", title: "Scroll side chat up", group: "Side chat", run: () => scroll?.scrollBy(-10) },
      { bind: "pagedown", title: "Scroll side chat down", group: "Side chat", run: () => scroll?.scrollBy(10) },
    ],
  }))

  const noteStatus = (note: NonNullable<Turn["note"]>) => {
    if (note.failed) return "↳ couldn't reach the agent:"
    if (note.undone) return "↳ taken back:"
    if (props.chat.waiting(sessionID(), note)) return "↳ for the agent's next step:"
    return "↳ sent to the agent:"
  }
  const noteColor = (note: NonNullable<Turn["note"]>) => {
    if (note.failed) return theme.text.feedback.error.base
    if (note.undone) return theme.text.muted
    return theme.text.feedback.info.base
  }

  const hint = (key: string, label: string) => (
    <text wrapMode="none" flexShrink={0}>
      <span style={{ fg: theme.text.base }}>{key}</span>
      <span style={{ fg: theme.text.muted }}> {label}</span>
    </text>
  )

  return (
    <box
      id="btw-side-chat"
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={surface()}
      paddingTop={docked() ? 1 : 0}
      onMouseUp={() => input?.focus()}
    >
      <box flexDirection="row" gap={1} paddingLeft={2} paddingRight={2} flexShrink={0}>
        <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexShrink={0}>
          /btw
        </text>
        <text fg={theme.text.muted} wrapMode="none" truncate flexGrow={1}>
          {thread() ? title(thread()!) : "side chat"}
        </text>
        <Show when={position()}>
          <text fg={theme.text.muted} flexShrink={0}>
            {position()}
          </text>
        </Show>
      </box>
      <box paddingLeft={2} paddingRight={2} flexShrink={0}>
        <text fg={theme.text.faint} wrapMode="none" truncate>
          {thread() && thread()!.shared > 0
            ? `shared ${thread()!.shared} of ${thread()!.turns.length} with the agent · no tools`
            : "reads this session · no tools · not added"}
        </text>
      </box>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        marginTop={1}
        contentOptions={{ minHeight: 0 }}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={getScrollAcceleration(config)}
      >
        <Show
          when={thread()}
          fallback={
            <box paddingLeft={2} paddingRight={2} gap={1}>
              <text fg={theme.text.base}>Ask on the side</text>
              <text fg={theme.text.muted}>
                Reads this session but never changes it. The agent keeps working while you ask.
              </text>
            </box>
          }
        >
          {(current) => (
            <box gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
              <For each={current().turns}>
                {(turn) => (
                  <box gap={1}>
                    <box
                      border={["left"]}
                      customBorderChars={SplitBorder.customBorderChars}
                      borderColor={theme.border.base}
                      backgroundColor={theme.background.raised.high}
                      paddingLeft={1}
                      paddingRight={1}
                    >
                      <text fg={theme.text.base}>{turn.question}</text>
                    </box>
                    <Switch>
                      <Match when={props.chat.running(turn.id)}>
                        <Spinner color={theme.text.muted}>thinking</Spinner>
                      </Match>
                      <Match when={turn.answer}>
                        {(answer) => (
                          <box gap={0}>
                            <markdown
                              syntaxStyle={syntax()}
                              renderNode={plugins.markdown()}
                              content={answer()}
                              conceal
                              internalBlockMode="top-level"
                              tableOptions={{ style: "grid", cellPaddingX: 1 }}
                              fg={theme.markdown.text}
                              bg={surface()}
                            />
                            <Show when={turn.note}>
                              {(note) => (
                                <text wrapMode="word" marginTop={1}>
                                  <span style={{ fg: noteColor(note()) }}>{noteStatus(note())}</span>
                                  <span style={{ fg: theme.text.muted }}>{` ${note().text}`}</span>
                                </text>
                              )}
                            </Show>
                            <Show when={turn.duration !== undefined}>
                              <text
                                fg={theme.text.faint}
                              >{`${Math.max(1, Math.round((turn.duration ?? 0) / 1000))}s`}</text>
                            </Show>
                          </box>
                        )}
                      </Match>
                      <Match when={true}>
                        <text fg={theme.text.feedback.error.base}>
                          {turn.error ?? "Not answered. Press enter to retry."}
                        </text>
                      </Match>
                    </Switch>
                  </box>
                )}
              </For>
            </box>
          )}
        </Show>
      </scrollbox>
      <box paddingLeft={2} paddingRight={2} flexShrink={0}>
        <box
          border={["left"]}
          customBorderChars={SplitBorder.customBorderChars}
          borderColor={props.panel.focused ? theme.text.base : theme.border.base}
          backgroundColor={theme.background.raised.high}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <textarea
            id="btw-side-chat-input"
            ref={(element: TextareaRenderable) => {
              input = element
              SimulationSemantics.bind(() => ({
                role: "textbox",
                label: "Side chat question",
                focused: element.focused,
                disabled: false,
              }))(element)
            }}
            width="100%"
            minHeight={1}
            maxHeight={4}
            focused={props.panel.focused}
            placeholder={thread() ? "Ask a follow-up…" : "Ask anything…"}
            placeholderColor={theme.text.muted}
            textColor={theme.text.formfield.base}
            focusedTextColor={theme.text.formfield.base}
            cursorColor={theme.text.base}
            cursorStyle={cursorStyle()}
            onSubmit={() => setTimeout(() => setTimeout(submit, 0), 0)}
          />
        </box>
      </box>
      <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2} paddingTop={1} flexShrink={0} flexWrap="wrap">
        <Show when={answering()}>
          <Spinner color={theme.text.muted}>answering</Spinner>
        </Show>
        <Show when={waitingNote()}>{hint("alt+u", "undo note")}</Show>
        <Show when={unshared() > 0}>{hint("ctrl+s", "share")}</Show>
        <Show when={threads().length > 1}>{hint("alt+, .", "thread")}</Show>
        <Show when={thread()}>{hint("ctrl+n", "new")}</Show>
        <Show when={thread()}>{hint("alt+x", "delete")}</Show>
        {hint("esc", "close")}
      </box>
    </box>
  )
}

function title(thread: Thread) {
  return thread.turns[0]?.question.replace(/\s+/g, " ").trim() ?? ""
}

function findTurn(threads: Thread[], threadID: string, turnID: string) {
  return threads.find((thread) => thread.id === threadID)?.turns.find((turn) => turn.id === turnID)
}

function answeredTurns(turns: readonly Turn[]) {
  return turns.flatMap((turn) => (turn.answer ? [{ question: turn.question, answer: turn.answer }] : []))
}
