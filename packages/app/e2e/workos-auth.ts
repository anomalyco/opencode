import { Buffer } from "node:buffer"
import type { Page } from "@playwright/test"
import {
  createWorkOSClient,
  requireCookiePassword,
  requireNonEmpty,
  WORKOS_SESSION_COOKIE_NAME,
} from "@veritly/auth-shared"

const SEAL_TTL_MS = 4 * 60 * 1000
const sealCache = new Map<string, { seal: string; expires: number }>()

/**
 * Vite + Playwright base (where `wos-session` is set). Not the OpenCode API port.
 * Prefer `PLAYWRIGHT_BASE_URL` (e.g. from `e2e-local`); else default to dev server.
 */
export function e2eAppOrigin(): string {
  const b = process.env.PLAYWRIGHT_BASE_URL?.trim()
  if (b) return b.replace(/\/$/, "")
  const port = process.env.PLAYWRIGHT_PORT?.trim() || "3000"
  return `http://127.0.0.1:${port}`
}

function e2eTestPassword(): string {
  const b64 = process.env["E2E_WORKOS_PASSWORD_B64"]?.trim() || process.env["STAGING_TEST_PASSWORD_B64"]?.trim()
  if (b64) {
    return Buffer.from(b64, "base64").toString("utf8")
  }
  return requireNonEmpty(
    process.env["E2E_WORKOS_PASSWORD"] ?? process.env["STAGING_TEST_PASSWORD"],
    "E2E_WORKOS_PASSWORD (or STAGING_TEST_PASSWORD), or * _B64",
  )
}

function e2eTestEmail(): string {
  return requireNonEmpty(
    process.env["E2E_WORKOS_EMAIL"] ?? process.env["STAGING_TEST_EMAIL"],
    "E2E_WORKOS_EMAIL (or STAGING_TEST_EMAIL)",
  )
}

function tenantBPassword(): string {
  const b64 = process.env["E2E_WORKOS_TENANT_B_PASSWORD_B64"]?.trim()
  if (b64) return Buffer.from(b64, "base64").toString("utf8")
  return requireNonEmpty(
    process.env["E2E_WORKOS_TENANT_B_PASSWORD"],
    "E2E_WORKOS_TENANT_B_PASSWORD (or E2E_WORKOS_TENANT_B_PASSWORD_B64)",
  )
}

export function tenantBEmail(): string {
  return requireNonEmpty(process.env["E2E_WORKOS_TENANT_B_EMAIL"], "E2E_WORKOS_TENANT_B_EMAIL")
}

function cacheKey(email: string, password: string) {
  return `${email.trim()}\n${password}`
}

/**
 * Mints a sealed `wos-session` via the real WorkOS User Management API (AuthKit
 * password), using the same stack as `bun run staging:test-session` in packages/opencode.
 * Cached briefly per email/password pair to avoid rate limits.
 */
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

/** Apply `wos-session` for a specific WorkOS user (second tenant for isolation tests). */
export async function applyE2eWorkosSessionWith(page: Page, email: string, password: string) {
  const seal = await mintE2eSealedSessionFromCredentials(email, password)
  await page.context().addCookies([
    {
      name: WORKOS_SESSION_COOKIE_NAME,
      value: seal,
      url: e2eAppOrigin(),
    },
  ])
}

export async function mintE2eSealedSessionForTenantB(): Promise<string> {
  return mintE2eSealedSessionFromCredentials(tenantBEmail(), tenantBPassword())
}

/** Apply a real `wos-session` cookie to the current browser context. */
export async function applyE2eWorkosSession(page: Page) {
  const seal = await mintE2eSealedSessionFromWorkos()
  await page.context().addCookies([
    {
      name: WORKOS_SESSION_COOKIE_NAME,
      value: seal,
      url: e2eAppOrigin(),
    },
  ])
}

export async function clearE2eWorkosSession(page: Page) {
  await page.context().clearCookies({ name: WORKOS_SESSION_COOKIE_NAME })
}

/**
 * Real WorkOS sign-in for a test: mint sealed session, run callback, remove the session cookie.
 * (Does not start browser OAuth; uses `authenticateWithPassword` like the staging test-session script.)
 */
export async function withAuth<T>(page: Page, run: (page: Page) => Promise<T>): Promise<T> {
  await applyE2eWorkosSession(page)
  try {
    return await run(page)
  } finally {
    await clearE2eWorkosSession(page)
  }
}
