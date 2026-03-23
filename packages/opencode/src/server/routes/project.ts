import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { Sidebar } from "../../project/sidebar"
import z from "zod"
import { ProjectID } from "../../project/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { InstanceBootstrap } from "../../project/bootstrap"

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
        const projects = Project.list()
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
    .post(
      "/git/init",
      describeRoute({
        summary: "Initialize git repository",
        description: "Create a git repository for the current project and return the refreshed project info.",
        operationId: "project.initGit",
        responses: {
          200: {
            description: "Project information after git initialization",
            content: {
              "application/json": {
                schema: resolver(Project.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const dir = Instance.directory
        const prev = Instance.project
        const next = await Project.initGit({
          directory: dir,
          project: prev,
        })
        if (next.id === prev.id && next.vcs === prev.vcs && next.worktree === prev.worktree) return c.json(next)
        await Instance.reload({
          directory: dir,
          worktree: dir,
          project: next,
          init: InstanceBootstrap,
        })
        return c.json(next)
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
      validator("param", z.object({ projectID: ProjectID.zod })),
      validator("json", Project.update.schema.omit({ projectID: true })),
      async (c) => {
        const projectID = c.req.valid("param").projectID
        const body = c.req.valid("json")
        const project = await Project.update({ ...body, projectID })
        return c.json(project)
      },
    )
    .get(
      "/sidebar",
      describeRoute({
        summary: "List sidebar items",
        description: "Get the ordered list of projects visible in the sidebar rail.",
        operationId: "project.sidebar.list",
        responses: {
          200: {
            description: "Ordered sidebar items",
            content: {
              "application/json": {
                schema: resolver(Sidebar.Item.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(Sidebar.list())
      },
    )
    .post(
      "/sidebar/open",
      describeRoute({
        summary: "Open sidebar item",
        description: "Add a project to the sidebar rail by worktree path. Idempotent.",
        operationId: "project.sidebar.open",
        responses: {
          200: {
            description: "Updated sidebar items",
            content: {
              "application/json": {
                schema: resolver(Sidebar.Item.array()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ worktree: z.string() })),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(Sidebar.open(body.worktree))
      },
    )
    .post(
      "/sidebar/close",
      describeRoute({
        summary: "Close sidebar item",
        description: "Remove a project from the sidebar rail by worktree path. Idempotent.",
        operationId: "project.sidebar.close",
        responses: {
          200: {
            description: "Updated sidebar items",
            content: {
              "application/json": {
                schema: resolver(Sidebar.Item.array()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ worktree: z.string() })),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(Sidebar.close(body.worktree))
      },
    )
    .post(
      "/sidebar/reorder",
      describeRoute({
        summary: "Reorder sidebar items",
        description: "Replace the full sidebar rail with the given ordered worktree list.",
        operationId: "project.sidebar.reorder",
        responses: {
          200: {
            description: "Updated sidebar items",
            content: {
              "application/json": {
                schema: resolver(Sidebar.Item.array()),
              },
            },
          },
        },
      }),
      validator("json", z.object({ worktrees: z.array(z.string()) })),
      async (c) => {
        const body = c.req.valid("json")
        return c.json(Sidebar.reorder(body.worktrees))
      },
    ),
)
