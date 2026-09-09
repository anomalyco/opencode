import { Binary } from "@opencode-ai/core/util/binary"
import { getFilename } from "@opencode-ai/core/util/path"
import type { FileDiffInfo } from "@opencode-ai/client/promise"
import type { PermissionRequest, QuestionRequest, Session, Todo } from "@opencode-ai/sdk/v2/client"
import { createMemo, createSignal, mapArray, onCleanup, startTransition } from "solid-js"
import { produce } from "solid-js/store"
import { useGlobal } from "@/context/global"
import { useLayout, type LocalProject } from "@/context/layout"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { ServerConnection } from "@/context/server"
import { useTabs } from "@/context/tabs"
import { compareSessionTime, displayName, projectForSession } from "@/pages/layout/helpers"
import { pathKey } from "@/utils/path-key"
import { createServerFeed, type ServerFeed } from "./mission-control-feed"
import { deriveMissionControlStatus, type MissionControlStatus } from "./mission-control-model"

export type MissionControlRecord = {
  key: string
  server: ServerConnection.Key
  session: Session
  project?: LocalProject
  projectName: string
  status: MissionControlStatus
  permission?: PermissionRequest
  question?: QuestionRequest
  retry?: { attempt: number; message: string }
  unseen: number
  diffs: FileDiffInfo[]
  todos: Todo[]
  filesChanged: number
  additions: number
  deletions: number
  branch?: string
  worktree?: string
  model?: string
  agent?: string
  cost: number
  tokens: number
  step: string
  failed: boolean
  activityAt: number
}

export type MissionControlDetailTab = "summary" | "conversation" | "changes" | "context"

export type MissionControlBucket = {
  id: MissionControlStatus
  title: string
  records: MissionControlRecord[]
}

// Ordered most to least urgent so the session list always reads top-down by priority.
const BUCKETS = [
  { id: "attention", title: "Needs you" },
  { id: "working", title: "Working" },
  { id: "ready", title: "Ready to review" },
  { id: "idle", title: "Idle / done" },
] as const satisfies readonly { id: MissionControlStatus; title: string }[]

export function createMissionControlController(input: { inspect: (tab: MissionControlDetailTab) => void }) {
  const global = useGlobal()
  const layout = useLayout()
  const tabs = useTabs()
  const notification = useNotification()
  const permission = usePermission()
  const [now, setNow] = createSignal(Date.now())
  const clock = window.setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => window.clearInterval(clock))

  // mapArray owns a root per server, so a disconnected server disposes its feed and event listener.
  const feeds = mapArray(
    () => global.servers.list(),
    (conn) => createServerFeed(conn, global.ensureServerCtx(conn)),
  )

  const records = createMemo(() =>
    feeds()
      .flatMap((feed) => serverRecords(feed))
      .sort((a, b) => compareSessionTime(a.session, b.session)),
  )

  const filtered = createMemo(() => {
    const term = layout.missionControl.query().trim().toLowerCase()
    return records().filter((record) => {
      if (!term) return true
      return `${record.session.title} ${record.projectName}`.toLowerCase().includes(term)
    })
  })

  const buckets = createMemo<MissionControlBucket[]>(() =>
    BUCKETS.map((bucket) => ({ ...bucket, records: filtered().filter((record) => record.status === bucket.id) })),
  )

  const selectedKey = createMemo(() => {
    const current = layout.missionControl.selected()
    const list = filtered()
    if (current === "") return undefined
    if (current && list.some((record) => record.key === current)) return current
    return list.find((record) => record.status !== "idle")?.key
  })
  const selected = createMemo(() => filtered().find((record) => record.key === selectedKey()))

  const feedFor = (server: ServerConnection.Key) => feeds().find((feed) => feed.key === server)

  const select = (record: MissionControlRecord, tab: MissionControlDetailTab = "summary") => {
    layout.missionControl.setSelected(record.key)
    input.inspect(tab)
    void feedFor(record.server)
      ?.ctx.sync.session.sync(record.session.id)
      .catch(() => {})
  }

  const afterSelection = (record: MissionControlRecord, tab: MissionControlDetailTab, action: () => void) => {
    select(record, tab)
    window.setTimeout(action, 0)
  }

  return {
    data: {
      total: () => records().length,
      buckets,
      attention: () => records().filter((record) => record.status === "attention").length,
      working: () => records().filter((record) => record.status === "working").length,
      ready: () => records().filter((record) => record.status === "ready").length,
      now,
      loading: () => feeds().some((feed) => feed.loading()),
    },
    filter: {
      query: layout.missionControl.query,
      setQuery: (query: string) => layout.missionControl.setQuery(query),
    },
    selection: {
      key: selectedKey,
      record: selected,
      select,
      clear: () => layout.missionControl.setSelected(""),
      move: (delta: number) => {
        const list = filtered()
        if (list.length === 0) return
        const at = list.findIndex((record) => record.key === selectedKey())
        const next = list[Math.min(list.length - 1, Math.max(0, (at === -1 ? 0 : at) + delta))]
        if (next) select(next)
      },
    },
    action: {
      decide: async (record: MissionControlRecord, reply: "once" | "always" | "reject") => {
        const request = record.permission
        const feed = feedFor(record.server)
        if (!request || !feed) return
        // Drop it locally first: the replied event also clears it, but waiting makes the card flicker.
        feed.ctx.sync.session.set(
          "permission",
          request.sessionID,
          produce((draft) => {
            if (!draft) return
            const match = Binary.search(draft, request.id, (item) => item.id)
            if (match.found) draft.splice(match.index, 1)
          }),
        )
        await feed.ctx.sdk.api.permission
          .reply({
            sessionID: request.sessionID,
            requestID: request.id,
            reply,
            location: { directory: record.session.directory },
          })
          .catch(() => {})
      },
      interrupt: async (record: MissionControlRecord) => {
        await feedFor(record.server)
          ?.ctx.sdk.api.session.interrupt({ sessionID: record.session.id })
          .catch(() => {})
      },
      reply: (record: MissionControlRecord) => {
        afterSelection(record, "conversation", () => {
          document.querySelector<HTMLElement>('[data-component="mission-control"] [aria-label="Prompt"]')?.focus()
        })
      },
      review: (record: MissionControlRecord) => {
        select(record, "changes")
      },
      open: (record: MissionControlRecord) => {
        const feed = feedFor(record.server)
        if (!feed) return
        feed.ctx.projects.open(record.session.directory)
        feed.ctx.projects.touch(record.session.directory)
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: record.server, sessionId: record.session.id })
          tabs.select(tab)
        })
      },
    },
  }

  function serverRecords(feed: ServerFeed): MissionControlRecord[] {
    const projects = feed.ctx.projects.list()
    const byID = new Map(projects.flatMap((project) => (project.id ? [[project.id, project] as const] : [])))
    const directories = new Set(
      projects.flatMap((project) => [project.worktree, ...(project.sandboxes ?? [])]).map(pathKey),
    )
    const pending = pendingByRoot(feed)
    const notifications = notification.ensureServerState(feed.key)

    return feed.sessions().flatMap((session) => {
      if (!directories.has(pathKey(session.directory))) return []
      const project = projectForSession(session, projects, byID)
      const requests = pending.get(session.id)
      const status = feed.ctx.sync.session.data.session_status[session.id]
      const unseen = notifications.session.unseenCount(session.id)
      const failed = notifications.session.unseenHasError(session.id)
      const diffs = feed.ctx.sync.session.data.session_diff[session.id] ?? []
      const filesChanged = session.summary?.files ?? diffs.length
      const additions = session.summary?.additions ?? diffs.reduce((total, diff) => total + (diff.additions ?? 0), 0)
      const deletions = session.summary?.deletions ?? diffs.reduce((total, diff) => total + (diff.deletions ?? 0), 0)
      const messages = feed.ctx.sync.session.data.message[session.id] ?? []
      const assistant = [...messages].reverse().find((message) => message.role === "assistant")
      const parts = assistant ? (feed.ctx.sync.session.data.part[assistant.id] ?? []) : []
      const tool = [...parts].reverse().find((part) => part.type === "tool")
      const toolFailed = tool?.type === "tool" && tool.state.status === "error"
      const todos = feed.ctx.sync.session.data.todo[session.id] ?? []
      const currentTodo = todos.find((todo) => todo.status === "in_progress")
      const child = feed.ctx.sync.child(session.directory, { bootstrap: false })[0]
      const derived = deriveMissionControlStatus({
        requests,
        status: status?.type,
        unseen,
        failed: failed || toolFailed,
        changes: filesChanged,
      })
      return [
        {
          key: `${feed.key}\0${session.id}`,
          server: feed.key,
          session,
          project,
          projectName: project ? displayName(project) : session.directory,
          status: derived,
          permission: requests?.permission,
          question: requests?.question,
          retry: status?.type === "retry" ? { attempt: status.attempt, message: status.message } : undefined,
          unseen,
          diffs,
          todos,
          filesChanged,
          additions,
          deletions,
          branch: child.vcs?.branch,
          worktree:
            project && pathKey(project.worktree) !== pathKey(session.directory)
              ? getFilename(session.directory)
              : undefined,
          model: session.model?.id ?? (assistant?.role === "assistant" ? assistant.modelID : undefined),
          agent: session.agent ?? (assistant?.role === "assistant" ? assistant.agent : undefined),
          cost: session.cost ?? 0,
          tokens: session.tokens
            ? session.tokens.input +
              session.tokens.output +
              session.tokens.reasoning +
              session.tokens.cache.read +
              session.tokens.cache.write
            : 0,
          step: describeStep({
            requests,
            status: derived,
            retry: status?.type === "retry" ? status.message : undefined,
            failed: failed || toolFailed,
            todo: currentTodo?.content,
            tool:
              tool?.type === "tool"
                ? tool.state.status === "running" || tool.state.status === "completed"
                  ? tool.state.title || tool.tool
                  : tool.tool
                : undefined,
            files: filesChanged,
          }),
          failed: failed || toolFailed,
          activityAt:
            tool?.type === "tool" && tool.state.status === "running" ? tool.state.time.start : session.time.updated,
        },
      ]
    })
  }

  // Requests are raised by whichever session ran the tool, including subagents, so each one
  // is folded onto the root session that owns the card.
  function pendingByRoot(feed: ServerFeed) {
    const state = permission.ensureServerState(feed.key)
    const session = feed.ctx.sync.session
    const result = new Map<string, { permission?: PermissionRequest; question?: QuestionRequest }>()
    const rootOf = (sessionID: string) => session.lineage.peek(sessionID)?.root.id ?? sessionID

    for (const [sessionID, requests] of Object.entries(session.data.permission)) {
      const match = requests?.find((request) => !state.autoResponds(request, session.get(sessionID)?.directory))
      if (!match) continue
      const root = rootOf(sessionID)
      result.set(root, { ...result.get(root), permission: match })
    }
    for (const [sessionID, requests] of Object.entries(session.data.question)) {
      const match = requests?.[0]
      if (!match) continue
      const root = rootOf(sessionID)
      result.set(root, { ...result.get(root), question: match })
    }
    return result
  }
}

export type MissionControlController = ReturnType<typeof createMissionControlController>

function describeStep(input: {
  requests?: { permission?: PermissionRequest; question?: QuestionRequest }
  status: MissionControlStatus
  retry?: string
  failed: boolean
  todo?: string
  tool?: string
  files: number
}) {
  if (input.requests?.permission) return requestLabel(input.requests.permission)
  const question = input.requests?.question?.questions[0]
  if (question) return question.header || question.question
  if (input.retry) return input.retry
  if (input.failed) return input.tool ? `${input.tool} failed` : "Run failed"
  if (input.todo) return input.todo
  if (input.status === "working" && input.tool) return input.tool
  if (input.status === "working") return "Working on task"
  if (input.status === "ready") return input.files === 1 ? "1 file changed" : `${input.files} files changed`
  return input.tool ? `Last action: ${input.tool}` : "No active work"
}

function requestLabel(permission: PermissionRequest) {
  const target = permission.patterns[0]
  return target ? `${permission.permission}: ${target}` : `Approve ${permission.permission}`
}
