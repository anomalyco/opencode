import { Buffer } from "node:buffer"
import type { Page } from "@playwright/test"
import {
  createWorkOSClient,
  requireCookiePassword,
  requireNonEmpty,
  WORKOS_SESSION_COOKIE_NAME,
} from "@veritly/auth-shared"

const SEAL_TTL_MS = 4 * 60 * 1000
let cache: { seal: string; expires: number } | null = null

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
  const b64 =
    process.env["E2E_WORKOS_PASSWORD_B64"]?.trim() || process.env["STAGING_TEST_PASSWORD_B64"]?.trim()
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

/**
 * Mints a sealed `wos-session` via the real WorkOS User Management API (AuthKit
 * password), using the same stack as `bun run staging:test-session` in packages/opencode.
 * Cached briefly to avoid rate limits.
 */
export async function mintE2eSealedSessionFromWorkos(): Promise<string> {
  if (cache && Date.now() < cache.expires) {
    return cache.seal
  }
  const apiKey = requireNonEmpty(process.env["WORKOS_API_KEY"], "WORKOS_API_KEY")
  const clientId = requireNonEmpty(process.env["WORKOS_CLIENT_ID"], "WORKOS_CLIENT_ID")
  const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
  const workos = createWorkOSClient({ apiKey, clientId })
  const { sealedSession } = await workos.userManagement.authenticateWithPassword({
    clientId,
    email: e2eTestEmail(),
    password: e2eTestPassword(),
    session: { sealSession: true, cookiePassword },
  })
  if (!sealedSession) {
    throw new Error(
      "WorkOS did not return sealedSession — enable password auth for this test user in this environment.",
    )
  }
  cache = { seal: sealedSession, expires: Date.now() + SEAL_TTL_MS }
  return sealedSession
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
