/**
 * Host-side guard before starting Univer Testcontainers / Playwright with `PLAYWRIGHT_E2E_INFRA=univer`.
 * univer-compat validates `wos-session` via WorkOS — same keys must exist on the host that spawns Docker.
 */
export function assertHostWorkosForUniverE2e(): void {
  const missing: string[] = []
  for (const k of ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "COOKIE_PASSWORD"] as const) {
    if (!process.env[k]?.trim()) missing.push(k)
  }
  const email = process.env.E2E_WORKOS_EMAIL?.trim() || process.env.STAGING_TEST_EMAIL?.trim()
  if (!email) missing.push("E2E_WORKOS_EMAIL or STAGING_TEST_EMAIL")
  const hasPass =
    Boolean(process.env.E2E_WORKOS_PASSWORD?.trim()) ||
    Boolean(process.env.E2E_WORKOS_PASSWORD_B64?.trim()) ||
    Boolean(process.env.STAGING_TEST_PASSWORD?.trim()) ||
    Boolean(process.env.STAGING_TEST_PASSWORD_B64?.trim())
  if (!hasPass) missing.push("E2E_WORKOS_PASSWORD (or _B64 / STAGING_TEST_*)")
  if (missing.length) {
    throw new Error(`Univer E2E requires host env: ${missing.join(", ")} (staging WorkOS + password-auth user).`)
  }
}
