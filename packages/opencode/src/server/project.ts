import { Hono } from "hono"
import { describeRoute } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../project/instance"
import { Project } from "../project/project"

export const ProjectRoute = new Hono()
  .get(
    "/",
    describeRoute({
      summary: "List all projects",
      description: "Get a list of projects that have been opened with OpenCode.",
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
      summary: "Get current project",
      description: "Retrieve the currently active project that OpenCode is working with.",
      operationId: "project.current",
      responses: {
        200: {
          description: "Current project information",
          content: {
            "application/json": {
              schema: resolver(Project.Info),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json(Instance.project)
    },
  )
