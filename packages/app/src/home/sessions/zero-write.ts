export const PROTECTED_TABLES = ["session_v2", "worktree", "project_directory", "permission"] as const

export type ProtectedTable = (typeof PROTECTED_TABLES)[number]

export const FORBID_PROJECT_DELETE = true as const

export function isProtectedWrite(sql: string) {
  const normalized = sql.trim().toLowerCase().replace(/\s+/g, " ")
  return PROTECTED_TABLES.some(
    (table) => normalized.includes(`insert into ${table}`) || normalized.includes(`update ${table} `),
  )
}

export function assertNoProtectedWrite(sql: string) {
  if (isProtectedWrite(sql)) throw new Error(`[zero-write] blocked write to protected table`)
}
