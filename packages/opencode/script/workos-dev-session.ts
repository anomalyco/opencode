/**
 * Generate `my-auth.json` (Playwright storageState) with a valid WorkOS `wos-session` for local dev.
 * Use that path as Playwright `storageState` or let automation load it so the app is not blocked by login.
 * This is normal OAuth/sealed-session credentials for your Staging app — not a server backdoor.
 *
 * Requires: WORKOS_API_KEY, WORKOS_CLIENT_ID, COOKIE_PASSWORD (e.g. `bun run workos:dev-session` with `.env.development`).
 *
 * Modes:
 * - Default: find an existing seal in WORKOS_SESSION_DATA, then `my-auth.json` cookies, then workos-session.local.json; refresh/mint, write `my-auth.json`.
 * - `--password`: new seal with WORKOS_DEV_EMAIL + WORKOS_DEV_PASSWORD.
 *
 * Output: repo root `my-auth.json` unless `MY_AUTH_JSON` points elsewhere.
 * `readFile`/`writeFile` are async (non-blocking) — same result as sync, better for a small script under load.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createWorkOSClient, requireCookiePassword, requireNonEmpty, validateWorkosSession, WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../../..")
const defaultMyAuth = path.join(repoRoot, "my-auth.json")
const defaultLegacy = path.join(repoRoot, "workos-session.local.json")

type PlaywrightState = { cookies: Record<string, unknown>[]; origins: unknown[] }
type SealedFile = { sealedSession: string; updatedAt?: string; note?: string }

function die(msg: string): never {
  console.error(msg)
  process.exit(1)
}

async function readText(pathname: string) {
  return readFile(pathname, "utf-8")
}

async function readSealedFromPlaywrightState(pathname: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readText(pathname)) as PlaywrightState
    if (!Array.isArray(raw.cookies)) return null
    const c = raw.cookies.find(
      (row) => row && (row as { name?: string }).name === WORKOS_SESSION_COOKIE_NAME,
    ) as { value?: string } | undefined
    return c?.value?.trim() || null
  } catch {
    return null
  }
}

/** Legacy `{ "sealedSession": "..." }` file, if present. */
async function readSealedFromLegacyFile(pathname: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await readText(pathname)) as SealedFile
    return raw.sealedSession?.trim() || null
  } catch {
    return null
  }
}

async function readPriorSeal(input: { myPath: string; legacyPath: string }): Promise<string | null> {
  const fromEnv = process.env["WORKOS_SESSION_DATA"]?.trim()
  if (fromEnv) return fromEnv
  const fromMy = await readSealedFromPlaywrightState(input.myPath)
  if (fromMy) return fromMy
  return await readSealedFromLegacyFile(input.legacyPath)
}

function parseArgs() {
  const a = process.argv.slice(2)
  return { usePassword: a.includes("--password") }
}

const COOKIE_TTL_SEC = 60 * 60 * 24 * 7

function cookieRow(domain: string, sealed: string) {
  const now = Date.now() / 1000 + COOKIE_TTL_SEC
  return {
    name: WORKOS_SESSION_COOKIE_NAME,
    value: sealed,
    domain,
    path: "/",
    expires: now,
    httpOnly: true,
    secure: domain !== "127.0.0.1" && domain !== "localhost",
    sameSite: "Lax" as const,
  }
}

/** Full Playwright storage state for local HTTP APIs (adjust domains if you use a different host). */
async function writeMyAuthJson(target: string, sealed: string) {
  let data: PlaywrightState
  try {
    const parsed = JSON.parse(await readFile(target, "utf-8")) as PlaywrightState
    data = { cookies: Array.isArray(parsed.cookies) ? parsed.cookies : [], origins: Array.isArray(parsed.origins) ? parsed.origins : [] }
  } catch {
    data = { cookies: [], origins: [] }
  }
  const name = WORKOS_SESSION_COOKIE_NAME
  for (const domain of ["127.0.0.1", "localhost"]) {
    const row = cookieRow(domain, sealed)
    const idx = data.cookies.findIndex(
      (c) => c && (c as { name?: string; domain?: string }).name === name && (c as { domain?: string }).domain === domain,
    )
    if (idx >= 0) data.cookies[idx] = row
    else data.cookies.push(row)
  }
  await mkdir(path.dirname(path.resolve(target)), { recursive: true })
  await writeFile(target, `${JSON.stringify({ cookies: data.cookies, origins: data.origins }, null, 2)}\n`, "utf-8")
  console.error(`Wrote Playwright storage (use as storageState): ${path.resolve(target)}`)
}

async function main() {
  const { usePassword } = parseArgs()
  const apiKey = process.env["WORKOS_API_KEY"]?.trim()
  const clientId = process.env["WORKOS_CLIENT_ID"]?.trim()
  if (!apiKey || !clientId) die("Set WORKOS_API_KEY and WORKOS_CLIENT_ID (e.g. via .env.development).")
  const cookiePassword = requireCookiePassword(process.env["COOKIE_PASSWORD"])
  const myPath = process.env["MY_AUTH_JSON"]?.trim() || defaultMyAuth
  const workos = createWorkOSClient({ apiKey, clientId })

  let sealed: string

  if (usePassword) {
    const email = requireNonEmpty(process.env["WORKOS_DEV_EMAIL"], "WORKOS_DEV_EMAIL")
    const password = requireNonEmpty(process.env["WORKOS_DEV_PASSWORD"], "WORKOS_DEV_PASSWORD")
    const { sealedSession } = await workos.userManagement.authenticateWithPassword({
      clientId,
      email,
      password,
      session: { sealSession: true, cookiePassword },
    })
    if (!sealedSession) die("WorkOS did not return a sealed session (sealSession may be disabled for this app).")
    sealed = sealedSession
  } else {
    const prior = await readPriorSeal({ myPath, legacyPath: defaultLegacy })
    if (!prior) {
      die(
        `No existing sealed session. Set WORKOS_SESSION_DATA, place a prior my-auth.json, or run: bun run workos:dev-session --password (with WORKOS_DEV_EMAIL / WORKOS_DEV_PASSWORD).`,
      )
    }
    const result = await validateWorkosSession({ workos, sessionData: prior, cookiePassword })
    if (result.ok) {
      sealed = result.refreshedSessionData || prior
      if (result.refreshedSessionData) console.error("Refreshed JWT inside seal (WorkOS).")
      else console.error("Sealed session still valid.")
    } else {
      const session = await workos.userManagement.loadSealedSession({ sessionData: prior, cookiePassword })
      const refreshed = await session.refresh()
      if (!refreshed.authenticated || !refreshed.sealedSession) {
        die("Could not refresh; log in again with --password or a fresh wos-session from the browser.")
      }
      sealed = refreshed.sealedSession
      console.error("Refreshed via loadSealedSession().refresh().")
    }
  }

  await writeMyAuthJson(myPath, sealed)

  console.log(`export WORKOS_SESSION_DATA='${sealed.replace(/'/g, `'\\''`)}'`)
  console.error(
    "\nCLI: eval the export above for WORKOS_SESSION_DATA. Browser: install `agent-browser` from npm, then e.g. `bun run agent-browser -- --state " +
      myPath +
      " open http://127.0.0.1:4444/`.",
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
