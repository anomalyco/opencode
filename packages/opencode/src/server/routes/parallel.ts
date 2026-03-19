import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { streamSSE } from "hono/streaming"
import z from "zod"
import { Orchestrator } from "../../parallel/orchestrator"
import { PlanStore } from "../../parallel/plan"
import { Plan, Subtask, SubtaskID } from "../../parallel/schema"
import { Instance } from "../../project/instance"
import { Bus } from "@/bus"
import { ParallelEvent } from "../../parallel/events"
import { Log } from "../../util/log"

const errors = (code: number) => ({
  [code]: {
    description: "Error",
    content: {
      "application/json": {
        schema: resolver(
          z.object({
            error: z.string(),
          }),
        ),
      },
    },
  },
})

export const parallel = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "List parallel plans",
      description: "Retrieve all parallel execution plans for the current project.",
      operationId: "parallel.list",
      responses: {
        200: {
          description: "List of plans",
          content: {
            "application/json": {
              schema: resolver(z.array(Plan)),
            },
          },
        },
      },
    }),
    async (c) => {
      const projectID = Instance.project.id
      const plans = await PlanStore.list()
      return c.json(plans.filter((p) => p.projectID === projectID))
    },
  )
  .post(
    "/create",
    describeRoute({
      summary: "Create a parallel plan",
      description: "Create a new parallel execution plan by decomposing a task into subtasks.",
      operationId: "parallel.create",
      responses: {
        200: {
          description: "Created plan",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator(
      "json",
      z.object({
        projectID: z.string(),
        sessionID: z.string().optional(),
        task: z.string(),
        orchestratorModel: z.object({
          modelID: z.string(),
          providerID: z.string(),
        }),
        workerModel: z.object({
          modelID: z.string(),
          providerID: z.string(),
        }),
      }),
    ),
    async (c) => {
      const body = c.req.valid("json")
      const plan = await Orchestrator.create({
        projectID: body.projectID as any,
        sessionID: body.sessionID as any,
        task: body.task,
        orchestratorModel: body.orchestratorModel as any,
        workerModel: body.workerModel as any,
      })
      return c.json(plan)
    },
  )
  .get(
    "/:planID",
    describeRoute({
      summary: "Get a parallel plan",
      description: "Retrieve details of a specific parallel execution plan.",
      operationId: "parallel.get",
      responses: {
        200: {
          description: "Plan details",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    async (c) => {
      const { planID } = c.req.valid("param")
      const plan = await PlanStore.get(planID as any)
      return c.json(plan)
    },
  )
  .post(
    "/:planID/approve",
    describeRoute({
      summary: "Approve a parallel plan",
      description: "Approve a proposed plan and begin execution.",
      operationId: "parallel.approve",
      responses: {
        200: {
          description: "Approved plan",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    async (c) => {
      const { planID } = c.req.valid("param")
      const plan = await Orchestrator.approve(planID as any)
      return c.json(plan)
    },
  )
  .post(
    "/:planID/cancel",
    describeRoute({
      summary: "Cancel a parallel plan",
      description: "Cancel a plan and mark it as failed.",
      operationId: "parallel.cancel",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({ ok: z.boolean() })),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    async (c) => {
      const { planID } = c.req.valid("param")
      await Orchestrator.cancel(planID as any)
      return c.json({ ok: true })
    },
  )
  .post(
    "/:planID/regenerate",
    describeRoute({
      summary: "Regenerate a parallel plan",
      description: "Regenerate the subtasks for a failed or proposed plan.",
      operationId: "parallel.regenerate",
      responses: {
        200: {
          description: "Regenerated plan",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    async (c) => {
      const { planID } = c.req.valid("param")
      const plan = await Orchestrator.retry(planID as any)
      return c.json(plan)
    },
  )
  .delete(
    "/:planID",
    describeRoute({
      summary: "Delete a parallel plan",
      description: "Delete a plan from storage.",
      operationId: "parallel.delete",
      responses: {
        200: {
          description: "Success",
          content: {
            "application/json": {
              schema: resolver(z.object({ ok: z.boolean() })),
            },
          },
        },
        ...errors(404),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    async (c) => {
      const { planID } = c.req.valid("param")
      await PlanStore.remove(planID as any)
      return c.json({ ok: true })
    },
  )
  .get(
    "/:planID/events",
    describeRoute({
      summary: "Get parallel plan events",
      description: "Subscribe to parallel plan events using server-sent events.",
      operationId: "parallel.events",
      responses: {
        200: {
          description: "Event stream",
          content: {
            "text/event-stream": {
              schema: resolver(
                z
                  .object({
                    type: z.string(),
                    payload: z.any(),
                  })
                  .meta({
                    ref: "ParallelEvent",
                  }),
              ),
            },
          },
        },
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    async (c) => {
      const { planID } = c.req.valid("param")
      const log = Log.create({ service: "parallel" })
      log.info("parallel events connected", { planID })

      c.header("X-Accel-Buffering", "no")
      c.header("X-Content-Type-Options", "nosniff")

      return streamSSE(c, async (stream) => {
        const plan = await PlanStore.get(planID as any)

        stream.writeSSE({
          data: JSON.stringify({
            type: "parallel.plan.updated",
            payload: { plan },
          }),
        })

        const unsubPlan = Bus.subscribe(ParallelEvent.PlanUpdated, (event) => {
          if (event.properties.plan.id === planID) {
            stream.writeSSE({
              data: JSON.stringify({
                type: event.type,
                payload: event.properties,
              }),
            })
          }
        })

        const unsubWorker = Bus.subscribe(ParallelEvent.WorkerUpdated, (event) => {
          if (event.properties.planID === planID) {
            stream.writeSSE({
              data: JSON.stringify({
                type: event.type,
                payload: event.properties,
              }),
            })
          }
        })

        const unsubMerge = Bus.subscribe(ParallelEvent.MergeProgress, (event) => {
          if (event.properties.planID === planID) {
            stream.writeSSE({
              data: JSON.stringify({
                type: event.type,
                payload: event.properties,
              }),
            })
          }
        })

        const heartbeat = setInterval(() => {
          stream.writeSSE({
            data: JSON.stringify({
              type: "server.heartbeat",
              payload: {},
            }),
          })
        }, 10_000)

        await new Promise<void>((resolve) => {
          stream.onAbort(() => {
            clearInterval(heartbeat)
            unsubPlan()
            unsubWorker()
            unsubMerge()
            resolve()
            log.info("parallel events disconnected", { planID })
          })
        })
      })
    },
  )
  .put(
    "/:planID/subtasks",
    describeRoute({
      summary: "Update all subtasks",
      description: "Replace the entire subtasks array. Only allowed when plan status is 'proposed' or 'draft'.",
      operationId: "parallel.updateSubtasks",
      responses: {
        200: {
          description: "Updated plan",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(400),
        ...errors(404),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    validator("json", z.object({ subtasks: z.array(Subtask) })),
    async (c) => {
      const { planID } = c.req.valid("param")
      const { subtasks } = c.req.valid("json")
      const plan = await PlanStore.get(planID as any)

      if (plan.status !== "proposed" && plan.status !== "draft") {
        return c.json({ error: `Cannot edit subtasks when plan status is '${plan.status}'` }, 400)
      }

      const workers = subtasks.map((st) => ({
        subtaskID: st.id,
        status: "pending" as const,
      }))

      const updated = await PlanStore.update({
        id: planID as any,
        subtasks,
        workers,
      })

      return c.json(updated)
    },
  )
  .post(
    "/:planID/subtasks",
    describeRoute({
      summary: "Add a subtask",
      description: "Add a new subtask to the plan. Only allowed when plan status is 'proposed' or 'draft'.",
      operationId: "parallel.addSubtask",
      responses: {
        200: {
          description: "Updated plan",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(400),
        ...errors(404),
      },
    }),
    validator("param", z.object({ planID: z.string() })),
    validator("json", Subtask),
    async (c) => {
      const { planID } = c.req.valid("param")
      const subtask = c.req.valid("json")
      const plan = await PlanStore.get(planID as any)

      if (plan.status !== "proposed" && plan.status !== "draft") {
        return c.json({ error: `Cannot edit subtasks when plan status is '${plan.status}'` }, 400)
      }

      const subtasks = [...plan.subtasks, subtask]
      const workers = [
        ...plan.workers,
        {
          subtaskID: subtask.id,
          status: "pending" as const,
        },
      ]

      const updated = await PlanStore.update({
        id: planID as any,
        subtasks,
        workers,
      })

      return c.json(updated)
    },
  )
  .delete(
    "/:planID/subtasks/:subtaskID",
    describeRoute({
      summary: "Remove a subtask",
      description: "Remove a subtask from the plan. Only allowed when plan status is 'proposed' or 'draft'.",
      operationId: "parallel.removeSubtask",
      responses: {
        200: {
          description: "Updated plan",
          content: {
            "application/json": {
              schema: resolver(Plan),
            },
          },
        },
        ...errors(400),
        ...errors(404),
      },
    }),
    validator("param", z.object({ planID: z.string(), subtaskID: z.string() })),
    async (c) => {
      const { planID, subtaskID } = c.req.valid("param")
      const plan = await PlanStore.get(planID as any)

      if (plan.status !== "proposed" && plan.status !== "draft") {
        return c.json({ error: `Cannot edit subtasks when plan status is '${plan.status}'` }, 400)
      }

      const subtaskExists = plan.subtasks.some((st) => st.id === subtaskID)
      if (!subtaskExists) {
        return c.json({ error: `Subtask not found: ${subtaskID}` }, 404)
      }

      const subtasks = plan.subtasks.filter((st) => st.id !== subtaskID)
      const workers = plan.workers.filter((w) => w.subtaskID !== subtaskID)

      const updated = await PlanStore.update({
        id: planID as any,
        subtasks,
        workers,
      })

      return c.json(updated)
    },
  )
