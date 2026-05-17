import { Buffer } from "node:buffer"
import {
  createWorkOSClient,
  requireCookiePassword,
  requireNonEmpty,
  WORKOS_SESSION_COOKIE_NAME,
} from "@veritly/auth-shared"

const SEAL_TTL_MS = 4 * 60 * 1000
const sealCache = new Map<string, { seal: string; expires: number }>()

export function e2eAppOrigin(): string {
  const b = process.env.PLAYWRIGHT_BASE_URL?.trim()
  if (b) return b.replace(/\/$/, "")
  const port = process.env.PLAYWRIGHT_PORT?.trim()
  if (port && port.length > 0) return `http://127.0.0.1:${port}`
  return `http://127.0.0.1:3000`
}

function e2eTestPassword(): string {
  const b64 = process.env["E2E_WORKOS_PASSWORD_B64"]?.trim() || process.env["STAGING_TEST_PASSWORD_B64"]?.trim()
  if (b64) {
    return Buffer.from(b64, "base64").toString("utf8")
  }
  const plain = process.env["E2E_WORKOS_PASSWORD"]
  if (plain && plain.trim().length > 0) return plain
  const staging = process.env["STAGING_TEST_PASSWORD"]
  if (staging && staging.trim().length > 0) return staging
  throw new Error("E2E_WORKOS_PASSWORD (or STAGING_TEST_PASSWORD), or * _B64")
}

function e2eTestEmail(): string {
  const e = process.env["E2E_WORKOS_EMAIL"]
  if (e && e.trim().length > 0) return e
  const s = process.env["STAGING_TEST_EMAIL"]
  if (s && s.trim().length > 0) return s
  throw new Error("E2E_WORKOS_EMAIL (or STAGING_TEST_EMAIL)")
}

function tenantBPassword(): string {
  const b64 = process.env["E2E_WORKOS_TENANT_B_PASSWORD_B64"]?.trim()
  if (b64) return Buffer.from(b64, "base64").toString("utf8")
  return requireNonEmpty(process.env["E2E_WORKOS_TENANT_B_PASSWORD"], "E2E_WORKOS_TENANT_B_PASSWORD (or E2E_WORKOS_TENANT_B_PASSWORD_B64)")
}

export function tenantBEmail(): string {
  return requireNonEmpty(process.env["E2E_WORKOS_TENANT_B_EMAIL"], "E2E_WORKOS_TENANT_B_EMAIL")
}

function cacheKey(email: string, password: string) {
  return `${email.trim()}\n${password}`
}

export async function mintE2eSealedSessionFromCredentials(email: string, password: string): Promise<string> {
  const k = cacheKey(email, password)
  const hit = sealCache.get(k)
  if (hit && Date.now() < hit.expires) {
    return hit.seal
  }
  const apiKey = requireNonEmpty(process.env["WORKOS_API_KEY"], "WORKOS_API_KEY")
  const clientId = requireNonEmpty(process.env["WORKOS_CLIENT_ID"], "WORKOS_CLIENT_ID")
  const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
  const workos = createWorkOSClient({ apiKey, clientId })
  const { sealedSession } = await workos.userManagement.authenticateWithPassword({
    clientId,
    email: email.trim(),
    password,
    session: { sealSession: true, cookiePassword },
  })
  if (!sealedSession) {
    throw new Error(
      "WorkOS did not return sealedSession — enable password auth for this test user in this environment.",
    )
  }
  sealCache.set(k, { seal: sealedSession, expires: Date.now() + SEAL_TTL_MS })
  return sealedSession
}

export async function mintE2eSealedSessionFromWorkos(): Promise<string> {
  return mintE2eSealedSessionFromCredentials(e2eTestEmail(), e2eTestPassword())
}

export async function mintE2eSealedSessionForTenantB(): Promise<string> {
  return mintE2eSealedSessionFromCredentials(tenantBEmail(), tenantBPassword())
}

export { WORKOS_SESSION_COOKIE_NAME }
