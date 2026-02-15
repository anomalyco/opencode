import { useSync } from "@tui/context/sync"
import { createMemo, For, Show, Switch, Match } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../../context/theme"
import { Locale } from "@/util/locale"
import path from "path"
import type { AssistantMessage, ToolPart as SessionToolPart } from "@opencode-ai/sdk/v2"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { useKeybind } from "../../context/keybind"
import { useDirectory } from "../../context/directory"
import { useKV } from "../../context/kv"
import { TodoItem } from "../../component/todo-item"

export function Sidebar(props: { sessionID: string; overlay?: boolean; progressPlaceholder?: boolean }) {
  const sync = useSync()
  const { theme } = useTheme()
  const session = createMemo(() => sync.session.get(props.sessionID)!)
  const diff = createMemo(() => sync.data.session_diff[props.sessionID] ?? [])
  const todo = createMemo(() => sync.data.todo[props.sessionID] ?? [])
  const messages = createMemo(() => sync.data.message[props.sessionID] ?? [])

  const [expanded, setExpanded] = createStore({
    mcp: true,
    diff: true,
    todo: true,
    lsp: true,
    plans: true,
  })

  // Sort MCP servers alphabetically for consistent display order
  const mcpEntries = createMemo(() => Object.entries(sync.data.mcp).sort(([a], [b]) => a.localeCompare(b)))

  // Count connected and error MCP servers for collapsed header display
  const connectedMcpCount = createMemo(() => mcpEntries().filter(([_, item]) => item.status === "connected").length)
  const errorMcpCount = createMemo(
    () =>
      mcpEntries().filter(
        ([_, item]) =>
          item.status === "failed" || item.status === "needs_auth" || item.status === "needs_client_registration",
      ).length,
  )

  const cost = createMemo(() => {
    const total = messages().reduce((sum, x) => sum + (x.role === "assistant" ? x.cost : 0), 0)
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(total)
  })

  const context = createMemo(() => {
    const last = messages().findLast((x) => x.role === "assistant" && x.tokens.output > 0) as AssistantMessage
    if (!last) return
    const total =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = sync.data.provider.find((x) => x.id === last.providerID)?.models[last.modelID]
    return {
      tokens: total.toLocaleString(),
      percentage: model?.limit.context ? Math.round((total / model.limit.context) * 100) : null,
    }
  })

  const directory = useDirectory()
  const kv = useKV()
  const [progressExpanded, setProgressExpanded] = kv.signal("sidebar_progress_observability_expanded", false)
  const parts = createMemo(() => messages().flatMap((message) => sync.data.part[message.id] ?? []))
  const toolParts = createMemo(() => parts().filter((part): part is SessionToolPart => part.type === "tool"))
  const isReadToolName = (tool: string | undefined) => {
    const normalized = (tool ?? "").toLowerCase()
    return normalized === "read" || normalized === "functions.read"
  }
  const toolMetrics = createMemo(() => {
    const items = toolParts()
    let pending = 0
    let running = 0
    let completed = 0
    let error = 0
    let filesRead = 0
    const filesReadUnique = new Set<string>()

    for (const item of items) {
      if (item.state.status === "pending") pending++
      if (item.state.status === "running") running++
      if (item.state.status === "completed") completed++
      if (item.state.status === "error") error++

      if (!isReadToolName(item.tool) || item.state.status !== "completed") continue
      const loaded = (item.state.metadata as { loaded?: unknown })?.loaded
      if (!Array.isArray(loaded)) continue
      for (const value of loaded) {
        if (typeof value !== "string") continue
        filesRead++
        filesReadUnique.add(value)
      }
    }

    return {
      pending,
      running,
      completed,
      error,
      filesRead,
      filesReadUnique: filesReadUnique.size,
      toolCalls: items.length,
    }
  })
  const filesModified = createMemo(() => new Set(diff().map((item) => item.file)).size)
  const currentAgent = createMemo(() => {
    const lastAssistant = messages().findLast((item): item is AssistantMessage => item.role === "assistant")
    const fallback = sync.data.agent.find((item) => !item.hidden && item.mode !== "subagent")
    const name = lastAssistant?.agent ?? fallback?.name ?? "unknown"
    const info = sync.data.agent.find((item) => item.name === name)
    return {
      name,
      mode: info?.mode ?? lastAssistant?.mode,
    }
  })
  const assistantAgentByMessageID = createMemo(() => {
    const result = new Map<string, string>()
    for (const message of messages()) {
      if (message.role !== "assistant") continue
      result.set(message.id, message.agent)
    }
    return result
  })
  const recentAgents = createMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    const messageItems = messages()
    for (let i = messageItems.length - 1; i >= 0; i--) {
      const message = messageItems[i]
      if (message.role !== "assistant") continue
      if (!message.agent || seen.has(message.agent)) continue
      seen.add(message.agent)
      result.push(message.agent)
    }
    const partItems = parts()
    for (let i = partItems.length - 1; i >= 0; i--) {
      const part = partItems[i]
      const name = part.type === "subtask" ? part.agent : part.type === "agent" ? part.name : undefined
      if (!name || seen.has(name)) continue
      seen.add(name)
      result.push(name)
    }
    return result
  })
  const recentAgentSummary = createMemo(() => {
    const items = recentAgents()
    if (items.length === 0) return "없음"
    return items.join(", ")
  })
  const agentToolCallCounts = createMemo(() => {
    const counts = new Map<string, number>()
    const agentByMessageID = assistantAgentByMessageID()
    for (const part of toolParts()) {
      const agent = agentByMessageID.get(part.messageID)
      if (!agent) continue
      counts.set(agent, (counts.get(agent) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  })
  const agentToolCallSummary = createMemo(() => {
    const items = agentToolCallCounts()
    if (items.length === 0) return "없음"
    return items.map(([name, count]) => `${name} ${count}`).join(" · ")
  })
  const sessionStatus = createMemo(() => sync.data.session_status?.[props.sessionID]?.type)
  const statusFromSession = (status: string | undefined) => {
    if (status === "error") return "Error"
    if (status === "busy") return "Running"
    if (status === "idle") return "Waiting"
    return undefined
  }
  const statusLine = createMemo(() => {
    const metrics = toolMetrics()
    if (metrics.error > 0) return { label: "Error", auxiliary: undefined }
    if (metrics.running > 0) return { label: "Running", auxiliary: undefined }
    if (metrics.pending > 0) return { label: "Waiting", auxiliary: undefined }
    if (metrics.toolCalls > 0) return { label: "Completed", auxiliary: undefined }

    const status = sessionStatus()
    const mapped = statusFromSession(status)
    return {
      label: mapped ?? "Waiting",
      auxiliary: status ?? undefined,
    }
  })
  const statusColor = createMemo(() => {
    if (statusLine().label === "Running") return theme.warning
    if (statusLine().label === "Error") return theme.error
    if (statusLine().label === "Completed") return theme.success
    return theme.textMuted
  })
  const statusLabelText = (label: string) => {
    if (label === "Error") return "오류"
    if (label === "Running") return "실행 중"
    if (label === "Waiting") return "대기 중"
    if (label === "Completed") return "완료"
    return label
  }
  const messageWarning = createMemo(() => messages().length >= 40)
  const toolPartWarning = createMemo(() => toolMetrics().toolCalls >= 80)
  const fileReadWarning = createMemo(() => {
    if (toolMetrics().filesRead > 60) return "critical"
    if (toolMetrics().filesRead > 30) return "warning"
    return "none"
  })
  const latestActiveTool = createMemo(() =>
    toolParts().findLast((item) => item.state.status === "running" || item.state.status === "pending"),
  )
  const latestSettledTool = createMemo(() =>
    toolParts().findLast((item) => item.state.status === "completed" || item.state.status === "error"),
  )
  const stageFromTool = (tool: string | undefined, input: Record<string, any> | undefined) => {
    if (!tool) return undefined
    if (["plan_enter", "plan_exit", "task", "todoread", "todowrite", "question", "skill"].includes(tool)) return "PLAN"
    if (["read", "grep", "glob", "list", "ls", "webfetch", "websearch", "codesearch"].includes(tool)) return "READ"
    if (["edit", "write", "multiedit", "apply_patch", "patch"].includes(tool)) return "APPLY"
    if (tool === "bash") {
      const command = String(input?.command ?? input?.cmd ?? "").toLowerCase()
      if (command.includes("test") || command.includes("lint")) return "TEST"
      if (command.includes("diff") || command.includes("git status")) return "DIFF"
      return "APPLY"
    }
    return undefined
  }
  const stageLine = createMemo(() => {
    const metrics = toolMetrics()
    const active = latestActiveTool()
    const settled = latestSettledTool()
    if (metrics.running > 0 || metrics.pending > 0) {
      const stage = stageFromTool(active?.tool, active?.state.input) ?? (diff().length > 0 ? "DIFF" : "PLAN")
      return stage
    }
    if (metrics.error > 0) {
      return stageFromTool(settled?.tool, settled?.state.input) ?? (diff().length > 0 ? "DIFF" : "PLAN")
    }
    if (metrics.completed > 0) return "DONE"
    return "PLAN"
  })
  const summaryWarningBadge = createMemo(() => {
    if (fileReadWarning() === "critical" || toolMetrics().error > 0) return "🔴"
    if (messageWarning() || toolPartWarning() || fileReadWarning() === "warning") return "⚠️"
    return ""
  })
  const progressSummary = createMemo(() => {
    const text = `상태: ${statusLabelText(statusLine().label)} · 단계: ${stageLine()}`
    return summaryWarningBadge() ? `${text} · ${summaryWarningBadge()}` : text
  })

  const hasProviders = createMemo(() =>
    sync.data.provider.some((x) => x.id !== "opencode" || Object.values(x.models).some((y) => y.cost?.input !== 0)),
  )
  const gettingStartedDismissed = createMemo(() => kv.get("dismissed_getting_started", false))

  return (
    <Show when={session()}>
      <box
        backgroundColor={theme.backgroundPanel}
        width={42}
        height="100%"
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={2}
        position={props.overlay ? "absolute" : "relative"}
      >
        <scrollbox flexGrow={1}>
          <box flexShrink={0} gap={1} paddingRight={1}>
            <Show when={session().share?.url}>
              <text fg={theme.textMuted}>{session().share!.url}</text>
            </Show>
            <box>
              <text fg={theme.text}>
                <b>컨텍스트</b>
              </text>
              <text fg={theme.textMuted}>{context()?.tokens ?? 0} 토큰</text>
              <text fg={theme.textMuted}>{context()?.percentage ?? 0}% 사용됨</text>
              <text fg={theme.textMuted}>{cost()} 사용</text>
            </box>
            <Show when={props.progressPlaceholder}>
              <box>
                <box flexDirection="row" gap={1} onMouseDown={() => setProgressExpanded((prev) => !prev)}>
                  <text fg={theme.text}>{progressExpanded() ? "▼" : "▶"}</text>
                  <text fg={theme.text}>
                    <b>진행/관찰</b>
                  </text>
                  <Show when={!progressExpanded()}>
                    <text fg={theme.textMuted}> {progressSummary()}</text>
                  </Show>
                </box>
                <Show when={progressExpanded()}>
                  <text fg={theme.textMuted}>
                    에이전트: {currentAgent().name}
                    <Show when={currentAgent().mode}>
                      {(mode) => <> ({mode()})</>}
                    </Show>
                  </text>
                  <text fg={theme.textMuted}>최근 에이전트: {recentAgentSummary()}</text>
                  <text fg={theme.textMuted}>에이전트별 호출: {agentToolCallSummary()}</text>
                  <text fg={statusColor()}>
                    상태: {statusLabelText(statusLine().label)}
                    <Show when={statusLine().auxiliary}>
                      {(aux) => <> ({aux()})</>}
                    </Show>
                  </text>
                  <text fg={theme.textMuted}>단계: {stageLine()}</text>
                  <text fg={theme.textMuted}>
                    읽은 파일: {toolMetrics().filesRead}
                    <Show when={fileReadWarning() !== "none"}>
                      <span style={{ fg: fileReadWarning() === "critical" ? theme.error : theme.warning }}>
                        {" "}
                        {fileReadWarning() === "critical" ? "🔴" : "⚠️"}
                      </span>
                    </Show>
                  </text>
                  <text fg={theme.textMuted}>읽은 파일(고유): {toolMetrics().filesReadUnique}</text>
                  <text fg={theme.textMuted}>수정된 파일: {filesModified()}</text>
                  <text fg={theme.textMuted}>도구 호출: {toolMetrics().toolCalls}</text>
                  <text fg={theme.textMuted}>오류 수: {toolMetrics().error}</text>
                  <text fg={theme.textMuted}>
                    메시지 수: {messages().length}
                    <Show when={messageWarning()}>
                      <span style={{ fg: theme.warning }}> ⚠️</span>
                    </Show>
                  </text>
                  <text fg={theme.textMuted}>
                    도구 파트: {toolMetrics().toolCalls}
                    <Show when={toolPartWarning()}>
                      <span style={{ fg: theme.warning }}> ⚠️</span>
                    </Show>
                  </text>
                </Show>
              </box>
            </Show>
            <Show when={todo().length > 0 || sync.data.lsp.length > 0}>
              <box>
                <box flexDirection="row" gap={1} onMouseDown={() => setExpanded("plans", !expanded.plans)}>
                  <text fg={theme.text}>{expanded.plans ? "▼" : "▶"}</text>
                  <text fg={theme.text}>
                    <b>계획 (Plans)</b>
                    <Show when={!expanded.plans}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({todo().length} todo, {sync.data.lsp.length} lsp)
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={expanded.plans}>
                  <Show when={todo().length > 0} fallback={<text fg={theme.textMuted}>할 일이 없습니다</text>}>
                    <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                  </Show>
                  <Show when={sync.data.lsp.length > 0}>
                    <text fg={theme.textMuted}>LSP 참고</text>
                    <For each={sync.data.lsp}>
                      {(item) => (
                        <box flexDirection="row" gap={1}>
                          <text
                            flexShrink={0}
                            style={{
                              fg: {
                                connected: theme.success,
                                error: theme.error,
                              }[item.status],
                            }}
                          >
                            •
                          </text>
                          <text fg={theme.textMuted}>
                            {item.id} {item.root}
                          </text>
                        </box>
                      )}
                    </For>
                  </Show>
                </Show>
              </box>
            </Show>
            <Show when={mcpEntries().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => mcpEntries().length > 2 && setExpanded("mcp", !expanded.mcp)}
                >
                  <Show when={mcpEntries().length > 2}>
                    <text fg={theme.text}>{expanded.mcp ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>MCP</b>
                    <Show when={!expanded.mcp}>
                      <span style={{ fg: theme.textMuted }}>
                        {" "}
                        ({connectedMcpCount()} 활성
                        {errorMcpCount() > 0 ? `, ${errorMcpCount()} 오류` : ""})
                      </span>
                    </Show>
                  </text>
                </box>
                <Show when={mcpEntries().length <= 2 || expanded.mcp}>
                  <For each={mcpEntries()}>
                    {([key, item]) => (
                      <box flexDirection="row" gap={1}>
                        <text
                          flexShrink={0}
                          style={{
                            fg: (
                              {
                                connected: theme.success,
                                failed: theme.error,
                                disabled: theme.textMuted,
                                needs_auth: theme.warning,
                                needs_client_registration: theme.error,
                              } as Record<string, typeof theme.success>
                            )[item.status],
                          }}
                        >
                          •
                        </text>
                        <text fg={theme.text} wrapMode="word">
                          {key}{" "}
                          <span style={{ fg: theme.textMuted }}>
                            <Switch fallback={item.status}>
                              <Match when={item.status === "connected"}>연결됨</Match>
                              <Match when={item.status === "failed" && item}>{(val) => <i>{val().error}</i>}</Match>
                              <Match when={item.status === "disabled"}>비활성화됨</Match>
                              <Match when={(item.status as string) === "needs_auth"}>인증 필요</Match>
                              <Match when={(item.status as string) === "needs_client_registration"}>
                                클라이언트 ID 필요
                              </Match>
                            </Switch>
                          </span>
                        </text>
                      </box>
                    )}
                  </For>
                </Show>
              </box>
            </Show>
            <box>
              <box
                flexDirection="row"
                gap={1}
                onMouseDown={() => sync.data.lsp.length > 2 && setExpanded("lsp", !expanded.lsp)}
              >
                <Show when={sync.data.lsp.length > 2}>
                  <text fg={theme.text}>{expanded.lsp ? "▼" : "▶"}</text>
                </Show>
                <text fg={theme.text}>
                  <b>LSP</b>
                </text>
              </box>
              <Show when={sync.data.lsp.length <= 2 || expanded.lsp}>
                <Show when={sync.data.lsp.length === 0}>
                  <text fg={theme.textMuted}>
                    {sync.data.config.lsp === false
                      ? "설정에서 LSP가 비활성화되었습니다"
                      : "파일을 읽으면 LSP가 활성화됩니다"}
                  </text>
                </Show>
                <For each={sync.data.lsp}>
                  {(item) => (
                    <box flexDirection="row" gap={1}>
                      <text
                        flexShrink={0}
                        style={{
                          fg: {
                            connected: theme.success,
                            error: theme.error,
                          }[item.status],
                        }}
                      >
                        •
                      </text>
                      <text fg={theme.textMuted}>
                        {item.id} {item.root}
                      </text>
                    </box>
                  )}
                </For>
              </Show>
            </box>
            <Show when={todo().length > 0 && todo().some((t) => t.status !== "completed")}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => todo().length > 2 && setExpanded("todo", !expanded.todo)}
                >
                  <Show when={todo().length > 2}>
                    <text fg={theme.text}>{expanded.todo ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>할 일</b>
                  </text>
                </box>
                <Show when={todo().length <= 2 || expanded.todo}>
                  <For each={todo()}>{(todo) => <TodoItem status={todo.status} content={todo.content} />}</For>
                </Show>
              </box>
            </Show>
            <Show when={diff().length > 0}>
              <box>
                <box
                  flexDirection="row"
                  gap={1}
                  onMouseDown={() => diff().length > 2 && setExpanded("diff", !expanded.diff)}
                >
                  <Show when={diff().length > 2}>
                    <text fg={theme.text}>{expanded.diff ? "▼" : "▶"}</text>
                  </Show>
                  <text fg={theme.text}>
                    <b>수정된 파일</b>
                  </text>
                </box>
                <Show when={diff().length <= 2 || expanded.diff}>
                  <For each={diff() || []}>
                    {(item) => {
                      return (
                        <box flexDirection="row" gap={1} justifyContent="space-between">
                          <text fg={theme.textMuted} wrapMode="none">
                            {item.file}
                          </text>
                          <box flexDirection="row" gap={1} flexShrink={0}>
                            <Show when={item.additions}>
                              <text fg={theme.diffAdded}>+{item.additions}</text>
                            </Show>
                            <Show when={item.deletions}>
                              <text fg={theme.diffRemoved}>-{item.deletions}</text>
                            </Show>
                          </box>
                        </box>
                      )
                    }}
                  </For>
                </Show>
              </box>
            </Show>
          </box>
        </scrollbox>

        <box flexShrink={0} gap={1} paddingTop={1}>
          <Show when={!hasProviders() && !gettingStartedDismissed()}>
            <box
              backgroundColor={theme.backgroundElement}
              paddingTop={1}
              paddingBottom={1}
              paddingLeft={2}
              paddingRight={2}
              flexDirection="row"
              gap={1}
            >
              <text flexShrink={0} fg={theme.text}>
                ⬖
              </text>
              <box flexGrow={1} gap={1}>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme.text}>
                    <b>시작하기</b>
                  </text>
                  <text fg={theme.textMuted} onMouseDown={() => kv.set("dismissed_getting_started", true)}>
                    ✕
                  </text>
                </box>
                <text fg={theme.textMuted}>OpenCode는 즉시 시작할 수 있는 무료 모델을 제공합니다.</text>
                <text fg={theme.textMuted}>
                  75개 이상의 제공자를 연결해 Claude, GPT, Gemini 등 다양한 모델을 사용할 수 있습니다
                </text>
                <box flexDirection="row" gap={1} justifyContent="space-between">
                  <text fg={theme.text}>제공자 연결</text>
                  <text fg={theme.textMuted}>/connect</text>
                </box>
              </box>
            </box>
          </Show>
          <text>
            <span style={{ fg: theme.textMuted }}>{directory().split("/").slice(0, -1).join("/")}/</span>
            <span style={{ fg: theme.text }}>{directory().split("/").at(-1)}</span>
          </text>
          <text fg={theme.textMuted}>
            <span style={{ fg: theme.success }}>•</span> <b>Open</b>
            <span style={{ fg: theme.text }}>
              <b>Code</b>
            </span>{" "}
            <span>{Installation.VERSION}</span>
          </text>
        </box>
      </box>
    </Show>
  )
}
