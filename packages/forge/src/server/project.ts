import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Git } from "../git"

export const ProjectRoute = new Hono()
  .get(
    "/",
    describeRoute({
      description: "List all projects",
      operationId: "project.list",
      responses: {
        200: {
          description: "List of projects",
          content: {
            "application/json": {
              schema: resolver(Project.Info.array()),
            },
          },
        },
      },
    }),
    async (c) => {
      const projects = await Project.list()
      return c.json(projects)
    },
  )
  .get(
    "/current",
    describeRoute({
      description: "Get the current project with branch info",
      operationId: "project.current",
      responses: {
        200: {
          description: "Current project",
          content: {
            "application/json": {
              schema: resolver(Project.Info),
            },
          },
        },
      },
    }),
    async (c) => {
      const branch = await Git.getCurrentBranch(Instance.worktree)
      const mainWorktree = await Git.getMainWorktree(Instance.worktree)
      const mainBranch = mainWorktree?.branch ?? branch
      return c.json({
        ...Instance.project,
        branch,
        mainBranch,
      })
    },
  )
