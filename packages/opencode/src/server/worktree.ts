import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { errors } from "./error"
import { Worktree } from "../worktree"
import { Project } from "../project/project"
import { Instance } from "../project/instance"

export const WorktreeRoute = new Hono()
  .post(
    "/",
    describeRoute({
      summary: "Create worktree",
      description: "Create a new git worktree for the current project.",
      operationId: "worktree.create",
      responses: {
        200: {
          description: "Worktree created",
          content: {
            "application/json": {
              schema: resolver(Worktree.Info),
            },
          },
        },
        ...errors(400),
      },
    }),
    validator("json", Worktree.create.schema),
    async (c) => {
      const body = c.req.valid("json")
      const worktree = await Worktree.create(body)
      return c.json(worktree)
    },
  )
  .get(
    "/",
    describeRoute({
      summary: "List worktrees",
      description: "List all sandbox worktrees for the current project.",
      operationId: "worktree.list",
      responses: {
        200: {
          description: "List of worktree directories",
          content: {
            "application/json": {
              schema: resolver(z.array(z.string())),
            },
          },
        },
      },
    }),
    async (c) => {
      const sandboxes = await Project.sandboxes(Instance.project.id)
      return c.json(sandboxes)
    },
  )
