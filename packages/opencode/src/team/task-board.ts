import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"

export namespace TaskBoard {
  const log = Log.create({ service: "team.task-board" })

  export const Task = z
    .object({
      id: z.string(),
      teamID: z.string(),
      title: z.string(),
      description: z.string(),
      owner: z.string().optional(),
      status: z.enum(["pending", "in_progress", "completed", "blocked", "failed"]),
      dependencies: z.array(z.string()),
      result: z.string().optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        completed: z.number().optional(),
      }),
    })
    .meta({ ref: "TeamTask" })
  export type Task = z.infer<typeof Task>

  export const Event = {
    Updated: BusEvent.define(
      "team.task.updated",
      z.object({
        teamID: z.string(),
        task: Task,
      }),
    ),
    BoardUpdated: BusEvent.define(
      "team.task-board.updated",
      z.object({
        teamID: z.string(),
        tasks: z.array(Task),
      }),
    ),
  }

  export async function add(input: {
    teamID: string
    title: string
    description: string
    dependencies?: string[]
  }) {
    const task: Task = {
      id: Identifier.ascending("team_task"),
      teamID: input.teamID,
      title: input.title,
      description: input.description,
      status: "pending",
      dependencies: input.dependencies ?? [],
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
    }

    const tasks = await list(input.teamID)
    tasks.push(task)
    await Storage.write(["team_tasks", input.teamID], tasks)

    log.info("task added", { teamID: input.teamID, taskID: task.id, title: task.title })
    Bus.publish(Event.Updated, { teamID: input.teamID, task })
    Bus.publish(Event.BoardUpdated, { teamID: input.teamID, tasks })
    return task
  }

  export async function claim(input: { teamID: string; taskID: string; owner: string }) {
    const tasks = await list(input.teamID)
    const task = tasks.find((t) => t.id === input.taskID)
    if (!task) throw new Error(`Task ${input.taskID} not found`)
    if (task.owner && task.owner !== input.owner)
      throw new Error(`Task ${input.taskID} already claimed by ${task.owner}`)

    // Check dependencies are completed
    const blocked = task.dependencies.filter((depID) => {
      const dep = tasks.find((t) => t.id === depID)
      return dep && dep.status !== "completed"
    })
    if (blocked.length > 0)
      throw new Error(`Task ${input.taskID} blocked by incomplete dependencies: ${blocked.join(", ")}`)

    task.owner = input.owner
    task.status = "in_progress"
    task.time.updated = Date.now()
    await Storage.write(["team_tasks", input.teamID], tasks)

    log.info("task claimed", { teamID: input.teamID, taskID: task.id, owner: input.owner })
    Bus.publish(Event.Updated, { teamID: input.teamID, task })
    Bus.publish(Event.BoardUpdated, { teamID: input.teamID, tasks })
    return task
  }

  export async function complete(input: { teamID: string; taskID: string; result: string }) {
    const tasks = await list(input.teamID)
    const task = tasks.find((t) => t.id === input.taskID)
    if (!task) throw new Error(`Task ${input.taskID} not found`)

    task.status = "completed"
    task.result = input.result
    task.time.updated = Date.now()
    task.time.completed = Date.now()
    await Storage.write(["team_tasks", input.teamID], tasks)

    log.info("task completed", { teamID: input.teamID, taskID: task.id })
    Bus.publish(Event.Updated, { teamID: input.teamID, task })
    Bus.publish(Event.BoardUpdated, { teamID: input.teamID, tasks })
    return task
  }

  export async function fail(input: { teamID: string; taskID: string; result: string }) {
    const tasks = await list(input.teamID)
    const task = tasks.find((t) => t.id === input.taskID)
    if (!task) throw new Error(`Task ${input.taskID} not found`)

    task.status = "failed"
    task.result = input.result
    task.time.updated = Date.now()
    await Storage.write(["team_tasks", input.teamID], tasks)

    log.info("task failed", { teamID: input.teamID, taskID: task.id })
    Bus.publish(Event.Updated, { teamID: input.teamID, task })
    Bus.publish(Event.BoardUpdated, { teamID: input.teamID, tasks })
    return task
  }

  export async function list(teamID: string) {
    return Storage.read<Task[]>(["team_tasks", teamID])
      .then((x) => x || [])
      .catch(() => [])
  }

  export async function available(teamID: string) {
    const tasks = await list(teamID)
    return tasks.filter((t) => {
      if (t.status !== "pending") return false
      const depsComplete = t.dependencies.every((depID) => {
        const dep = tasks.find((d) => d.id === depID)
        return dep?.status === "completed"
      })
      return depsComplete
    })
  }

  export async function forOwner(teamID: string, owner: string) {
    const tasks = await list(teamID)
    return tasks.filter((t) => t.owner === owner)
  }

  export function isAllDone(tasks: Task[]) {
    return tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "failed")
  }
}
