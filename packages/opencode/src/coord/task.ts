import z from "zod"
import { Lock } from "@/util/lock"
import { Storage } from "@/storage/storage"
import * as Paths from "./paths"

export const Task = z.object({
  id: z.string(),
  subject: z.string(),
  description: z.string(),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]),
  owner: z.string().nullable(),
  blockedBy: z.array(z.string()),
  blocks: z.array(z.string()),
  activeForm: z.string().nullable(),
  metadata: z.record(z.string(), z.any()),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({
  ref: "CoordTask",
})

export type Task = z.infer<typeof Task>

export const TaskSummary = Task.pick({
  id: true,
  subject: true,
  status: true,
  owner: true,
  blockedBy: true,
}).meta({
  ref: "CoordTaskSummary",
})

export type TaskSummary = z.infer<typeof TaskSummary>

async function readTask(file: string) {
  const raw = await Bun.file(file).json().catch(() => undefined)
  if (!raw) return
  const parsed = Task.safeParse(raw)
  if (parsed.success) return parsed.data
}

async function writeTask(file: string, task: Task) {
  await Bun.write(file, JSON.stringify(task, null, 2))
  await Storage.write(["coord", "task", task.id], task)
}

function unresolved(teamID: string, blockedBy: string[]) {
  return Promise.all(
    blockedBy.map(async (id) => {
      const task = await readTask(Paths.taskFile(teamID, id))
      if (!task) return
      if (task.status !== "completed") return id
    }),
  ).then((items) => items.filter((item): item is string => !!item))
}

async function nextId(teamID: string) {
  const file = Paths.counterFile(teamID)
  using _ = await Lock.write(file)
  const raw = await Bun.file(file)
    .text()
    .then((x) => parseInt(x.trim(), 10))
    .catch(() => 0)
  const next = Number.isFinite(raw) ? raw + 1 : 1
  await Bun.write(file, String(next))
  return String(next)
}

export async function createTask(input: {
  teamID: string
  subject: string
  description?: string
  activeForm?: string
  blockedBy?: string[]
  blocks?: string[]
  metadata?: Record<string, unknown>
}) {
  await Paths.ensureTeam(input.teamID)
  const id = await nextId(input.teamID)
  const now = new Date().toISOString()
  const task: Task = {
    id,
    subject: input.subject,
    description: input.description ?? "",
    status: "pending",
    owner: null,
    blockedBy: input.blockedBy ?? [],
    blocks: input.blocks ?? [],
    activeForm: input.activeForm ?? null,
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  }
  const file = Paths.taskFile(input.teamID, id)
  await writeTask(file, task)
  return task
}

export async function listTasks(teamID: string) {
  await Paths.ensureTeam(teamID)
  const dir = Paths.taskDir(teamID)
  const glob = new Bun.Glob("task-*.json")
  const tasks: TaskSummary[] = []
  for await (const file of glob.scan({ cwd: dir, absolute: true })) {
    const task = await readTask(file)
    if (!task || task.status === "deleted") continue
    tasks.push({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner,
      blockedBy: await unresolved(teamID, task.blockedBy),
    })
  }
  return tasks.sort((a, b) => Number(a.id) - Number(b.id))
}

export async function getTask(teamID: string, taskID: string) {
  return readTask(Paths.taskFile(teamID, taskID))
}

export async function updateTask(
  teamID: string,
  taskID: string,
  updates: Partial<Pick<Task, "subject" | "description" | "status" | "owner" | "activeForm" | "metadata">> & {
    addBlockedBy?: string[]
    addBlocks?: string[]
  },
) {
  const file = Paths.taskFile(teamID, taskID)
  using _ = await Lock.write(file)
  const task = await readTask(file)
  if (!task) return

  if (updates.subject !== undefined) task.subject = updates.subject
  if (updates.description !== undefined) task.description = updates.description
  if (updates.status !== undefined) task.status = updates.status
  if (updates.owner !== undefined) task.owner = updates.owner
  if (updates.activeForm !== undefined) task.activeForm = updates.activeForm
  if (updates.metadata !== undefined) task.metadata = { ...task.metadata, ...updates.metadata }
  if (updates.addBlockedBy) {
    task.blockedBy = [...new Set([...task.blockedBy, ...updates.addBlockedBy])]
  }
  if (updates.addBlocks) {
    task.blocks = [...new Set([...task.blocks, ...updates.addBlocks])]
  }

  task.updatedAt = new Date().toISOString()
  await writeTask(file, task)
  return task
}

export async function claimTask(teamID: string, taskID: string, owner: string) {
  const file = Paths.taskFile(teamID, taskID)
  using _ = await Lock.write(file)
  const task = await readTask(file)
  if (!task) return { error: `Task ${taskID} not found` }
  if (task.status !== "pending") return { error: `Task ${taskID} is not pending (status: ${task.status})` }

  const blockers = await unresolved(teamID, task.blockedBy)
  if (blockers.length > 0) {
    return { error: `Task ${taskID} is blocked by: ${blockers.join(", ")}` }
  }

  task.status = "in_progress"
  task.owner = owner
  task.updatedAt = new Date().toISOString()
  await writeTask(file, task)
  return task
}

export async function completeTask(teamID: string, taskID: string) {
  return updateTask(teamID, taskID, { status: "completed" })
}

export async function deleteTask(teamID: string, taskID: string) {
  return updateTask(teamID, taskID, { status: "deleted" })
}
