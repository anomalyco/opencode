import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { TaskManager, TaskEvent, type TaskInfo } from "../../task"
import {
  migrateToBackground,
  killForegroundProcess,
  listForegroundProcesses,
  getForegroundProcess,
} from "../../tool/bash"
import { Log } from "../../util/log"
import { Instance } from "../../project/instance"

const log = Log.create({ service: "task-routes" })

const TaskInfoSchema = z
  .object({
    id: z.string(),
    pid: z.number(),
    command: z.string(),
    startTime: z.number(),
    status: z.enum(["running", "completed", "failed"]),
    exitCode: z.number().optional(),
    workdir: z.string(),
    description: z.string().optional(),
    logFile: z.string(),
    reconnectable: z.boolean(),
  })
  .meta({ ref: "TaskInfo" })

export const TaskRoutes = lazy(() =>
  new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List all background tasks",
        description: "Get a list of all background tasks for the current project.",
        operationId: "task.list",
        responses: {
          200: {
            description: "List of tasks",
            content: {
              "application/json": {
                schema: resolver(TaskInfoSchema.array()),
              },
            },
          },
        },
      }),
      validator("query", z.object({ directory: z.string().optional() })),
      async (c) => {
        try {
          const { directory } = c.req.valid("query")
          const targetDir = directory || Instance.directory
          log.debug("listing tasks", { directory, targetDir, instanceDir: Instance.directory })
          const tasks = await TaskManager.list(targetDir)
          log.debug("tasks returned", { count: tasks.length })
          return c.json(tasks)
        } catch (err) {
          log.error("failed to list tasks", { error: String(err) })
          throw err
        }
      },
    )
    .get(
      "/:taskId",
      describeRoute({
        summary: "Get task details",
        description: "Get details of a specific background task.",
        operationId: "task.get",
        responses: {
          200: {
            description: "Task details",
            content: {
              "application/json": {
                schema: resolver(TaskInfoSchema.nullable()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskId: z.string() })),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const task = await TaskManager.get(taskId)
        if (!task) {
          return c.json(null, 404)
        }
        return c.json(task)
      },
    )
    .post(
      "/:taskId/kill",
      describeRoute({
        summary: "Kill a running task",
        description: "Terminate a running background task.",
        operationId: "task.kill",
        responses: {
          200: {
            description: "Task killed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskId: z.string() })),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const killed = await TaskManager.kill(taskId)
        return c.json(killed)
      },
    )
    .delete(
      "/:taskId",
      describeRoute({
        summary: "Remove a completed task",
        description: "Remove a completed or failed task from the list.",
        operationId: "task.remove",
        responses: {
          200: {
            description: "Task removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("param", z.object({ taskId: z.string() })),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const removed = await TaskManager.remove(taskId)
        return c.json(removed)
      },
    )
    .get(
      "/:taskId/output",
      describeRoute({
        summary: "Get task output",
        description: "Get the full output of a task.",
        operationId: "task.output",
        responses: {
          200: {
            description: "Task output",
            content: {
              "application/json": {
                schema: resolver(z.object({ output: z.string() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskId: z.string() })),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const output = await TaskManager.read(taskId)
        return c.json({ output })
      },
    )
    .get(
      "/:taskId/tail",
      describeRoute({
        summary: "Get last N lines of task output",
        description: "Get the last N lines of a task's output.",
        operationId: "task.tail",
        responses: {
          200: {
            description: "Task output tail",
            content: {
              "application/json": {
                schema: resolver(z.object({ output: z.string() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ taskId: z.string() })),
      validator("query", z.object({ lines: z.coerce.number().optional().default(50) })),
      async (c) => {
        const { taskId } = c.req.valid("param")
        const { lines } = c.req.valid("query")
        const output = await TaskManager.tail(taskId, lines)
        return c.json({ output })
      },
    )
    .post(
      "/cleanup",
      describeRoute({
        summary: "Cleanup old tasks",
        description: "Remove completed tasks older than the specified age.",
        operationId: "task.cleanup",
        responses: {
          200: {
            description: "Number of tasks removed",
            content: {
              "application/json": {
                schema: resolver(z.object({ removed: z.number() })),
              },
            },
          },
        },
      }),
      validator("json", z.object({ maxAge: z.number().optional() })),
      async (c) => {
        const { maxAge } = c.req.valid("json")
        const removed = await TaskManager.cleanup(maxAge)
        return c.json({ removed })
      },
    )
    // Foreground process endpoints
    .get(
      "/foreground",
      describeRoute({
        summary: "List foreground processes",
        description: "Get a list of all running foreground bash processes that can be migrated to background.",
        operationId: "task.foreground.list",
        responses: {
          200: {
            description: "List of foreground processes",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      callID: z.string(),
                      sessionID: z.string(),
                      pid: z.number(),
                      command: z.string(),
                      description: z.string(),
                      workdir: z.string(),
                      startTime: z.number(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const processes = listForegroundProcesses().map((p) => ({
          callID: p.callID,
          sessionID: p.sessionID,
          pid: p.pid,
          command: p.command,
          description: p.description,
          workdir: p.workdir,
          startTime: p.startTime,
        }))
        return c.json(processes)
      },
    )
    .get(
      "/foreground/:callID",
      describeRoute({
        summary: "Get foreground process",
        description: "Get details of a specific foreground bash process.",
        operationId: "task.foreground.get",
        responses: {
          200: {
            description: "Foreground process details",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      callID: z.string(),
                      sessionID: z.string(),
                      pid: z.number(),
                      command: z.string(),
                      description: z.string(),
                      workdir: z.string(),
                      startTime: z.number(),
                      outputLength: z.number(),
                    })
                    .nullable(),
                ),
              },
            },
          },
        },
      }),
      validator("param", z.object({ callID: z.string() })),
      async (c) => {
        const { callID } = c.req.valid("param")
        const proc = getForegroundProcess(callID)
        if (!proc) {
          return c.json(null)
        }
        return c.json({
          callID: proc.callID,
          sessionID: proc.sessionID,
          pid: proc.pid,
          command: proc.command,
          description: proc.description,
          workdir: proc.workdir,
          startTime: proc.startTime,
          outputLength: proc.output.length,
        })
      },
    )
    .post(
      "/foreground/:callID/background",
      describeRoute({
        summary: "Migrate foreground process to background",
        description:
          "Migrate a running foreground bash process to a background task. The process continues running and can be managed via the task API.",
        operationId: "task.foreground.migrate",
        responses: {
          200: {
            description: "Migration result",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    success: z.boolean(),
                    taskId: z.string().nullable(),
                    error: z.string().optional(),
                  }),
                ),
              },
            },
          },
        },
      }),
      validator("param", z.object({ callID: z.string() })),
      async (c) => {
        const { callID } = c.req.valid("param")
        try {
          const taskId = await migrateToBackground(callID)
          if (taskId) {
            return c.json({ success: true, taskId })
          } else {
            return c.json({ success: false, taskId: null, error: "Process not found or already migrated" })
          }
        } catch (err) {
          return c.json({ success: false, taskId: null, error: String(err) })
        }
      },
    )
    .post(
      "/foreground/:callID/kill",
      describeRoute({
        summary: "Kill foreground process",
        description: "Terminate a running foreground bash process.",
        operationId: "task.foreground.kill",
        responses: {
          200: {
            description: "Kill result",
            content: {
              "application/json": {
                schema: resolver(z.object({ success: z.boolean() })),
              },
            },
          },
        },
      }),
      validator("param", z.object({ callID: z.string() })),
      async (c) => {
        const { callID } = c.req.valid("param")
        const success = await killForegroundProcess(callID)
        return c.json({ success })
      },
    ),
)
