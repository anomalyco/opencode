import { For, Show, createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import type {
  BackgroundTaskJob,
  Message,
  Part,
  Session,
  SessionStatus,
  TextPart,
  ToolPart,
} from "@cedric/sdk/v2/client"
import { Collapsible } from "@cedric/ui/collapsible"
import { IconButton } from "@cedric/ui/icon-button"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"

export type BackgroundTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type BackgroundTaskItem = {
  id: string
  directory: string
  parentSessionID: string
  parentSession?: Session
  sessionID?: string
  session?: Session
  agent: string
  description: string
  status: BackgroundTaskStatus
  progress: number
  retryable: boolean
  output?: string
  detail?: string
  updatedAt: number
}

export type BackgroundTaskStoreInput = {
  directory: string
  sessions: Session[]
  messages?: Record<string, Message[] | undefined>
  parts: Record<string, Part[] | undefined>
  statuses: Record<string, SessionStatus | undefined>
  backgroundJobs: BackgroundTaskJob[]
}

type TaskResult = {
  state: "running" | "completed" | "error"
  text: string
}

const statusOrder: Record<BackgroundTaskStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  cancelled: 3,
  completed: 4,
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function progressValue(value: unknown) {
  const progress = numberValue(value)
  if (progress === undefined) return
  return Math.max(0, Math.min(100, progress))
}

function taskResultText(body: string) {
  const match = body.match(/<(?<tag>task_result|task_error)>\s*(?<text>[\s\S]*?)\s*<\/\k<tag>>/)
  return match?.groups?.text.trim()
}

function taskResults(text: string) {
  return [...text.matchAll(/<task id="([^"]+)" state="(running|completed|error)">([\s\S]*?)<\/task>/g)]
    .map((match) => {
      const id = match[1]
      const state = match[2]
      const output = taskResultText(match[3] ?? "")
      if (!id || !output) return
      if (state !== "running" && state !== "completed" && state !== "error") return
      return [id, { state, text: output }] as const
    })
    .filter((item): item is readonly [string, TaskResult] => !!item)
}

function taskPartMetadata(part: ToolPart) {
  const stateMetadata = "metadata" in part.state && part.state.metadata ? part.state.metadata : undefined
  return {
    ...(part.metadata ?? {}),
    ...(stateMetadata ?? {}),
  }
}

function taskPartTime(part: ToolPart) {
  if (!("time" in part.state)) return 0
  return "end" in part.state.time ? part.state.time.end : part.state.time.start
}

function textPartTime(part: TextPart) {
  return numberValue(part.time?.end) || numberValue(part.time?.start) || 0
}

function jobStatus(job: BackgroundTaskJob | undefined) {
  if (job?.status === "running") return "running"
  if (job?.status === "completed") return "completed"
  if (job?.status === "error") return "failed"
  if (job?.status === "cancelled") return "cancelled"
}

function taskStatus(
  part: ToolPart,
  childStatus: SessionStatus | undefined,
  result: TaskResult | undefined,
  job: BackgroundTaskJob | undefined,
) {
  const fromJob = jobStatus(job)
  if (fromJob) return fromJob
  if (result?.state === "error" || part.state.status === "error") return "failed"
  if (result?.state === "completed") return "completed"
  if (part.state.status === "pending") return "queued"
  if (part.state.status === "running" || childStatus?.type === "busy") return "running"
  if (result?.state === "running") return "running"
  return "completed"
}

function taskProgress(status: BackgroundTaskStatus, job: BackgroundTaskJob | undefined) {
  const progress = progressValue(job?.progress)
  if ((status === "queued" || status === "running") && progress !== undefined) return progress
  if (status === "queued") return 10
  if (status === "running") return 65
  return 100
}

function taskDetail(status: BackgroundTaskStatus, job: BackgroundTaskJob | undefined, liveDetail: string | undefined) {
  if (status === "running") return stringValue(liveDetail) ?? stringValue(job?.output)
  if (status === "failed") return stringValue(job?.error)
}

function taskAgent(part: ToolPart, child: Session | undefined) {
  const fromInput = stringValue(part.state.input.subagent_type)
  if (fromInput) return fromInput
  if (child?.agent) return child.agent
  const match = child?.title.match(/\(@([^)]+) subagent\)$/)
  return match?.[1] ?? "agent"
}

function taskDescription(part: ToolPart, child: Session | undefined) {
  const fromInput = stringValue(part.state.input.description)
  if (fromInput) return fromInput
  const title = "title" in part.state ? stringValue(part.state.title) : undefined
  if (title) return title
  return child?.title.replace(/\s+\(@[^)]+ subagent\)$/, "") || "Background task"
}

export function backgroundTaskMergePrompt(task: BackgroundTaskItem) {
  return [
    `Merge this background task result into the main thread: ${task.description}`,
    `Agent: ${task.agent}`,
    ...(task.output ? ["", task.output] : []),
  ].join("\n")
}

export function backgroundTasksFromStores(stores: BackgroundTaskStoreInput[]) {
  const resultBySession = new Map<string, TaskResult>()
  const messageByID = new Map<string, Message>()
  const liveDetailBySession = new Map<string, { text: string; updatedAt: number }>()

  for (const store of stores) {
    for (const messages of Object.values(store.messages ?? {})) {
      for (const message of messages ?? []) {
        messageByID.set(message.id, message)
      }
    }
  }

  for (const store of stores) {
    for (const parts of Object.values(store.parts)) {
      for (const part of parts ?? []) {
        if (part.type === "text" && !part.synthetic && messageByID.get(part.messageID)?.role === "assistant") {
          const text = stringValue(part.text)
          const updatedAt = textPartTime(part)
          const previous = liveDetailBySession.get(part.sessionID)
          if (text && (!previous || previous.updatedAt <= updatedAt)) {
            liveDetailBySession.set(part.sessionID, { text, updatedAt })
          }
        }
        if (part.type !== "text") continue
        for (const [id, result] of taskResults(part.text)) {
          resultBySession.set(id, result)
        }
      }
    }
  }

  const tasks = new Map<string, BackgroundTaskItem>()

  for (const store of stores) {
    const sessions = new Map(store.sessions.map((session) => [session.id, session] as const))
    const jobs = new Map(store.backgroundJobs.map((job) => [job.sessionID, job] as const))
    for (const parts of Object.values(store.parts)) {
      for (const part of parts ?? []) {
        if (part.type !== "tool" || part.tool !== "task") continue

        const metadata = taskPartMetadata(part)
        const childSessionID = stringValue(metadata.sessionId) ?? stringValue(metadata.jobId)
        const parentSessionID = stringValue(metadata.parentSessionId) ?? part.sessionID
        const child = childSessionID ? sessions.get(childSessionID) : undefined
        const job = childSessionID ? jobs.get(childSessionID) : undefined
        const finalResult = childSessionID ? resultBySession.get(childSessionID) : undefined
        const ownResult = part.state.status === "completed" ? taskResults(part.state.output).at(-1)?.[1] : undefined
        const taskResult = finalResult ?? ownResult
        const status = taskStatus(part, childSessionID ? store.statuses[childSessionID] : undefined, taskResult, job)
        const id = childSessionID ?? part.id
        const output =
          taskResult?.state === "completed"
            ? taskResult.text
            : job?.status === "completed"
              ? job.output
              : undefined
        const detail = taskDetail(status, job, childSessionID ? liveDetailBySession.get(childSessionID)?.text : undefined)
        const updatedAt =
          numberValue(job?.updatedAt) ||
          numberValue(job?.completedAt) ||
          numberValue(child?.time.updated) ||
          taskPartTime(part) ||
          numberValue(job?.startedAt) ||
          numberValue(sessions.get(parentSessionID)?.time.updated) ||
          0

        const item: BackgroundTaskItem = {
          id,
          directory: store.directory,
          parentSessionID,
          parentSession: sessions.get(parentSessionID),
          sessionID: childSessionID,
          session: child,
          agent: taskAgent(part, child),
          description: taskDescription(part, child),
          status,
          progress: taskProgress(status, job),
          retryable: status === "failed" && job?.retryable === true && !!childSessionID,
          output,
          detail,
          updatedAt,
        }
        const previous = tasks.get(id)
        if (!previous || previous.updatedAt <= item.updatedAt) tasks.set(id, item)
      }
    }
  }

  return [...tasks.values()].sort((a, b) => {
    const status = statusOrder[a.status] - statusOrder[b.status]
    if (status !== 0) return status
    return b.updatedAt - a.updatedAt
  })
}

function statusLabel(status: BackgroundTaskStatus) {
  if (status === "queued") return "Waiting"
  if (status === "running") return "Running"
  if (status === "failed") return "Failed"
  if (status === "cancelled") return "Stopped"
  return "Done"
}

function taskStores(directories: string[], serverSync: ReturnType<typeof useServerSync>) {
  return directories.map((directory) => {
    const [store] = serverSync.child(directory, { bootstrap: false })
    return {
      directory,
      sessions: store.session,
      messages: store.message,
      parts: store.part,
      statuses: store.session_status,
      backgroundJobs: store.background_job,
    }
  })
}

function refreshBackgroundJobs(directories: string[], serverSDK: ReturnType<typeof useServerSDK>, serverSync: ReturnType<typeof useServerSync>) {
  return Promise.all(
    directories.map((directory) => {
      const [, setStore] = serverSync.child(directory, { bootstrap: false })
      return serverSDK
        .createClient({ directory, throwOnError: true })
        .experimental.session.backgroundJobs()
        .then((response) => {
          setStore("background_job", response.data ?? [])
        })
        .catch(() => {})
    }),
  ).then(() => undefined)
}

export function BackgroundTasks(props: {
  directories: Accessor<string[]>
  onOpenSession: (session: Session) => void
  onMergeTask: (task: BackgroundTaskItem) => void
}) {
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [open, setOpen] = createSignal(true)
  const [dismissed, setDismissed] = createSignal<Record<string, true>>({})
  const tasks = createMemo(() =>
    backgroundTasksFromStores(taskStores(props.directories(), serverSync)).filter((task) => !dismissed()[task.id]),
  )
  const running = createMemo(() => tasks().filter((task) => task.status === "running" || task.status === "queued").length)

  createEffect(() => {
    const directories = props.directories()
    if (directories.length === 0) return
    void refreshBackgroundJobs(directories, serverSDK, serverSync)
  })

  const dismissTask = (task: BackgroundTaskItem) => {
    setDismissed((current) => ({ ...current, [task.id]: true }))
  }

  const stopTask = async (task: BackgroundTaskItem) => {
    if (!task.sessionID) {
      dismissTask(task)
      return
    }

    try {
      await serverSDK.createClient({ directory: task.directory, throwOnError: true }).session.abort({ sessionID: task.sessionID })
      dismissTask(task)
      showToast({ title: "Background task stopped", description: task.description })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not stop background task",
        description: error instanceof Error ? error.message : task.description,
      })
    }
  }

  const retryTask = async (task: BackgroundTaskItem) => {
    if (!task.sessionID) return

    try {
      await serverSDK
        .createClient({ directory: task.directory, throwOnError: true })
        .experimental.session.backgroundJobRetry({ sessionID: task.sessionID })
      await refreshBackgroundJobs([task.directory], serverSDK, serverSync)
      showToast({ title: "Background task retried", description: task.description })
    } catch (error) {
      showToast({
        variant: "error",
        title: "Could not retry background task",
        description: error instanceof Error ? error.message : task.description,
      })
    }
  }

  return (
    <Show when={props.directories().length > 0}>
      <section class="shrink-0 border-t border-border-weaker-base py-2" data-component="background-tasks">
        <Collapsible variant="ghost" open={open()} onOpenChange={setOpen}>
          <Collapsible.Trigger
            as="button"
            type="button"
            class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12-medium text-text-weak hover:bg-background-stronger hover:text-text-base"
          >
            <Collapsible.Arrow class="shrink-0" />
            <span class="min-w-0 flex-1 truncate">Background Tasks</span>
            <span class="shrink-0 rounded bg-background-stronger px-1.5 py-0.5 text-11-regular text-text-weak">
              {running() || tasks().length}
            </span>
          </Collapsible.Trigger>
          <Collapsible.Content>
            <Show
              when={tasks().length > 0}
              fallback={<div class="px-2 py-2 text-12-regular text-text-weak">No background tasks</div>}
            >
              <div class="flex flex-col gap-1 px-1 py-1">
                <For each={tasks()}>
                  {(task) => (
                    <div class="group rounded-md px-2 py-1.5 hover:bg-background-stronger">
                      <div class="flex min-w-0 items-start gap-2">
                        <div
                          class="mt-1.5 size-2 shrink-0 rounded-full"
                          classList={{
                            "bg-text-weak": task.status === "queued",
                            "bg-icon-info-active animate-pulse": task.status === "running",
                            "bg-syntax-success": task.status === "completed",
                            "bg-syntax-error": task.status === "failed",
                            "bg-text-disabled": task.status === "cancelled",
                          }}
                        />
                        <button
                          type="button"
                          class="min-w-0 flex-1 text-left"
                          disabled={!task.session}
                          onClick={() => {
                            if (task.session) props.onOpenSession(task.session)
                          }}
                        >
                          <div class="truncate text-13-medium text-text-base">{task.description}</div>
                          <div class="mt-0.5 flex min-w-0 items-center gap-1.5 text-11-regular text-text-weak">
                            <span class="truncate">{task.agent}</span>
                            <span class="shrink-0">·</span>
                            <span class="shrink-0">{statusLabel(task.status)}</span>
                          </div>
                          <Show when={task.detail}>
                            <div class="mt-1 line-clamp-2 break-words text-11-regular text-text-weak">
                              {task.detail}
                            </div>
                          </Show>
                        </button>
                        <div class="flex shrink-0 items-center gap-0.5 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100">
                          <Show when={task.session}>
                            <IconButton
                              icon="arrow-right"
                              variant="ghost"
                              class="size-6"
                              title="View background task"
                              aria-label="View background task"
                              onClick={() => {
                                if (task.session) props.onOpenSession(task.session)
                              }}
                            />
                          </Show>
                          <Show when={task.output}>
                            <IconButton
                              icon="prompt"
                              variant="ghost"
                              class="size-6"
                              title="Merge result"
                              aria-label="Merge result"
                              onClick={() => props.onMergeTask(task)}
                            />
                          </Show>
                          <Show when={task.status === "running" || task.status === "queued"}>
                            <IconButton
                              icon="stop"
                              variant="ghost"
                              class="size-6"
                              title="Stop background task"
                              aria-label="Stop background task"
                              onClick={() => void stopTask(task)}
                            />
                          </Show>
                          <Show when={task.retryable}>
                            <IconButton
                              icon="reset"
                              variant="ghost"
                              class="size-6"
                              title="Retry background task"
                              aria-label="Retry background task"
                              onClick={() => void retryTask(task)}
                            />
                          </Show>
                          <IconButton
                            icon="close-small"
                            variant="ghost"
                            class="size-6"
                            title="Dismiss background task"
                            aria-label="Dismiss background task"
                            onClick={() => dismissTask(task)}
                          />
                        </div>
                      </div>
                      <Show when={task.status === "running" || task.status === "queued"}>
                        <div class="ml-4 mt-1 h-1 overflow-hidden rounded-full bg-background-stronger">
                          <div
                            class="h-full rounded-full bg-icon-info-active transition-all"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Collapsible.Content>
        </Collapsible>
      </section>
    </Show>
  )
}
