import type {
  JobInfo,
  JsonValue,
  SessionInfo,
  SessionMessageAssistant,
  SessionMessageInfo,
  ShellInfo,
} from "@opencode/client/promise"
import { Option, Schema } from "effect"
import { createMemo } from "solid-js"

// `started` is when the work began running: the latest call's run time, the child session's creation, or the shell's
// start.
type Subagent = {
  id: string
  type: "subagent"
  sessionID: string
  label: string
  agent?: string
  started: number
  // Running jobs in its tree, which its Stop cancels.
  jobs?: string[]
}

type Task = Subagent | { id: string; type: "shell"; label: string; started: number }

type Script = { id: string; type: "script"; label: string; started: number }

// The turn's foreground work. A script blocks along with the shells it is running.
export type BlockingTask = {
  partID: string
  id?: string
  label?: string
  agent?: undefined
  started: number
} & ({ type: "shell" } | { type: "execute"; commands: string[]; background: boolean })

const decodeString = Schema.decodeUnknownOption(Schema.String)

// A script's calls stream through its execute call's metadata.
const decodeCall = Schema.decodeUnknownOption(
  Schema.Struct({
    tool: Schema.String,
    status: Schema.String,
    input: Schema.Struct({ command: Schema.String }),
  }),
)

// Tool input and metadata are open JSON, so a field of the wrong type reads as absent.
const text = (value: JsonValue | undefined) => Option.getOrUndefined(decodeString(value))

export function createSessionBackground(input: {
  sessionID: () => string | undefined
  messages: (id: string) => SessionMessageInfo[]
  sessions: () => SessionInfo[]
  status: (id: string) => "idle" | "running"
  shells: () => ShellInfo[]
  // Running background jobs in the session's tree.
  jobs?: () => readonly JobInfo[]
}) {
  const history = createMemo(() => {
    // The latest call for each child names it; calls never decide whether it still runs.
    const calls = new Map<string, { label: string | undefined; agent: string | undefined; started: number }>()
    // A script moved to the background ends its execute call with the job's id; its first line names it.
    const scripts = new Map<string, string | undefined>()
    const id = input.sessionID()

    const assistant = (id ? input.messages(id) : []).reduce<SessionMessageAssistant | undefined>((latest, message) => {
      if (message.type !== "assistant") return latest
      message.content.forEach((part) => {
        if (part.type === "tool" && part.name === "execute" && part.state.status === "completed") {
          const jobID = text(part.state.metadata?.jobID)

          if (jobID) scripts.set(jobID, firstLine(text(part.state.input.code)))
        }

        if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") return
        const sessionID = text(part.state.metadata?.sessionID)

        if (!sessionID) return
        calls.set(sessionID, {
          label: text(part.state.input.description),
          agent: text(part.state.input.agent),
          started: part.time.ran ?? part.time.created,
        })
      })

      return message.time.completed === undefined ? message : latest
    }, undefined)

    return {
      calls,
      scripts,
      blocking:
        assistant?.content.flatMap((part): BlockingTask[] => {
          if (part.type !== "tool" || part.state.status !== "running") return []

          // A script in the foreground blocks the turn, and so do the shells it is running.
          if (part.name === "execute")
            return [
              {
                type: "execute",
                partID: part.id,
                id: undefined,
                label: firstLine(text(part.state.input.code)),
                agent: undefined,
                started: part.time.ran ?? part.time.created,
                commands: executeShellCommands(part.state.metadata.toolCalls),
                // Only a script running as a job can move to the background.
                background: part.state.metadata.background === true,
              },
            ]

          if (part.name !== "shell") return []

          return [
            {
              type: "shell",
              partID: part.id,
              id: text(part.state.metadata.shellID),
              label: text(part.state.input.command),
              agent: undefined,
              started: part.time.ran ?? part.time.created,
            },
          ]
        }) ?? [],
    }
  })

  // A script that can't move still covers its shells, but isn't offered to move.
  const blocking = createMemo(() => history().blocking.filter((item) => item.type !== "execute" || item.background))

  // The sessions below this one, each with the running jobs of its own tree. A subagent job belongs to the child it
  // runs. The value holds while it names the same sessions and jobs, so a session or a job outside this tree, however
  // many the server has, redoes nothing that reads it.
  const below = createMemo(
    () => {
      const id = input.sessionID()

      if (!id) return []
      const sessions = input.sessions()
      const parents = new Map(sessions.map((info) => [info.id, info.parentID]))

      const descends = (sessionID: string, ancestor: string) => {
        const seen = new Set<string>()
        let parentID = parents.get(sessionID)

        while (parentID && !seen.has(parentID)) {
          if (parentID === ancestor) return true
          seen.add(parentID)
          parentID = parents.get(parentID)
        }

        return false
      }

      const jobs = (input.jobs?.() ?? []).filter((job) => job.status === "running")

      // The session list is most recently updated first, so its order would move a child each time its info is read
      // again.
      return oldestFirst(
        sessions.filter((info) => descends(info.id, id)),
        (info) => info.time.created,
      ).map((info) => ({
        info,
        jobs: jobs.filter((job) => {
          const owner = job.kind === "subagent" ? job.childSessionID : job.sessionID

          return owner === info.id || descends(owner, info.id)
        }),
      }))
    },
    [],
    {
      equals: (previous, next) =>
        previous.length === next.length &&
        previous.every(
          (item, index) =>
            item.info === next[index]!.info &&
            item.jobs.length === next[index]!.jobs.length &&
            item.jobs.every((job, position) => job === next[index]!.jobs[position]),
        ),
    },
  )

  // Like the TUI, a subagent runs exactly while its session, or any session below it, is running. Subagents always run
  // in the background, so every running descendant is background work, and so is an idle one whose tree still runs a
  // job.
  const subagents = createMemo(() => {
    const current = history()

    // The latest call for a child names it; its own session or its tree's jobs decide whether it still runs.
    return below().flatMap(({ info, jobs }): Subagent[] => {
      const running = input.status(info.id) === "running"

      if (!running && jobs.length === 0) return []

      const latest = current.calls.get(info.id)

      const item: Subagent = {
        id: info.id,
        type: "subagent",
        sessionID: info.id,
        label: latest?.label ?? info.title ?? info.id,
        agent: latest?.agent,
        started: latest?.started ?? info.time.created,
      }

      if (jobs.length > 0) item.jobs = jobs.map((job) => job.id)

      return [item]
    })
  })

  // Background work: every running subagent, and the session's live shells outside its blocking calls.
  const tasks = createMemo((): Task[] => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()

    const shells = oldestFirst(input.shells(), (shell) => shell.time.started).flatMap((shell) => {
      if (shell.status !== "running" || shell.metadata.sessionID !== id) return []

      if (
        current.blocking.some((item) =>
          item.type === "shell"
            ? item.id === shell.id || (!!item.label && shell.command === item.label)
            : shell.time.started >= item.started && item.commands.includes(shell.command),
        )
      )
        return []

      return [{ id: shell.id, type: "shell" as const, label: shell.command, started: shell.time.started }]
    })

    return [...subagents(), ...shells]
  })

  // The session's own scripts moved to the background, while their job runs. Every script runs as a job, so a
  // foreground one only counts once its execute call has ended with the job's id.
  const scripts = createMemo((): Script[] => {
    const id = input.sessionID()

    if (!id) return []
    const current = history()

    return oldestFirst(input.jobs?.() ?? [], (job) => job.time.started).flatMap((job) => {
      if (job.kind !== "codemode" || job.status !== "running" || job.sessionID !== id || !current.scripts.has(job.id))
        return []

      return [
        {
          id: job.id,
          type: "script" as const,
          label: current.scripts.get(job.id) ?? job.id,
          started: job.time.started,
        },
      ]
    })
  })

  return { blocking, tasks, scripts }
}

// A row keeps its place for as long as it is listed: work is ordered by when it was created, which never changes, and
// then by id, so two rows never trade places.
function oldestFirst<T extends { id: string }>(items: readonly T[], created: (item: T) => number) {
  return items.toSorted((a, b) => created(a) - created(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function firstLine(code: string | undefined) {
  return code
    ?.split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

// The commands of the shells a running script has started and not finished.
function executeShellCommands(calls: JsonValue | undefined) {
  if (!Array.isArray(calls)) return []

  return calls.flatMap((call) =>
    Option.match(decodeCall(call), {
      onNone: () => [],
      onSome: (item) => (item.tool === "shell" && item.status === "running" ? [item.input.command] : []),
    }),
  )
}

// Applies the job.updated events that arrived while the list request was in flight on top of its response, which may
// predate them.
// A job that a known session outside the open session's family owns can never show for it. A session with no record
// yet may be a subagent that was just made, so its job counts.
export function jobOutsideFamily(job: JobInfo, family: readonly string[], known: (sessionID: string) => boolean) {
  const outside = (sessionID: string) => known(sessionID) && !family.includes(sessionID)

  return outside(job.sessionID) && (job.kind !== "subagent" || outside(job.childSessionID))
}

export function mergeJobList<T extends Pick<JobInfo, "id"> & { status: string }>(
  listed: readonly T[],
  updates: ReadonlyMap<string, T>,
) {
  const jobs = new Map(listed.map((job) => [job.id, job]))

  updates.forEach((info, id) => (info.status === "running" ? jobs.set(id, info) : jobs.delete(id)))

  return jobs
}
