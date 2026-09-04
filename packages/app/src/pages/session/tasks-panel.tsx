import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Mark } from "@opencode-ai/ui/logo"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { createTasksData, type TasksItem } from "./tasks-data"

function fmtElapsed(start: number): string {
  const s = Math.max(0, Math.floor((Date.now() - start) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function fmtDuration(start: number, end: number): string {
  const s = Math.max(0, Math.floor((end - start) / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`
}

function StateMark(props: { state: TasksItem["state"] }) {
  return (
    <Show
      when={props.state !== "running"}
      fallback={<span data-slot="titlebar-update-loader" aria-hidden />}
    >
      <span
        aria-hidden
        class="inline-block size-2 shrink-0 rounded-full"
        style={{
          background:
            props.state === "needs-input"
              ? "var(--v2-state-fg-warning)"
              : props.state === "completed"
                ? "var(--v2-state-fg-success)"
                : "var(--v2-state-fg-danger)",
          "box-shadow":
            props.state === "needs-input" ? "0 0 6px var(--v2-state-fg-warning)" : "none",
          margin: "2px",
        }}
      />
    </Show>
  )
}

function TaskRow(props: {
  item: TasksItem
  tick: number
  onOpen: (item: TasksItem) => void
  onStop: (item: TasksItem) => void
  onDismiss: (item: TasksItem) => void
}) {
  const language = useLanguage()
  const item = props.item
  const live = () => item.state === "running" || item.state === "needs-input"
  void props.tick

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => props.onOpen(item)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          props.onOpen(item)
        }
      }}
      class="flex min-h-7 shrink-0 cursor-pointer items-start gap-2 rounded-md border border-transparent px-3 py-2"
      classList={{
        "bg-surface-raised-base": live(),
        "border-border-weaker-base": live(),
        "opacity-75 hover:opacity-100": !live(),
      }}
    >
      <div class="mt-0.5 flex">
        <StateMark state={item.state} />
      </div>
      <div class="min-w-0 flex-1">
        <div
          class="truncate text-strong"
          style={{ "font-size": "13px", "font-weight": "400", "line-height": "130%", "letter-spacing": "-0.04px" }}
        >
          {item.headline}
          <Show when={item.nested}>
            <span class="text-text-weak"> (+{item.nested})</span>
          </Show>
        </div>
        <div class="text-12-regular text-text-weak mt-[3px] truncate tabular-nums">
          {item.kind === "agent" ? language.t("session.tasks.kind.agent") : language.t("session.tasks.kind.shell")}
          {" · "}
          {item.state === "needs-input" ? (
            <span style={{ color: "var(--v2-state-fg-warning)" }}>{language.t("session.tasks.state.needsInput")}</span>
          ) : item.state === "running" ? (
            language.t("session.tasks.state.running")
          ) : item.state === "completed" ? (
            language.t("session.tasks.state.completed")
          ) : (
            language.t("session.tasks.state.failed")
          )}
          {" · "}
          <span class="text-12-mono text-text-weaker">
            {live() ? fmtElapsed(item.startTime) : fmtDuration(item.startTime, item.endTime ?? item.startTime)}
          </span>
          <Show when={item.agent}>
            <span>
              {" · "}<span style={{ color: "var(--text-interactive-base)" }}>@{item.agent}</span>
            </span>
          </Show>
        </div>
        <Show when={item.stats}>
          <div class="border-border-weaker-base mt-3 flex flex-wrap gap-4 border-t pt-3 text-11-regular text-text-weak">
            <Show when={item.stats!.model}>
              <div class="flex items-center gap-1">
                <span class="text-text-weaker">Model:</span>
                <span class="font-mono text-text-base">{item.stats!.model}</span>
              </div>
            </Show>
            <Show when={item.stats!.agent}>
              <div class="flex items-center gap-1">
                <span class="text-text-weaker">Agent:</span>
                <span class="font-mono text-text-base">{item.stats!.agent}</span>
              </div>
            </Show>
            <div class="flex items-center gap-1">
              <span class="text-text-weaker">Tools:</span>
              <span class="font-mono text-text-base">{item.stats!.toolCalls}</span>
            </div>
            <Show when={item.stats!.fails > 0}>
              <div class="flex items-center gap-1" style={{ color: "var(--v2-state-fg-danger)" }}>
                <span class="text-text-weaker">Fails:</span>
                <span class="font-mono text-text-base">{item.stats!.fails}</span>
              </div>
            </Show>
            <Show when={item.stats!.fails === 0 && item.stats!.toolCalls > 0}>
              <div class="flex items-center gap-1" style={{ color: "var(--v2-state-fg-success)" }}>
                <span class="text-text-weaker">Fails:</span>
                <span class="font-mono text-text-base">0</span>
              </div>
            </Show>
            <div class="flex items-center gap-1">
              <span class="text-text-weaker">Tokens:</span>
              <span class="font-mono text-text-base">
                ↓{item.stats!.tokensIn.toLocaleString()} ↑{item.stats!.tokensOut.toLocaleString()}
              </span>
            </div>
            <Show when={item.stats!.cost > 0}>
              <div class="flex items-center gap-1">
                <span class="text-text-weaker">Cost:</span>
                <span class="font-mono text-text-base">${item.stats!.cost.toFixed(4)}</span>
              </div>
            </Show>
          </div>
        </Show>
      </div>
      <div class="flex shrink-0" onClick={(e) => e.stopPropagation()}>
        <Show
          when={live()}
          fallback={
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-5 w-5"
              onClick={() => props.onDismiss(item)}
              aria-label={language.t("session.tasks.dismiss")}
              title={language.t("session.tasks.dismiss")}
            />
          }
        >
          <Show when={item.kind === "agent"}>
            <IconButton
              icon="stop"
              variant="ghost"
              class="h-5 w-5"
              onClick={() => props.onStop(item)}
              aria-label={language.t("session.tasks.stop")}
              title={language.t("session.tasks.stop")}
            />
          </Show>
        </Show>
      </div>
    </div>
  )
}

export function TasksPanel() {
  const language = useLanguage()
  const sdk = useSDK()
  const navigate = useNavigate()
  const { items } = createTasksData()
  const [dismissed, setDismissed] = createSignal<Set<string>>(new Set())
  const [tick, setTick] = createSignal(0)

  // Elapsed-time ticker exists only while live work is present: no timer,
  // no re-render churn, nothing retained when the panel is idle.
  createEffect(() => {
    if (items().running.length === 0) return
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    onCleanup(() => clearInterval(timer))
  })

  const visible = createMemo(() => {
    const gone = dismissed()
    return {
      running: items().running,
      finished: items().finished.filter((t) => !gone.has(t.key)),
    }
  })

  const openItem = (item: TasksItem) => {
    const dir = sdk().directory
    if (!dir) return
    navigate(`/${base64Encode(dir)}/session/${item.childId ?? item.sessionId}`)
  }

  const stopItem = async (item: TasksItem) => {
    await sdk()
      .api.session.interrupt({ sessionID: item.childId ?? item.sessionId })
      .catch(() => {})
  }

  const dismissItem = (item: TasksItem) => {
    setDismissed((prev) => new Set(prev).add(item.key))
  }

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 py-1">
        <Show
          when={visible().running.length + visible().finished.length > 0}
          fallback={
            <div class="flex h-full flex-col items-center justify-center gap-6 px-6 pb-42 text-center">
              <Mark class="w-14 opacity-10" />
              <div class="text-14-regular text-text-weak max-w-56">
                {language.t("session.tasks.empty")}
              </div>
            </div>
          }
        >
          <Show when={visible().running.length > 0}>
            <div class="text-12-medium text-text-weak px-1 pb-1 pt-2">
              {language.t("session.tasks.running")}
            </div>
            <For each={visible().running}>
              {(item) => <TaskRow item={item} tick={tick()} onOpen={openItem} onStop={stopItem} onDismiss={dismissItem} />}
            </For>
          </Show>
          <Show when={visible().finished.length > 0}>
            <div class="text-12-medium text-text-weak px-1 pb-1 pt-2">
              {language.t("session.tasks.completed")}
            </div>
            <For each={visible().finished}>
              {(item) => <TaskRow item={item} tick={tick()} onOpen={openItem} onStop={stopItem} onDismiss={dismissItem} />}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}
