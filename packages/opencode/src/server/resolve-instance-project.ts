import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { Project } from "@/project/project"
import { ProjectID } from "@/project/schema"
import { getRequestUser } from "./routes/auth"
import { isOpencodeWorkosEnabled } from "./workos-env"
import { listProjectsSimple } from "@/storage/project-pg"

type R = Project.Info | Response

function isPostgres() {
  const dsn = process.env.DATABASE_URL?.trim()
  if (!dsn) return false
  return dsn.startsWith("postgresql://") || dsn.startsWith("postgres://")
}

/**
 * Resolves `project` row only — no filesystem cwd / “repo root”.
 *
 * - `?project=<id>` or `x-opencode-project: <id>`
 * - Else `?directory=<id>` (SDK / web UI: route `/:dir` is the project id and is sent as `directory`)
 * - Else first project for the tenant (Postgres).
 *
 * Invalid request URL: `new URL` throws. Empty `?project=` / `?directory=`, unknown id, or no tenant project: HTTP 400 via HTTPException (never silently pick the wrong project).
 */
export async function resolveInstanceProject(c: Context): Promise<R> {
  if (!isPostgres()) {
    return c.json({ error: "DATABASE_URL must be postgresql:// or postgres:// for API project resolution" }, 503)
  }

  const pick = (value: string | undefined) => {
    const trimmed = value?.trim()
    if (!trimmed) return
    return trimmed
  }

  const url = new URL(c.req.url)

  const read = (key: string) => {
    const raw = c.req.query(key)
    const head = Array.isArray(raw) ? raw[0] : raw
    const one = pick(head)
    if (one) return one
    const hit = url.searchParams.get(key)
    if (!hit) return
    return pick(hit)
  }

  const p = read("project")
  if (url.searchParams.has("project") && !p) {
    throw new HTTPException(400, { message: "project query must be a non-empty id" })
  }

  const d = read("directory")
  if (url.searchParams.has("directory") && !d) {
    throw new HTTPException(400, { message: "directory query must be a non-empty project id" })
  }

  const key =
    d && d.startsWith("/projects/")
      ? d.slice("/projects/".length)
      : d

  const id = p || pick(c.req.header("x-opencode-project")) || key

  if (id) {
    const info = await Project.get(ProjectID.make(id))
    if (!info) {
      throw new HTTPException(400, {
        res: Response.json({ error: "Unknown project", projectID: id }),
      })
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

  throw new HTTPException(400, {
    res: Response.json({
      error: "No project",
      detail: "Pass ?project=, ?directory=, x-opencode-project, or create a project for this tenant.",
    }),
  })
}
