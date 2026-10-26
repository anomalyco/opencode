import { createMemo, Match, on, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { useI18n } from "@opencode/ui/context/i18n"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { Tooltip } from "@opencode/ui/tooltip"
import { showToast } from "@opencode/ui/toast"
import { Markdown } from "@opencode/session-ui/markdown"
import { useExtension, type MountedSession } from "../sdk"
import type { BtwModel } from "./model"

export default function SessionBtwPanel(props: { btw: BtwModel; session: MountedSession; id: string }) {
  const ctx = useExtension()
  const i18n = useI18n()
  const system = ctx.system
  const chat = () => props.btw.entry(props.session, props.id)
  const question = () => chat()?.question
  const answer = () => chat()?.answer
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
    const ms = chat()?.duration

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
    <div class="flex h-full min-h-0 flex-col bg-v2-background-bg-base" data-slot="session-btw-panel">
      <div class="min-h-0 flex-1 overflow-y-auto" data-scrollable>
        <div class="min-w-0 w-full max-w-full px-4 pt-6 pb-8 md:max-w-session md:mx-auto md:px-6">
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
            <Match when={props.btw.pending(props.id)}>
              <div
                data-component="session-working"
                role="status"
                class="flex h-9 items-center pt-3 text-[13px] font-[530] leading-text-compact"
              >
                <TextShimmer text={ctx.t("session.timeline.working")} active />
              </div>
            </Match>
            <Match when={props.btw.error(props.session, props.id)}>
              <div class="flex flex-col items-start gap-3 pt-4">
                <div class="text-13-regular text-text-weak">{ctx.t("error")}</div>
                <Button size="small" variant="outline" onClick={() => props.btw.retry(props.session, props.id)}>
                  {ctx.t("retry")}
                </Button>
              </div>
            </Match>
            <Match when={answer()}>
              {(text) => (
                <div data-component="text-part">
                  <div data-slot="text-part-body">
                    <Markdown text={text()} class="text-14-regular" />
                  </div>
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
      </div>
    </div>
  )
}
