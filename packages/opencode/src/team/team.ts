import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Effect } from "effect"

const log = Log.create({ service: "team" })

export type TaskStatus = "pending" | "claimed" | "done" | "error"

export interface TaskEntry {
  id: string
  description: string
  status: TaskStatus
  assignee?: string
  result?: string
  error?: string
  time: {
    created: number
    claimed?: number
    completed?: number
  }
}

export interface TeamMessage {
  id: string
  from: string
  to: string
  content: string
  time: number
}

export interface TeamInfo {
  id: string
  lead: string
  teammates: string[]
  time: {
    created: number
  }
}

function teamsDir(worktree: string) {
  return path.join(worktree, ".opencode", "teams")
}

function teamDir(worktree: string, teamID: string) {
  return path.join(teamsDir(worktree), teamID)
}

function tasksDir(worktree: string, teamID: string) {
  return path.join(teamDir(worktree, teamID), "tasks")
}

function messagesDir(worktree: string, teamID: string) {
  return path.join(teamDir(worktree, teamID), "messages")
}

function teamInfoPath(worktree: string, teamID: string) {
  return path.join(teamDir(worktree, teamID), "team.json")
}

function taskPath(worktree: string, teamID: string, taskID: string) {
  return path.join(tasksDir(worktree, teamID), `${taskID}.json`)
}

function messagePath(worktree: string, teamID: string, messageID: string) {
  return path.join(messagesDir(worktree, teamID), `${messageID}.json`)
}

let counter = 0
function generateID(prefix: string) {
  counter++
  return `${prefix}_${Date.now()}_${counter}`
}

export const createTeam = (fs: AppFileSystem.Interface, worktree: string, input: {
  leadSessionID: string
}) => Effect.gen(function* () {
  const teamID = generateID("team")
  const dir = teamDir(worktree, teamID)

  yield* fs.ensureDir(tasksDir(worktree, teamID))
  yield* fs.ensureDir(messagesDir(worktree, teamID))

  const info: TeamInfo = {
    id: teamID,
    lead: input.leadSessionID,
    teammates: [],
    time: { created: Date.now() },
  }

  yield* fs.writeFileString(teamInfoPath(worktree, teamID), JSON.stringify(info, null, 2))
  log.info("created team", { teamID, dir })
  return info
})

export const getTeam = (fs: AppFileSystem.Interface, worktree: string, teamID: string) => Effect.gen(function* () {
  const infoPath = teamInfoPath(worktree, teamID)
  const exists = yield* fs.existsSafe(infoPath)
  if (!exists) return undefined
  const text = yield* fs.readFileStringSafe(infoPath).pipe(Effect.orDie)
  if (!text) return undefined
  return JSON.parse(text) as TeamInfo
})

export const addTeammate = (fs: AppFileSystem.Interface, worktree: string, input: {
  teamID: string
  sessionID: string
}) => Effect.gen(function* () {
  const info = yield* getTeam(fs, worktree, input.teamID)
  if (!info) return yield* Effect.fail(new Error(`Team not found: ${input.teamID}`))
  info.teammates.push(input.sessionID)
  yield* fs.writeFileString(teamInfoPath(worktree, input.teamID), JSON.stringify(info, null, 2))
  log.info("added teammate", { teamID: input.teamID, sessionID: input.sessionID })
  return info
})

export const addTask = (fs: AppFileSystem.Interface, worktree: string, input: {
  teamID: string
  description: string
}) => Effect.gen(function* () {
  const taskID = generateID("task")
  const task: TaskEntry = {
    id: taskID,
    description: input.description,
    status: "pending",
    time: { created: Date.now() },
  }
  yield* fs.writeFileString(taskPath(worktree, input.teamID, taskID), JSON.stringify(task, null, 2))
  log.info("added task", { teamID: input.teamID, taskID })
  return task
})

export const claimTask = (fs: AppFileSystem.Interface, worktree: string, input: {
  teamID: string
  taskID: string
  sessionID: string
}) => Effect.gen(function* () {
  const filePath = taskPath(worktree, input.teamID, input.taskID)
  const exists = yield* fs.existsSafe(filePath)
  if (!exists) return yield* Effect.fail(new Error(`Task not found: ${input.taskID}`))
  const text = yield* fs.readFileStringSafe(filePath).pipe(Effect.orDie)
  if (!text) return yield* Effect.fail(new Error(`Task file empty: ${input.taskID}`))
  const task = JSON.parse(text) as TaskEntry
  if (task.status !== "pending") return yield* Effect.fail(new Error(`Task ${input.taskID} is already ${task.status}`))
  task.status = "claimed"
  task.assignee = input.sessionID
  task.time.claimed = Date.now()
  yield* fs.writeFileString(filePath, JSON.stringify(task, null, 2))
  log.info("claimed task", { teamID: input.teamID, taskID: input.taskID, sessionID: input.sessionID })
  return task
})

export const completeTask = (fs: AppFileSystem.Interface, worktree: string, input: {
  teamID: string
  taskID: string
  result: string
}) => Effect.gen(function* () {
  const filePath = taskPath(worktree, input.teamID, input.taskID)
  const text = yield* fs.readFileStringSafe(filePath).pipe(Effect.orDie)
  if (!text) return yield* Effect.fail(new Error(`Task not found: ${input.taskID}`))
  const task = JSON.parse(text) as TaskEntry
  if (task.status !== "claimed") return yield* Effect.fail(new Error(`Task ${input.taskID} is not claimed (status: ${task.status})`))
  task.status = "done"
  task.result = input.result
  task.time.completed = Date.now()
  yield* fs.writeFileString(filePath, JSON.stringify(task, null, 2))
  log.info("completed task", { teamID: input.teamID, taskID: input.taskID })
  return task
})

export const listTasks = (fs: AppFileSystem.Interface, worktree: string, teamID: string) => Effect.gen(function* () {
  const dir = tasksDir(worktree, teamID)
  const exists = yield* fs.existsSafe(dir)
  if (!exists) return []
  const entries = yield* fs.readDirectoryEntries(dir)
  const tasks: TaskEntry[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue
    const text = yield* fs.readFileStringSafe(path.join(dir, entry.name)).pipe(Effect.orDie)
    if (!text) continue
    tasks.push(JSON.parse(text) as TaskEntry)
  }
  return tasks
})

export const sendMessage = (fs: AppFileSystem.Interface, worktree: string, input: {
  teamID: string
  from: string
  to: string
  content: string
}) => Effect.gen(function* () {
  const msgID = generateID("msg")
  const msg: TeamMessage = {
    id: msgID,
    from: input.from,
    to: input.to,
    content: input.content,
    time: Date.now(),
  }
  yield* fs.writeFileString(messagePath(worktree, input.teamID, msgID), JSON.stringify(msg, null, 2))
  log.info("sent message", { teamID: input.teamID, from: input.from, to: input.to })
  return msg
})

export const readMessages = (fs: AppFileSystem.Interface, worktree: string, input: {
  teamID: string
  sessionID: string
}) => Effect.gen(function* () {
  const dir = messagesDir(worktree, input.teamID)
  const exists = yield* fs.existsSafe(dir)
  if (!exists) return []
  const entries = yield* fs.readDirectoryEntries(dir)
  const messages: TeamMessage[] = []
  for (const entry of entries) {
    if (!entry.name.endsWith(".json")) continue
    const text = yield* fs.readFileStringSafe(path.join(dir, entry.name)).pipe(Effect.orDie)
    if (!text) continue
    const msg = JSON.parse(text) as TeamMessage
    if (msg.to === input.sessionID || msg.to === "*") messages.push(msg)
  }
  return messages.sort((a, b) => a.time - b.time)
})
