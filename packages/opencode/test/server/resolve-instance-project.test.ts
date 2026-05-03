import { describe, expect, test } from "bun:test"
import type { Context } from "hono"
import { HTTPException } from "hono/http-exception"
import { Project } from "../../src/project/project"
import { resolveInstanceProject } from "../../src/server/resolve-instance-project"
import { Log } from "../../src/util/log"

Log.init({ print: false })

function ctx(query: Record<string, string | undefined>, headers: Record<string, string> = {}) {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue
    params.set(k, v)
  }
  const qs = params.toString()
  const href = qs ? `http://x/?${qs}` : `http://x/`
  return {
    req: {
      url: href,
      query: (name: string) => query[name],
      header: (name: string) => headers[name],
    },
  } as unknown as Context
}

const dsn = process.env.DATABASE_URL?.trim()
const hasPg = Boolean(dsn?.startsWith("postgresql://") || dsn?.startsWith("postgres://"))

describe.skipIf(!hasPg)("resolveInstanceProject", () => {
  test("uses ?directory= as project id when ?project= is absent", async () => {
    const left = await Project.createSimple({ name: "resolve-dir-a", tenantUserId: "user_resolve_dir" })
    const right = await Project.createSimple({ name: "resolve-dir-b", tenantUserId: "user_resolve_dir" })

    const got = await resolveInstanceProject(ctx({ directory: right.project.id }))
    expect(got instanceof Response).toBe(false)
    if (got instanceof Response) return
    expect(got.id).toBe(right.project.id)
    expect(got.id).not.toBe(left.project.id)
  })

  test("strips /projects/ prefix on directory query", async () => {
    const row = await Project.createSimple({ name: "resolve-prefix", tenantUserId: "user_resolve_prefix" })
    const handle = `/projects/${row.project.id}`

    const got = await resolveInstanceProject(ctx({ directory: handle }))
    expect(got instanceof Response).toBe(false)
    if (got instanceof Response) return
    expect(got.id).toBe(row.project.id)
  })

  test("prefers ?project= over ?directory=", async () => {
    const left = await Project.createSimple({ name: "resolve-pref-a", tenantUserId: "user_resolve_pref" })
    const right = await Project.createSimple({ name: "resolve-pref-b", tenantUserId: "user_resolve_pref" })

    const got = await resolveInstanceProject(ctx({ project: left.project.id, directory: right.project.id }))
    expect(got instanceof Response).toBe(false)
    if (got instanceof Response) return
    expect(got.id).toBe(left.project.id)
  })

  test("throws when directory query is present but empty", async () => {
    await expect(resolveInstanceProject(ctx({ directory: "" }))).rejects.toBeInstanceOf(HTTPException)
  })

  test("throws when project id is unknown", async () => {
    await expect(
      resolveInstanceProject(ctx({ directory: "00000000-0000-4000-8000-000000000000" })),
    ).rejects.toBeInstanceOf(HTTPException)
  })
})
