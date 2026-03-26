import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import z from "zod"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { HostedAuth } from "@/hosted/auth"
import { HostedWorkspace } from "@/hosted/workspace"
import { HTTPException } from "hono/http-exception"

export const ProjectRoutes = lazy(() =>
  new Hono()
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
        if (!HostedAuth.enabled() || HostedAuth.trusted()) return c.json(projects)

        HostedAuth.requireUser()
        const workspaces = await HostedWorkspace.list({ enabled: true })
        const visible = new Set(workspaces.map((workspace) => workspace.path))
        return c.json(
          projects.filter(
            (project) =>
              visible.has(project.worktree) || project.sandboxes.some((sandbox) => visible.has(sandbox)),
          ),
        )
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
        if (HostedAuth.enabled() && !HostedAuth.trusted()) {
          HostedAuth.requireUser()
          const allowed = await HostedWorkspace.allowed(Instance.directory)
          if (!allowed) {
            throw new HTTPException(403, {
              message: "Workspace access denied",
            })
          }
        }
        return c.json(Instance.project)
      },
    )
    .patch(
      "/:projectID",
      describeRoute({
        summary: "Update project",
        description: "Update project properties such as name, icon, and commands.",
        operationId: "project.update",
        responses: {
          200: {
            description: "Updated project information",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator("param", z.object({ projectID: z.string() })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    ),
)
