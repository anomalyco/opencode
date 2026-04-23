/**
 * Sign in a dedicated staging test user via WorkOS (AuthKit password) and write a sealed `wos-session`
 * into `my-auth.json` (Playwright storageState) for `agent-browser --state`.
 *
 * Set `STAGING_TEST_EMAIL` and `STAGING_TEST_PASSWORD` in repo root `.env.development` (gitignored),
 * with `WORKOS_*` and `COOKIE_PASSWORD` for the same WorkOS environment as the user. Then: `bun run staging:test-session`.
 *
 * Required env: STAGING_TEST_EMAIL, STAGING_TEST_PASSWORD, WORKOS_API_KEY, WORKOS_CLIENT_ID, COOKIE_PASSWORD
 * (use the **staging** WorkOS app and the same `COOKIE_PASSWORD` the API uses to seal cookies).
 *
 * Optional: STAGING_COOKIE_DOMAINS — comma-separated `Domain` values for each cookie row (default: 127.0.0.1,localhost).
 * Add e.g. `.veritly.co.uk` if you open `https://app…` in agent-browser; host must match how the browser sends cookies.
 *
 * Optional: MY_AUTH_JSON — output path (default: repo root `my-auth.json`).
 */

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Buffer } from "node:buffer"
import { createWorkOSClient, requireCookiePassword, requireNonEmpty, WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../..")
const defaultOut = path.join(repoRoot, "my-auth.json")

type PlaywrightState = { cookies: Record<string, unknown>[]; origins: unknown[] }

function die(msg: string): never {
  console.error(msg)
  process.exit(1)
}

function testPassword() {
  const b64 = process.env["STAGING_TEST_PASSWORD_B64"]?.trim()
  if (b64) {
    return Buffer.from(b64, "base64").toString("utf8")
  }
  return requireNonEmpty(process.env["STAGING_TEST_PASSWORD"], "STAGING_TEST_PASSWORD (or STAGING_TEST_PASSWORD_B64)")
}

const COOKIE_TTL_SEC = 60 * 60 * 24 * 7

function localDomain(d: string) {
  return d === "127.0.0.1" || d === "localhost" || /^192\.168\./.test(d) || d === "0.0.0.0"
}

function row(domain: string, sealed: string) {
  const now = Date.now() / 1000 + COOKIE_TTL_SEC
  const d = domain.trim()
  if (!d) return null
  return {
    name: WORKOS_SESSION_COOKIE_NAME,
    value: sealed,
    domain: d,
    path: "/",
    expires: now,
    httpOnly: true,
    secure: !localDomain(d),
    sameSite: "Lax" as const,
  }
}

async function writeState(target: string, sealed: string, domains: string[]) {
  const cookies: Record<string, unknown>[] = []
  for (const d of domains) {
    const r = row(d, sealed)
    if (r) cookies.push(r)
  }
  const out: PlaywrightState = { cookies, origins: [] }
  await mkdir(path.dirname(path.resolve(target)), { recursive: true })
  await writeFile(target, `${JSON.stringify(out, null, 2)}\n`, "utf-8")
  console.error(`Wrote: ${path.resolve(target)}`)
}

function domainsFromEnv(): string[] {
  const raw = process.env["STAGING_COOKIE_DOMAINS"]?.trim()
  if (raw) {
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return ["127.0.0.1", "localhost"]
}

async function main() {
  const email = requireNonEmpty(process.env["STAGING_TEST_EMAIL"], "STAGING_TEST_EMAIL")
  const pass = testPassword()
  const apiKey = requireNonEmpty(process.env["WORKOS_API_KEY"], "WORKOS_API_KEY")
  const clientId = requireNonEmpty(process.env["WORKOS_CLIENT_ID"], "WORKOS_CLIENT_ID")
  const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
  const outPath = process.env["MY_AUTH_JSON"]?.trim() || defaultOut
  const domains = domainsFromEnv()

  const workos = createWorkOSClient({ apiKey, clientId })
  const { sealedSession } = await workos.userManagement.authenticateWithPassword({
    clientId,
    email,
    password: pass,
    session: { sealSession: true, cookiePassword },
  })
  if (!sealedSession) {
    die("WorkOS did not return sealedSession. Check that password auth is enabled for this user and environment.")
  }

  await writeState(outPath, sealedSession, domains)
  console.log(`export WORKOS_SESSION_DATA='${sealedSession.replace(/'/g, `'\\''`)}'`)
  console.error("agent-browser: close existing session first, then: agent-browser --state ./my-auth.json open <staging-url>")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
