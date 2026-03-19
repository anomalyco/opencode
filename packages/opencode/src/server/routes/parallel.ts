import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Orchestrator } from "../../parallel/orchestrator"
import { PlanStore } from "../../parallel/plan"
import { Plan } from "../../parallel/schema"
import { Instance } from "../../project/instance"

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
