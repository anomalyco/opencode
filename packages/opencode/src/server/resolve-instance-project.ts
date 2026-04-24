import type { Context } from "hono"
import { Filesystem } from "@/util/filesystem"
import { localProject } from "@/project/local-project"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { getRequestUser } from "./routes/auth"
import { isOpencodeWorkosEnabled } from "./workos-env"
import { listProjectsSimple } from "@/storage/project-pg"

type InstanceProject = Project.Info & { vcs?: "git" }
type R = InstanceProject | Response

function isPostgres() {
  return process.env.DATABASE_URL?.trim().startsWith("postgresql://")
}

/**
 * `session.project_id` FK → `project.id` (UUID). The instance must use a row from `project`, not a
 * filesystem path from `cwd`.
 *
 * - `?project=<uuid>` or `x-opencode-project: <uuid>`: load that project.
 * - Postgres, no id: use the first project for the signed-in tenant (single-workspace / API clients).
 * - No Postgres: legacy `localProject(OPENCODE_INSTANCE_ROOT | cwd)`.
 */
export async function resolveInstanceProject(c: Context): Promise<R> {
  const id =
    c.req.query("project")?.trim() ||
    c.req.header("x-opencode-project")?.trim()

  if (isPostgres()) {
    if (id) {
      const info = await Project.get(ProjectID.make(id))
      if (!info) {
        return c.json({ error: "Unknown project", projectID: id }, 400)
      }
      return { ...info, vcs: undefined }
    }

    const tenantUserId = isOpencodeWorkosEnabled()
      ? (await getRequestUser(c))?.id
      : process.env["OPENCODE_E2E_TENANT_USER_ID"]?.trim() ||
        process.env["OPENCODE_E2E_USER_ID"]?.trim() ||
        "e2e_test_user"
    if (tenantUserId) {
      const list = await listProjectsSimple(tenantUserId)
      const first = list[0]
      if (first) return { ...first, vcs: undefined }
    }
  }

  const root = (() => {
    const fromEnv = process.env.OPENCODE_INSTANCE_ROOT?.trim()
    if (fromEnv) return Filesystem.resolve(fromEnv)
    return Filesystem.resolve(process.cwd())
  })()
  return localProject(root)
}
