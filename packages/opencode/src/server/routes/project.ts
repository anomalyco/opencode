import { Hono } from "hono"
import { describeRoute, validator } from "hono-openapi"
import { resolver } from "hono-openapi"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import z from "zod"
import { ProjectID } from "../../project/schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { InstanceBootstrap } from "../../project/bootstrap"
import path from "path"
import { existsSync } from "fs"
import { mkdir } from "fs/promises"
import { git } from "../../util/git"
import { which } from "../../util/which"

const CreateProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
})

const CreateProjectOutput = z.object({
  directory: z.string(),
  project: Project.Info,
})

function slugifyProjectName(input: string) {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug || "project"
}

function projectRoot() {
  return process.env.OPENCODE_PROJECTS_ROOT || process.cwd()
}

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
      "/create",
      describeRoute({
        summary: "Create project",
        description: "Create a new project folder in the workspace root and initialize it for OpenCode.",
        operationId: "project.create",
        responses: {
          200: {
            description: "Created project information",
            content: {
              "application/json": {
                schema: resolver(CreateProjectOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", CreateProjectInput),
      async (c) => {
        const body = c.req.valid("json")
        const root = projectRoot()
        const base = slugifyProjectName(body.name)

        let directory = path.join(root, base)
        let counter = 2
        while (existsSync(directory)) {
          directory = path.join(root, `${base}-${counter}`)
          counter += 1
        }

        await mkdir(directory, { recursive: true })

        if (!which("git")) throw new Error("Git is required to create a project")

        const result = await git(["init", "--quiet"], { cwd: directory })
        if (result.exitCode !== 0) {
          const message = result.stderr.toString().trim() || result.text().trim() || "Failed to initialize project"
          throw new Error(message)
        }

        let project = (await Project.fromDirectory(directory)).project
        if (project.name !== body.name) {
          project = await Project.update({
            projectID: project.id,
            name: body.name,
          })
        }

        return c.json({ directory, project })
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
    ),
)
