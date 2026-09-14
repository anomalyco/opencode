import { createMemo, createSignal, For, Match, Show, Switch } from "solid-js"
import type { JSX } from "solid-js"
import { useLanguage } from "@/context/language"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { useServer } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import type { FleetRowData } from "../fleetTypes"

type Tab = "thread" | "diff" | "todos" | "events"

const PART_CAP = 200
const DIFF_CAP = 50
const PREVIEW_LEN = 200
const DIM = { color: "rgba(255,255,255,.42)" }

export default function DetailTabs(props: { row: FleetRowData | null; onClose?: () => void }): JSX.Element {
  const language = useLanguage()
  const sync = useServerSync()
  const sdk = useServerSDK()
  const server = useServer()
  const [tab, setTab] = createSignal<Tab>("thread")

  const info = createMemo(() => {
    const id = props.row?.sessionID
    return id ? sync().session.get(id) : undefined
  })
  const branch = createMemo(() => {
    const dir = props.row?.directory
    return dir ? (sync().child(dir, { bootstrap: false })[0].vcs?.branch ?? undefined) : undefined
  })
  const thread = createMemo(() => {
    const id = props.row?.sessionID
    if (!id) return { items: [] as { role: string; preview: string }[], truncated: false }
    const items: { role: string; preview: string }[] = []
    for (const message of sync().session.data.message[id] ?? []) {
      for (const part of sync().session.data.part[message.id] ?? []) {
        if (items.length >= PART_CAP) return { items, truncated: true }
        items.push({ role: message.role, preview: previewOf(part) })
      }
    }
    return { items, truncated: false }
  })
  const diffs = createMemo(() => {
    const id = props.row?.sessionID
    return id ? (sync().session.data.session_diff[id] ?? []) : []
  })
  const todos = createMemo(() => {
    const id = props.row?.sessionID
    return id ? (sync().session.data.todo[id] ?? []) : []
  })
  const interrupt = () => {
    const id = props.row?.sessionID
    if (!id) return
    void sdk().api.session.interrupt({ sessionID: id }).catch(() => undefined)
  }
  const href = () => {
    const id = props.row?.sessionID
    return id ? sessionHref(server.key, id) : "#"
  }
  const tabButton = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      style={{
        padding: "4px 10px",
        "border-radius": "6px",
        border: "1px solid rgba(255,255,255,.12)",
        background: tab() === key ? "rgba(255,255,255,.12)" : "transparent",
        color: "inherit",
        cursor: "pointer",
        "font-family": "inherit",
        "font-size": "12px",
      }}
    >
      {label}
    </button>
  )

  return (
    <Show when={props.row} fallback={<div style={{ padding: "12px", ...DIM, "font-family": "ui-monospace,Menlo,monospace" }}>—</div>}>
      {(row) => (
        <div style={{ display: "flex", "flex-direction": "column", height: "100%", "min-height": "0", "font-family": "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace", "font-size": "13px" }}>
          <div style={{ padding: "12px", "border-bottom": "1px solid rgba(255,255,255,.08)" }}>
            <div style={{ "font-weight": 600, color: "rgba(255,255,255,.95)" }}>{row().title || info()?.title || "—"}</div>
            <div style={{ ...DIM, "font-size": "12px", "margin-top": "2px" }}>
              {`${row().directory}${branch() ? ` · ${branch()}` : ""} · ${row().agent || "—"}·${row().model || "—"}`}
            </div>
            <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-top": "8px", "font-size": "12px", "white-space": "nowrap" }}>
              <span style={{ padding: "2px 8px", "border-radius": "999px", border: "1px solid rgba(255,255,255,.12)" }}>{row().stage.state}</span>
              <span style={DIM}>{`in ${row().tin} · out ${row().tout} · ${row().tps.toFixed(1)} tok/s`}</span>
              <Show when={row().lat != null}>
                <span style={DIM}>{`lat ${row().lat!.toFixed(2)}s`}</span>
              </Show>
            </div>
            <div style={{ display: "flex", gap: "8px", "margin-top": "10px", "align-items": "center" }}>
              <button
                type="button"
                disabled
                title="permission"
                style={{
                  padding: "4px 10px",
                  "border-radius": "6px",
                  border: "1px solid rgba(255,255,255,.12)",
                  background: row().kind === "permission" ? "rgba(255,194,82,.2)" : "transparent",
                  color: row().kind === "permission" ? "rgba(255,194,82,.95)" : "rgba(255,255,255,.72)",
                  cursor: "not-allowed",
                  "font-family": "inherit",
                  "font-size": "12px",
                }}
              >
                {language.t("agents.action.permission")}
              </button>
              <button type="button" onClick={interrupt} style={{ padding: "4px 10px", "border-radius": "6px", border: "1px solid rgba(255,255,255,.12)", background: "transparent", color: "inherit", cursor: "pointer", "font-family": "inherit", "font-size": "12px" }}>
                {language.t("agents.action.interrupt")}
              </button>
              <a href={href()} style={{ "font-size": "12px", color: "rgba(122,209,255,.92)" }}>
                {language.t("agents.action.open")}
              </a>
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", padding: "8px 12px" }}>
            {tabButton("thread", language.t("agents.tab.thread"))}
            {tabButton("diff", language.t("agents.tab.diff"))}
            {tabButton("todos", language.t("agents.tab.todos"))}
            {tabButton("events", language.t("agents.tab.events"))}
          </div>
          <div style={{ flex: "1 1 auto", overflow: "auto", "min-height": "0", padding: "0 12px 12px" }}>
            <Switch>
              <Match when={tab() === "thread"}>
                <Show when={thread().items.length > 0} fallback={<div style={DIM}>—</div>}>
                  <For each={thread().items}>
                    {(item) => (
                      <div style={{ padding: "6px 0", "border-bottom": "1px solid rgba(255,255,255,.06)" }}>
                        <div style={{ ...DIM, "font-size": "11px" }}>{item.role}</div>
                        <div style={{ color: "rgba(255,255,255,.95)" }}>{item.preview}</div>
                      </div>
                    )}
                  </For>
                  <Show when={thread().truncated}>
                    <div style={{ ...DIM, "font-size": "12px", padding: "6px 0" }}>{language.t("agents.more", { count: PART_CAP })}</div>
                  </Show>
                </Show>
              </Match>
              <Match when={tab() === "diff"}>
                <Show when={diffs().length > 0} fallback={<div style={DIM}>—</div>}>
                  <For each={diffs().slice(0, DIFF_CAP)}>
                    {(file) => (
                      <div style={{ padding: "6px 0", "border-bottom": "1px solid rgba(255,255,255,.06)" }}>
                        <div style={{ color: "rgba(255,255,255,.95)" }}>{file.file}</div>
                        <div style={{ ...DIM, "font-size": "12px" }}>{`+${file.additions} -${file.deletions}`}</div>
                      </div>
                    )}
                  </For>
                  <Show when={diffs().length > DIFF_CAP}>
                    <div style={{ ...DIM, "font-size": "12px", padding: "6px 0" }}>{language.t("agents.more", { count: diffs().length - DIFF_CAP })}</div>
                  </Show>
                </Show>
              </Match>
              <Match when={tab() === "todos"}>
                <Show when={todos().length > 0} fallback={<div style={DIM}>—</div>}>
                  <For each={todos()}>
                    {(todo, index) => (
                      <div style={{ padding: "6px 0", "border-bottom": "1px solid rgba(255,255,255,.06)" }}>
                        <span style={DIM}>{`${index() + 1}. `}</span>
                        <span style={{ color: todo.status === "completed" ? "rgba(107,230,140,.95)" : "rgba(255,255,255,.95)" }}>{todo.content || "—"}</span>
                        <span style={{ ...DIM, "font-size": "12px" }}>{` · ${todo.status}`}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </Match>
              <Match when={tab() === "events"}>
                <div style={{ ...DIM, "font-size": "12px" }}>—</div>
                <Show when={info()}>
                  {(value) => (
                    <div style={{ "margin-top": "6px" }}>
                      <div style={{ ...DIM, "font-size": "12px" }}>{`created ${new Date(value().time.created).toLocaleString()}`}</div>
                      <div style={{ ...DIM, "font-size": "12px" }}>{`updated ${new Date(value().time.updated).toLocaleString()}`}</div>
                    </div>
                  )}
                </Show>
              </Match>
            </Switch>
          </div>
        </div>
      )}
    </Show>
  )
}

function previewOf(part: unknown): string {
  if (!part || typeof part !== "object") return "—"
  const record = part as Record<string, unknown>
  for (const key of ["text", "description", "prompt"]) {
    const value = record[key]
    if (typeof value === "string" && value.trim()) return value.replace(/\n/g, " ").slice(0, PREVIEW_LEN)
  }
  if (typeof record.tool === "string" && record.tool) return `tool: ${record.tool}`
  return "—"
}
