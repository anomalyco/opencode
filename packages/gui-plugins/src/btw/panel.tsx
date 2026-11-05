import { createMemo, createSignal, For, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Textarea } from "@opencode/ui/textarea"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { usePlugin, type MountedSession } from "@opencode/plugin/gui"
import type Btw from "./index"
import type { BtwFailure } from "./machine"
import type { BtwModel } from "./model"

export default function SessionBtwPanel(props: { btw: BtwModel; session: MountedSession; id: string }) {
  const ctx = usePlugin<typeof Btw>()
  const sideChat = () => props.btw.sideChat()
  const turns = createMemo(() => (sideChat() ? props.btw.turns(props.session, props.id) : [props.id]))
  const [draft, setDraft] = createSignal("")
  const [sharing, setSharing] = createSignal(false)
  const unshared = createMemo(() => props.btw.unshared(props.session, props.id))
  let scroller: HTMLDivElement | undefined

  const send = () => {
    const question = draft().trim()

    if (!question) return
    setDraft("")
    props.btw.follow(props.session, props.id, question)
    queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }))
  }

  const share = () => {
    setSharing(true)
    props.btw
      .share(props.session, props.id)
      .then(
        (result) => {
          if (result === "empty") return showToast({ title: ctx.t("share.empty") })
          showToast({ title: ctx.t(result === "steered" ? "share.steered" : "share.pending") })
        },
        () => showToast({ title: ctx.t("common.requestFailed") }),
      )
      .finally(() => setSharing(false))
  }

  return (
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-btw-panel">
      <div ref={scroller} class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
        <div class="min-w-0 w-full max-w-full px-4 pt-6 pb-8 md:max-w-session md:mx-auto md:px-6 flex flex-col gap-6">
          <For each={turns()}>{(turn) => <BtwTurn btw={props.btw} session={props.session} id={turn} />}</For>
        </div>
      </div>
      <Show when={sideChat()}>
        <div class="shrink-0 border-t border-v2-border-border-muted px-3 pt-2 pb-3" data-slot="session-btw-composer">
          <div class="flex items-center gap-2 pb-2 text-12-regular text-text-weak">
            <span class="min-w-0 flex-1 truncate">
              {props.btw.shared(props.session, props.id) > 0 ? ctx.t("shared") : ctx.t("context")}
            </span>
            <Button
              size="small"
              variant="outline"
              disabled={unshared() === 0 || sharing()}
              onClick={share}
              data-action="btw-share"
            >
              {ctx.t("share")}
            </Button>
          </div>
          <div class="flex items-end gap-2">
            <Textarea
              class="!w-auto !min-h-0 min-w-0 !flex-1 [&_[data-slot=textarea-v2-textarea]]:resize-none"
              rows={2}
              value={draft()}
              placeholder={ctx.t("followup.placeholder")}
              aria-label={ctx.t("followup.placeholder")}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.isComposing) return
                event.preventDefault()
                send()
              }}
            />
            <IconButton
              size="normal"
              variant="ghost-muted"
              icon={<Icon name="arrow-up" size="small" />}
              aria-label={ctx.t("send")}
              disabled={!draft().trim()}
              onClick={send}
            />
          </div>
        </div>
      </Show>
    </div>
  )
}

function BtwTurn(props: { btw: BtwModel; session: MountedSession; id: string }) {
  const ctx = usePlugin<typeof Btw>()
  const i18n = useI18n()
  const system = ctx.system
  const view = createMemo(() => props.btw.view(props.session, props.id))

  const chat = createMemo(() => {
    const current = view()

    return current.phase === "loading" || current.phase === "missing" ? undefined : current
  })

  const running = createMemo(() => view().phase === "running")

  const failure = createMemo(() => {
    const current = view()

    return current.phase === "failed" ? current.failure : undefined
  })

  const answered = createMemo(() => {
    const current = view()

    return current.phase === "answered" ? current : undefined
  })

  const question = () => chat()?.question
  const answer = () => answered()?.answer
  const note = createMemo(() => props.btw.note(props.session, props.id))

  const noteStatus = (value: NonNullable<ReturnType<typeof note>>) => {
    if (value.failed) return ctx.t("note.failed")

    if (value.undone) return ctx.t("note.undone")

    return ctx.t(value.waiting ? "note.waiting" : "note.sent")
  }

  const failureDetail = (value: BtwFailure) => {
    if (value.reason === "empty") return ctx.t("error.empty")

    if (value.reason === "timeout") return ctx.t("error.timeout")

    if (value.reason === "error") return value.message

    return undefined
  }

  // New primitive tokens clear the copied mark when text changes without being proxied by the store.
  const shownQuestion = createMemo(on(question, () => Symbol()))
  const shownAnswer = createMemo(on(answer, () => Symbol()))
  const [copied, setCopied] = createStore<{ question?: symbol; answer?: symbol }>({})
  const isQuestionCopied = () => copied.question === shownQuestion()
  const isAnswerCopied = () => copied.answer === shownAnswer()
  const timefmt = createMemo(() => new Intl.DateTimeFormat(i18n.locale(), { timeStyle: "short" }))
  const numfmt = createMemo(() => new Intl.NumberFormat(i18n.locale()))

  const agentLabel = createMemo(() => {
    const agent = chat()?.agent

    return agent ? agent[0]?.toUpperCase() + agent.slice(1) : ""
  })

  const modelLabel = createMemo(() => {
    const model = chat()?.model

    if (!model) return ""
    const ref = props.session.directory ? { directory: props.session.directory } : undefined
    const models = props.session.server.data.location.model.list(ref)

    const found = models?.findLast(
      (item) => item.providerID === model.providerID && item.id === model.id && item.status !== "deprecated",
    )

    const name = found?.name ?? model.id

    if (!model.variant || model.variant === "default") return name

    return i18n.t("ui.message.modelVariant", {
      model: name,
      variant: model.variant[0]?.toUpperCase() + model.variant.slice(1),
    })
  })

  const userMeta = createMemo(() => [agentLabel(), modelLabel()].filter(Boolean).join("\u00A0\u00B7\u00A0"))

  const stamp = createMemo(() => {
    const created = chat()?.created

    return created !== undefined ? timefmt().format(created) : ""
  })

  const durationLabel = createMemo(() => {
    const ms = answered()?.duration

    if (ms === undefined || !(ms >= 0)) return ""
    const total = Math.round(ms / 1000)

    if (total < 60) return i18n.t("ui.message.duration.seconds", { count: numfmt().format(total) })

    return i18n.t("ui.message.duration.minutesSeconds", {
      minutes: numfmt().format(Math.floor(total / 60)),
      seconds: numfmt().format(total % 60),
    })
  })

  const answerMeta = createMemo(() => [agentLabel(), modelLabel(), durationLabel()].filter(Boolean).join(" \u00B7 "))

  const copyQuestion = () => {
    const value = question()

    if (!value) return
    void system.copy(value).then(
      () => setCopied("question", shownQuestion()),
      () => showToast({ title: ctx.t("common.requestFailed") }),
    )
  }

  const copy = () => {
    const value = answer()

    if (!value) return
    void system.copy(value).then(
      () => setCopied("answer", shownAnswer()),
      () => showToast({ title: ctx.t("common.requestFailed") }),
    )
  }

  return (
    <div>
      <div data-component="user-message">
        <div data-slot="user-message-body">
          <div data-slot="user-message-text" dir="auto">
            {question()}
          </div>
        </div>
        <Show when={question()}>
          <div data-slot="user-message-copy-wrapper">
            <span data-slot="user-message-meta-wrap">
              <Show when={userMeta()}>
                <span data-slot="user-message-meta" class="text-12-regular text-text-weak cursor-default">
                  {userMeta()}
                </span>
              </Show>
              <Show when={userMeta() && stamp()}>
                <span data-slot="user-message-meta-sep" class="text-12-regular text-text-weak cursor-default">
                  {"\u00A0\u00B7\u00A0"}
                </span>
              </Show>
              <Show when={stamp()}>
                <span data-slot="user-message-meta-tail" class="text-12-regular text-text-weak cursor-default">
                  {stamp()}
                </span>
              </Show>
            </span>
            <Tooltip
              appearance="compact"
              value={isQuestionCopied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
              placement="top"
              gutter={4}
            >
              <IconButton
                size="normal"
                variant="ghost-muted"
                icon={<Icon name={isQuestionCopied() ? "check" : "outline-copy"} size="small" />}
                aria-label={isQuestionCopied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={copyQuestion}
              />
            </Tooltip>
          </div>
        </Show>
      </div>

      <Switch>
        <Match when={running()}>
          <div
            data-component="session-working"
            role="status"
            class="flex h-9 items-center pt-3 text-[13px] font-[530] leading-text-compact"
          >
            <TextShimmer text={ctx.t("session.timeline.working")} active />
          </div>
        </Match>
        <Match when={failure()}>
          {(current) => (
            <div class="flex flex-col items-start gap-3 pt-4">
              <div class="flex flex-col gap-1">
                <div class="text-13-regular text-text-weak">{ctx.t("error")}</div>
                <Show when={failureDetail(current())}>
                  {(detail) => <div class="text-12-regular text-text-weak break-words">{detail()}</div>}
                </Show>
              </div>
              <Button size="small" variant="outline" onClick={() => props.btw.retry(props.session, props.id)}>
                {ctx.t("retry")}
              </Button>
            </div>
          )}
        </Match>
        <Match when={answered()}>
          {(reply) => (
            <div data-component="text-part">
              <div data-slot="text-part-body">
                <Markdown text={reply().answer} class="text-14-regular" />
              </div>
              <Show when={note()}>
                {(current) => (
                  <div
                    class="mt-2 flex items-start gap-2 rounded-md border border-v2-border-border-muted px-3 py-2 text-13-regular"
                    data-slot="btw-note"
                  >
                    <Icon name="arrow-up-right" size="small" class="mt-0.5 shrink-0 text-text-weak" />
                    <div class="min-w-0 flex-1">
                      <div class="text-12-regular text-text-weak">{noteStatus(current())}</div>
                      <div class="break-words" classList={{ "line-through text-text-weak": !!current().undone }}>
                        {current().text}
                      </div>
                    </div>
                    <Show when={current().waiting}>
                      <Button
                        size="small"
                        variant="ghost"
                        onClick={() =>
                          void props.btw
                            .undo(props.session, props.id)
                            .catch(() => showToast({ title: ctx.t("common.requestFailed") }))
                        }
                      >
                        {ctx.t("note.undo")}
                      </Button>
                    </Show>
                  </div>
                )}
              </Show>
              <div data-slot="text-part-copy-wrapper">
                <Tooltip
                  appearance="compact"
                  value={isAnswerCopied() ? ctx.t("common.copied") : ctx.t("copy")}
                  placement="top"
                  gutter={4}
                >
                  <IconButton
                    size="normal"
                    variant="ghost-muted"
                    icon={<Icon name={isAnswerCopied() ? "check" : "outline-copy"} size="small" />}
                    aria-label={isAnswerCopied() ? ctx.t("common.copied") : ctx.t("copy")}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={copy}
                  />
                </Tooltip>
                <Show when={answerMeta()}>
                  <span data-slot="text-part-meta" class="text-12-regular text-text-weak cursor-default">
                    {answerMeta()}
                  </span>
                </Show>
              </div>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  )
}
