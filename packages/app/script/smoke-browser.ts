#!/usr/bin/env bun
/**
 * Smoke: WorkOS password → sealed `wos-session` cookies for 127.0.0.1, open the Vite app in Playwright,
 * wait, print console lines, page errors, and **every bad HTTP response** (status >= 400) with body text.
 * Also records **requestfailed** network errors.
 * Exit 1 if any: pageerror, error/assert console, bad HTTP, or request failed.
 *
 *   bun run smoke:browser
 *   SMOKE_BASE_URL=http://127.0.0.1:4445/ bun run smoke:browser
 *   SMOKE_BAD_RESPONSE_MAX_CHARS=8000 SMOKE_FAIL_ON_BAD_HTTP=0 bun run smoke:browser
 */

import { Buffer } from "node:buffer"
import { chromium, type ConsoleMessage, type Page } from "playwright"
import { createWorkOSClient, requireCookiePassword, requireNonEmpty, WORKOS_SESSION_COOKIE_NAME } from "@veritly/auth-shared"

const base = process.env.SMOKE_BASE_URL?.replace(/\/?$/, "/") || "http://127.0.0.1:4444/"
const settleMs = Number(process.env.SMOKE_SETTLE_MS) || 4000
const headed = process.env.SMOKE_HEADED === "1" || process.env.SMOKE_HEADED === "true"
const maxBody = Number(process.env.SMOKE_BAD_RESPONSE_MAX_CHARS) || 16_384
const failOnBadHttp = process.env.SMOKE_FAIL_ON_BAD_HTTP !== "0" && process.env.SMOKE_FAIL_ON_BAD_HTTP !== "false"

type Row = { type: string; text: string; location?: string }

type BadHttp = {
  kind: "response"
  url: string
  method: string
  status: number
  statusText: string
  contentType: string
  body: string
  bodyTruncated: boolean
}

type RequestFailed = {
  kind: "requestfailed"
  url: string
  method: string
  error: string
}

type BadNet = BadHttp | RequestFailed

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

function wosCookies(seal: string) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7
  const n = WORKOS_SESSION_COOKIE_NAME
  return [
    { name: n, value: seal, domain: "127.0.0.1", path: "/", expires: exp, httpOnly: true, secure: false, sameSite: "Lax" as const },
    { name: n, value: seal, domain: "localhost", path: "/", expires: exp, httpOnly: true, secure: false, sameSite: "Lax" as const },
  ]
}

function wire(
  p: Page,
  cons: Row[],
  perr: string[],
  badNet: BadNet[],
  inFlight: Promise<void>[],
) {
  p.on("console", (m: ConsoleMessage) => {
    const u = m.location()
    const loc = u ? `${u.url ?? ""}:${u.lineNumber}` : undefined
    cons.push({ type: m.type(), text: m.text(), location: loc })
  })
  p.on("pageerror", (e) => perr.push(e instanceof Error ? e.stack ?? e.message : String(e)))

  p.on("requestfailed", (req) => {
    const f = req.failure()
    badNet.push({
      kind: "requestfailed",
      url: req.url(),
      method: req.method(),
      error: f?.errorText ?? "unknown failure",
    })
  })

  p.on("response", (res) => {
    if (res.status() < 400) return
    inFlight.push(
      (async () => {
        const request = res.request()
        const url = res.url()
        const method = request.method()
        const status = res.status()
        const statusText = res.statusText()
        const contentType = res.headers()["content-type"] ?? ""
        let body = ""
        let truncated = false
        try {
          const t = await res.text()
          if (t.length > maxBody) {
            body = t.slice(0, maxBody)
            truncated = true
          } else {
            body = t
          }
        } catch {
          body = "(could not read response body)"
        }
        badNet.push({
          kind: "response",
          url,
          method,
          status,
          statusText,
          contentType,
          body,
          bodyTruncated: truncated,
        })
      })(),
    )
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function run() {
  const seal = await getSeal()
  const browser = await chromium.launch({ headless: !headed })
  const context = await browser.newContext()
  await context.addCookies(wosCookies(seal))
  const page = await context.newPage()
  const cons: Row[] = []
  const perr: string[] = []
  const badNet: BadNet[] = []
  const inFlight: Promise<void>[] = []
  wire(page, cons, perr, badNet, inFlight)
  await page.goto(base, { waitUntil: "load", timeout: 90_000 })
  await sleep(settleMs)
  await Promise.allSettled(inFlight)
  await sleep(300)
  await Promise.allSettled(inFlight)
  await page.close()
  await browser.close()

  const errCons = cons.filter((c) => c.type === "error" || c.type === "assert")
  const httpBad = badNet.filter((b): b is BadHttp => b.kind === "response")
  const netFailed = badNet.filter((b): b is RequestFailed => b.kind === "requestfailed")
  const report = {
    url: base,
    settleMs,
    pageErrors: perr,
    consoleErrors: errCons,
    consoleAll: cons,
    httpErrors: httpBad,
    requestFailed: netFailed,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)

  const hasBadHttp = failOnBadHttp && (httpBad.length > 0 || netFailed.length > 0)
  if (perr.length > 0 || errCons.length > 0 || hasBadHttp) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
