import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Button } from "@opencode-ai/ui/button"
import { useLanguage } from "@/context/language"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { useServerSync } from "@/context/server-sync"
import { SessionPermissionDock } from "@/pages/session/composer/session-permission-dock"
import { SessionQuestionDock } from "@/pages/session/composer/session-question-dock"
import { sessionHref } from "@/utils/session-route"
import { showToast } from "@/utils/toast"
import { latText, money, rateText, tok } from "../lib/format"
import type { AttentionItem, FleetRowData } from "../fleetTypes"
import { SEVERITY_COLOR } from "./FleetTable"

type Tab = "thread" | "diff" | "todos"

const PART_CAP = 200
const DIFF_CAP = 50
const PREVIEW_LEN = 280

export default function SessionDetail(props: { row: FleetRowData; attention: AttentionItem[] }): JSX.Element {
  return (
    <SDKProvider directory={props.row.directory}>
      <Detail row={props.row} attention={props.attention} />
    </SDKProvider>
  )
}

function Detail(props: { row: FleetRowData; attention: AttentionItem[] }): JSX.Element {
  const language = useLanguage()
  const sync = useServerSync()
  const sdk = useSDK()
  const server = useServer()
  const navigate = useNavigate()
  const [tab, setTab] = createSignal<Tab>("thread")
  const [responding, setResponding] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [sending, setSending] = createSignal(false)

  const id = () => props.row.sessionID
  const branch = createMemo(() => sync().child(props.row.directory, { bootstrap: false })[0].vcs?.branch)
  const permission = createMemo(() => {
    const item = props.attention.find((entry) => entry.sessionID === id() && entry.kind === "permission")
    return item?.kind === "permission" ? item.request : undefined
  })
  const question = createMemo(() => {
    const item = props.attention.find((entry) => entry.sessionID === id() && entry.kind === "question")
    return item?.kind === "question" ? item.request : undefined
  })
  const lastAssistant = createMemo(() =>
    (sync().session.data.message[id()] ?? []).findLast((message) => message.role === "assistant"),
  )
  const thread = createMemo(() => {
    const items: { key: string; role: string; preview: string }[] = []
    for (const message of sync().session.data.message[id()] ?? []) {
      for (const part of sync().session.data.part[message.id] ?? []) {
        const preview = previewOf(part)
        if (!preview) continue
        items.push({ key: part.id, role: message.role, preview })
      }
    }
    return { items: items.slice(-PART_CAP), hidden: Math.max(0, items.length - PART_CAP) }
  })
  const diffs = createMemo(() => sync().session.data.session_diff[id()] ?? [])
  const todos = createMemo(() => sync().session.data.todo[id()] ?? [])

  const fail = (err: unknown) =>
    showToast({ title: language.t("common.requestFailed"), description: err instanceof Error ? err.message : String(err) })

  const decide = (request: NonNullable<ReturnType<typeof permission>>, reply: "once" | "always" | "reject") => {
    setResponding(true)
    sdk()
      .api.permission.reply({
        sessionID: request.sessionID,
        requestID: request.id,
        reply,
        location: { directory: props.row.directory },
      })
      .catch(fail)
      .finally(() => setResponding(false))
  }

  const send = () => {
    const text = draft().trim()
    if (!text || sending()) return
    const last = lastAssistant()
    setSending(true)
    sdk()
      .api.session.prompt({
        sessionID: id(),
        text,
        agent: props.row.agent || undefined,
        model: last?.role === "assistant" ? { providerID: last.providerID, modelID: last.modelID } : undefined,
      })
      .then(() => setDraft(""))
      .catch(fail)
      .finally(() => setSending(false))
  }

  const interrupt = () => void sdk().api.session.interrupt({ sessionID: id() }).catch(fail)

  const tabButton = (key: Tab, label: string, count?: number) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      class="px-2 py-1 rounded-md text-12-medium"
      classList={{
        "bg-surface-base-active text-text-strong": tab() === key,
        "text-text-weak hover:text-text-base": tab() !== key,
      }}
    >
      {label}
      <Show when={count}>
        <span class="text-text-weak"> {count}</span>
      </Show>
    </button>
  )

  return (
    <div class="flex flex-col h-full min-h-0 min-w-0">
      <div class="px-4 pt-3 pb-2 border-b border-border-weaker-base flex flex-col gap-1.5 min-w-0">
        <div class="flex items-start gap-2 min-w-0">
          <div class="min-w-0 flex-1">
            <div class="text-14-medium text-text-strong truncate">{props.row.title || id()}</div>
            <div class="text-12-regular text-text-weak truncate">
              {[props.row.directory, branch(), props.row.agent, props.row.model].filter(Boolean).join(" · ")}
            </div>
          </div>
          <Show when={props.row.live}>
            <Button variant="secondary" size="small" onClick={interrupt}>
              {language.t("agents.action.interrupt")}
            </Button>
          </Show>
          <Button variant="ghost" size="small" onClick={() => navigate(sessionHref(server.key, id()))}>
            {language.t("agents.action.open")}
          </Button>
        </div>
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-12-mono tabular-nums text-text-weak min-w-0">
          <span class="text-12-medium whitespace-nowrap" style={{ color: SEVERITY_COLOR[props.row.stage.severity] }}>
            {props.row.stage.state}
          </span>
          <span class="whitespace-nowrap">in {tok(props.row.tin)}</span>
          <span class="whitespace-nowrap">out {tok(props.row.tout)}</span>
          <span class="whitespace-nowrap">{rateText(props.row.tps)} tok/s</span>
          <span class="whitespace-nowrap">lat {latText(props.row.lat)}</span>
          <Show when={props.row.cost > 0}>
            <span class="text-text-base whitespace-nowrap">${money(props.row.cost)}</span>
          </Show>
          <Show when={props.row.role === "subagent"}>
            <span class="whitespace-nowrap">{language.t("agents.role.subagent")}</span>
          </Show>
        </div>
      </div>

      <Show when={question()} keyed>
        {(request) => (
          <div class="px-3 pt-3">
            <SessionQuestionDock request={request} onSubmit={() => undefined} />
          </div>
        )}
      </Show>
      <Show when={permission()} keyed>
        {(request) => (
          <div class="px-3 pt-3">
            <SessionPermissionDock
              request={request}
              responding={responding()}
              onDecide={(reply) => decide(request, reply)}
            />
          </div>
        )}
      </Show>

      <div class="flex items-center gap-1 px-3 pt-2">
        {tabButton("thread", language.t("agents.tab.thread"))}
        {tabButton("diff", language.t("agents.tab.diff"), diffs().length)}
        {tabButton("todos", language.t("agents.tab.todos"), todos().length)}
      </div>

      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto px-4 py-2 flex flex-col-reverse">
        <div class="min-w-0">
          <Switch>
            <Match when={tab() === "thread"}>
              <Show when={thread().hidden > 0}>
                <div class="text-12-regular text-text-weak py-1">{language.t("agents.more", { count: thread().hidden })}</div>
              </Show>
              <Show when={thread().items.length > 0} fallback={<Empty />}>
                <For each={thread().items}>
                  {(item) => (
                    <div class="py-1.5 border-b border-border-weaker-base">
                      <div class="text-12-regular text-text-weak">{item.role}</div>
                      <div class="text-12-regular text-text-base break-words">{item.preview}</div>
                    </div>
                  )}
                </For>
              </Show>
            </Match>
            <Match when={tab() === "diff"}>
              <Show when={diffs().length > 0} fallback={<Empty />}>
                <For each={diffs().slice(0, DIFF_CAP)}>
                  {(file) => (
                    <div class="flex items-center gap-2 py-1 text-12-mono">
                      <span class="truncate flex-1 text-text-base">{file.file}</span>
                      <span style={{ color: "var(--text-diff-add-base)" }}>+{file.additions}</span>
                      <span style={{ color: "var(--text-diff-delete-base)" }}>-{file.deletions}</span>
                    </div>
                  )}
                </For>
                <Show when={diffs().length > DIFF_CAP}>
                  <div class="text-12-regular text-text-weak py-1">
                    {language.t("agents.more", { count: diffs().length - DIFF_CAP })}
                  </div>
                </Show>
              </Show>
            </Match>
            <Match when={tab() === "todos"}>
              <Show when={todos().length > 0} fallback={<Empty />}>
                <For each={todos()}>
                  {(todo) => (
                    <div class="flex items-baseline gap-2 py-1 text-12-regular">
                      <span class="text-text-weak w-20 shrink-0">{todo.status}</span>
                      <span
                        classList={{
                          "text-text-weak line-through": todo.status === "completed" || todo.status === "cancelled",
                          "text-text-strong": todo.status === "in_progress",
                          "text-text-base": todo.status === "pending",
                        }}
                      >
                        {todo.content}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </Match>
          </Switch>
        </div>
      </div>

      <div class="border-t border-border-weaker-base p-3 flex gap-2 items-end">
        <textarea
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              send()
            }
          }}
          rows={2}
          placeholder={language.t(props.row.live ? "agents.steer.placeholderLive" : "agents.steer.placeholder")}
          class="flex-1 resize-none rounded-md bg-surface-base border border-border-weak-base px-2 py-1.5 text-12-regular text-text-strong placeholder:text-text-weak focus:outline-none focus:border-border-interactive-focus"
        />
        <Button variant="primary" size="normal" disabled={!draft().trim() || sending()} onClick={send}>
          {language.t("agents.steer.send")}
        </Button>
      </div>
    </div>
  )
}

function Empty(): JSX.Element {
  return <div class="text-12-regular text-text-weak py-2">—</div>
}

function previewOf(part: unknown): string {
  if (!part || typeof part !== "object") return ""
  const record = part as Record<string, unknown>
  if (record.type === "text" && typeof record.text === "string") return clip(record.text)
  if (record.type === "reasoning") return ""
  if (record.type === "tool" && typeof record.tool === "string") {
    const state = record.state as { status?: string; title?: string } | undefined
    return `▸ ${record.tool}${state?.title ? ` ${state.title}` : ""}${state?.status ? ` · ${state.status}` : ""}`
  }
  if (record.type === "subtask" && typeof record.description === "string") return `⇢ ${clip(record.description)}`
  return ""
}

const clip = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, PREVIEW_LEN)
