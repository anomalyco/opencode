import { Hono, type Context } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { createProjectSimple, listProjectsSimple } from "../../storage/project-pg"
import { getRequestUser } from "./auth"
import { isOpencodeWorkosEnabled } from "../workos-env"

const CreateProjectInput = z.object({
  name: z.string().trim().min(1).max(120),
})

const CreateProjectOutput = z.object({
  project: Project.Info,
})

async function tenant(c: Pick<Context, "req">) {
  const e2eUser = process.env["OPENCODE_E2E_USER_ID"]
  if (!isOpencodeWorkosEnabled()) return e2eUser || "e2e-test-user"
  const user = await getRequestUser(c)
  if (user?.id) return user.id
  if (e2eUser) return e2eUser
  return
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
        if (process.env.DATABASE_URL?.startsWith("postgresql://")) {
          const tenantUserId = await tenant(c)
          if (!tenantUserId) return c.json({ error: "Unauthorized" }, 401)
          const projects = await listProjectsSimple(tenantUserId)
          return c.json(projects)
        }
        return c.json(await Project.list())
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
        description: "Create a new project in the database.",
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
        const tenantUserId = await tenant(c)
        if (!tenantUserId) return c.json({ error: "Unauthorized" }, 401)
        if (process.env.DATABASE_URL?.startsWith("postgresql://")) {
          return c.json(await createProjectSimple({ name: body.name, tenantUserId }))
        }
        return c.json(await Project.createSimple({ name: body.name, tenantUserId }))
      },
    ),
)
