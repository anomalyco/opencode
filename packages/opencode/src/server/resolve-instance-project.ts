import type { Context } from "hono"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { getRequestUser } from "./routes/auth"
import { isOpencodeWorkosEnabled } from "./workos-env"
import { listProjectsSimple } from "@/storage/project-pg"

type R = Project.Info | Response

function isPostgres() {
  return process.env.DATABASE_URL?.trim().startsWith("postgresql://")
}

/**
 * Resolves `project` row only — no filesystem cwd / “repo root”.
 *
 * - `?project=<uuid>` or `x-opencode-project: <uuid>`
 * - Else first project for the tenant (Postgres).
 */
export async function resolveInstanceProject(c: Context): Promise<R> {
  if (!isPostgres()) {
    return c.json({ error: "DATABASE_URL must be postgresql:// for API project resolution" }, 503)
  }

  const id =
    c.req.query("project")?.trim() ||
    c.req.header("x-opencode-project")?.trim()

  if (id) {
    const info = await Project.get(ProjectID.make(id))
    if (!info) {
      return c.json({ error: "Unknown project", projectID: id }, 400)
    }
    return info
  }

  const tenantUserId = isOpencodeWorkosEnabled()
    ? (await getRequestUser(c))?.id
    : process.env["OPENCODE_E2E_TENANT_USER_ID"]?.trim() ||
      process.env["OPENCODE_E2E_USER_ID"]?.trim() ||
      "e2e_test_user"

  if (tenantUserId) {
    const list = await listProjectsSimple(tenantUserId)
    const first = list[0]
    if (first) return first
  }

  return c.json(
    {
      error: "No project",
      detail: "Pass ?project= or x-opencode-project, or create a project for this tenant.",
    },
    400,
  )
}
