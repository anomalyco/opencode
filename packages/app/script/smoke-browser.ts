#!/usr/bin/env bun
/**
 * Smoke: WorkOS password → sealed session cookie, then **HTTP** GET the app root with that cookie.
 * Catches obvious deploy/auth/HTML failures without a browser driver (Playwright removed from this package).
 *
 *   bun run smoke:browser
 *   SMOKE_BASE_URL=http://127.0.0.1:4445/ bun run smoke:browser
 *
 * Optional: if `PLAYWRIGHT_SERVER_HOST` + `PLAYWRIGHT_SERVER_PORT` are set, also GET `/readyz` on the API.
 */

import { Buffer } from "node:buffer"
import { createWorkOSClient, requireCookiePassword, requireNonEmpty, WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"

const base = process.env.SMOKE_BASE_URL?.replace(/\/?$/, "/") || "http://127.0.0.1:4444/"

function pw() {
  const b64 = process.env.STAGING_TEST_PASSWORD_B64?.trim()
  if (b64) return Buffer.from(b64, "base64").toString("utf8")
  return requireNonEmpty(process.env.STAGING_TEST_PASSWORD, "STAGING_TEST_PASSWORD or STAGING_TEST_PASSWORD_B64")
}

async function getSeal() {
  const email = requireNonEmpty(process.env.STAGING_TEST_EMAIL, "STAGING_TEST_EMAIL")
  const pass = pw()
  const apiKey = requireNonEmpty(process.env.WORKOS_API_KEY, "WORKOS_API_KEY")
  const clientId = requireNonEmpty(process.env.WORKOS_CLIENT_ID, "WORKOS_CLIENT_ID")
  const cookiePassword = requireCookiePassword(process.env.COOKIE_PASSWORD)
  const workos = createWorkOSClient({ apiKey, clientId })
  const { sealedSession } = await workos.userManagement.authenticateWithPassword({
    clientId,
    email,
    password: pass,
    session: { sealSession: true, cookiePassword },
  })
  if (!sealedSession) throw new Error("WorkOS returned no sealedSession")
  return sealedSession
}

async function probe(url: string, cookie: string) {
  const res = await fetch(url, {
    headers: { Cookie: cookie, Accept: "text/html,application/json,*/*" },
    redirect: "follow",
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    return { ok: false as const, status: res.status, body: body.slice(0, 2000) }
  }
  return { ok: true as const, status: res.status }
}

async function run() {
  const seal = await getSeal()
  const cookie = `${WORKOS_SESSION_COOKIE_NAME}=${encodeURIComponent(seal)}`

  const app = await probe(base, cookie)
  if (!app.ok) {
    console.error(JSON.stringify({ step: "app_root", url: base, status: app.status, body: app.body }, null, 2))
    process.exit(1)
  }

  const host = process.env.PLAYWRIGHT_SERVER_HOST?.trim()
  const port = process.env.PLAYWRIGHT_SERVER_PORT?.trim()
  if (host && port) {
    const readyz = `http://${host}:${port}/readyz`
    const api = await probe(readyz, cookie)
    if (!api.ok) {
      console.error(JSON.stringify({ step: "readyz", url: readyz, status: api.status, body: api.body }, null, 2))
      process.exit(1)
    }
  }

  process.stdout.write(`smoke-browser ok: ${base}\n`)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
