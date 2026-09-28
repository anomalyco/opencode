import { describe, expect, test } from "bun:test"
import {
  FORBID_PROJECT_DELETE,
  PROTECTED_TABLES,
  assertNoProtectedWrite,
  isProtectedWrite,
} from "./zero-write"
import { HOME_SESSION_DISPLAY_LIMIT, HOME_SESSION_INDEX_LIMIT, HOME_SESSION_LIMIT } from "./index"
import { HOME_SESSION_SEARCH_LIMIT } from "./search"
import { WINDOWS_ALIAS_VERSION } from "@/workspaces/path-key"

const planDir = `${import.meta.dir}/../../../../../docs/plans/20260928-project-list-coverage`

describe("T1 zero-db-write harness", () => {
  test("protects session_v2 worktree project_directory permission", () => {
    expect([...PROTECTED_TABLES].sort().join(",")).toBe("permission,project_directory,session_v2,worktree")
  })

  test("fails on INSERT into protected tables", () => {
    expect(isProtectedWrite("INSERT INTO session_v2 (id) VALUES ('x')")).toBe(true)
    expect(isProtectedWrite("insert into worktree (project_id) values ('p')")).toBe(true)
    expect(isProtectedWrite("INSERT INTO project_directory (project_id) VALUES ('p')")).toBe(true)
    expect(isProtectedWrite("INSERT INTO permission (id) VALUES ('p')")).toBe(true)
  })

  test("fails on UPDATE of protected tables", () => {
    expect(isProtectedWrite("UPDATE session_v2 SET title='t' WHERE id='x'")).toBe(true)
    expect(isProtectedWrite("update permission set resource='r' where id='p'")).toBe(true)
    expect(isProtectedWrite("UPDATE worktree SET strategy='s'")).toBe(true)
    expect(isProtectedWrite("UPDATE project_directory SET type='main'")).toBe(true)
  })

  test("allows reads and unrelated writes", () => {
    expect(isProtectedWrite("SELECT * FROM session_v2 WHERE id='x'")).toBe(false)
    expect(isProtectedWrite("SELECT * FROM project WHERE id='p'")).toBe(false)
    expect(isProtectedWrite("INSERT INTO session_message (id) VALUES ('m')")).toBe(false)
    expect(isProtectedWrite("UPDATE kv SET value='v' WHERE key='k'")).toBe(false)
  })

  test("assert throws on protected writes only", () => {
    expect(() => assertNoProtectedWrite("SELECT * FROM session_v2")).not.toThrow()
    expect(() => assertNoProtectedWrite("INSERT INTO session_v2 (id) VALUES ('x')")).toThrow()
    expect(() => assertNoProtectedWrite("UPDATE permission SET resource='r'")).toThrow()
  })

  test("forbids core project delete", () => {
    expect(FORBID_PROJECT_DELETE).toBe(true)
  })

  test("CASCADE project delete check pins generated schema", async () => {
    const schema = await Bun.file(
      `${import.meta.dir}/../../../../core/src/database/schema.gen.ts`,
    ).text()
    for (const table of ["session_v2", "worktree", "project_directory", "permission"]) {
      expect(schema.includes(table)).toBe(true)
    }
    expect(schema.includes("ON DELETE CASCADE")).toBe(true)
    expect(schema.includes("fk_session_v2_project_id_project_id_fk")).toBe(true)
    expect(schema.includes("fk_worktree_project_id_project_id_fk")).toBe(true)
    expect(schema.includes("fk_project_directory_project_id_project_id_fk")).toBe(true)
    expect(schema.includes("fk_permission_project_id_project_id_fk")).toBe(true)
  })

  test("migrations diff-gate pins source tables to generated schema", async () => {
    const sessionSql = await Bun.file(`${import.meta.dir}/../../../../core/src/session/sql.ts`).text()
    const projectSql = await Bun.file(`${import.meta.dir}/../../../../core/src/project/sql.ts`).text()
    expect(sessionSql.includes('"session_v2"')).toBe(true)
    expect(projectSql.includes('"project_directory"')).toBe(true)
    expect(projectSql.includes('"project"')).toBe(true)
  })

  test("preserves DISPLAY 512 SEARCH 100 ALIAS v20260927-r3-04-v1", () => {
    expect(HOME_SESSION_DISPLAY_LIMIT).toBe(512)
    expect(HOME_SESSION_SEARCH_LIMIT).toBe(100)
    expect(WINDOWS_ALIAS_VERSION).toBe("20260927-r3-04-v1")
    expect(HOME_SESSION_LIMIT).toBe(64)
    expect(HOME_SESSION_INDEX_LIMIT).toBe(114)
  })

  test("baseline artifact pins p50 3.8ms p95 11.5ms with url+inode", async () => {
    const baseline = await Bun.file(`${planDir}/baseline.json`).json()
    expect(baseline.baseline.p50_ms).toBe(3.8)
    expect(baseline.baseline.p95_ms).toBe(11.5)
    expect(typeof baseline.baseline.url).toBe("string")
    expect(typeof baseline.baseline.inode).toBe("number")
    expect(baseline.baseline.url.length).toBeGreaterThan(0)
    expect(baseline.preserved.DISPLAY).toBe(512)
    expect(baseline.preserved.SEARCH).toBe(100)
    expect(baseline.preserved.ALIAS).toBe("20260927-r3-04-v1")
  })

  test("branch artifact stays v2-based with PR target v2", async () => {
    const branch = await Bun.file(`${planDir}/branch.json`).json()
    expect(branch.pr_target).toBe("v2")
    expect(branch.base_ref).toBe("origin/v2")
    expect(typeof branch.base_sha).toBe("string")
    expect(branch.base_sha.length).toBe(40)
    expect(typeof branch.branch).toBe("string")
  })
})
