// Login gate that forces Microsoft Entra ID authentication before using the tool.
//
// Flow:
// 1. Check if MICROSOFT_LOGIN_BYPASS env var is set (admin/testing bypass)
// 2. Check if admin credentials match (OPENCODE_ADMIN_USERNAME / OPENCODE_ADMIN_PASSWORD, defaults to admin/opencode-admin)
// 3. Check if Microsoft auth already exists in the auth store
// 4. If not authenticated, run the Microsoft OAuth PKCE flow
// 5. Store the tokens and proceed
import { Effect } from "effect"
import open from "open"
import { UI } from "./ui"
import { Auth } from "@/auth"
import {
  buildAuthorizeUrl,
  extractAccountId,
  generatePKCE,
  generateState,
  startOAuthServer,
  stopOAuthServer,
  waitForOAuthCallback,
  type MicrosoftConfig,
} from "@/plugin/microsoft"

const ADMIN_DEFAULT_USERNAME = "admin"
const ADMIN_DEFAULT_PASSWORD = "opencode-admin"

// Default to the OneInfo Consulting Azure AD tenant. Mirror the values from
// packages/opencode/src/plugin/microsoft.ts so the gate is independent of
// plugin initialization. Override via env for other tenants / clients.
const DEFAULT_TENANT = "3219b5f9-900d-4608-80c8-7cd86886de3"
const DEFAULT_CLIENT_ID = "cb06d541-ed31-4195-b7ff-d2b50084da6f"
const DEFAULT_SCOPES = "openid email profile offline_access"
const DEFAULT_REDIRECT_URI = "http://127.0.0.1:53800/callback"

function resolveMicrosoftConfig(): MicrosoftConfig {
  return {
    tenant: process.env["MICROSOFT_TENANT"] ?? DEFAULT_TENANT,
    clientId: process.env["MICROSOFT_CLIENT_ID"] ?? DEFAULT_CLIENT_ID,
    scopes: process.env["MICROSOFT_SCOPES"] ?? DEFAULT_SCOPES,
    redirectUri: process.env["MICROSOFT_REDIRECT_URI"] ?? DEFAULT_REDIRECT_URI,
  }
}

function isBypassEnabled(): boolean {
  return process.env["MICROSOFT_LOGIN_BYPASS"] === "1"
}

async function checkAdminBypass(): Promise<boolean> {
  // Only offer admin bypass when we can actually prompt. In CI / non-TTY
  // contexts (and inside the OAuth callback loop) we want the user to either
  // set MICROSOFT_LOGIN_BYPASS or go through the Microsoft flow.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return false

  const expectedUser = process.env["OPENCODE_ADMIN_USERNAME"] ?? ADMIN_DEFAULT_USERNAME
  const expectedPass = process.env["OPENCODE_ADMIN_PASSWORD"] ?? ADMIN_DEFAULT_PASSWORD

  UI.println(UI.Style.TEXT_INFO + "Admin bypass" + UI.Style.TEXT_NORMAL + " (Ctrl+C to cancel)")
  let username: string
  let password: string
  try {
    username = await UI.input("Admin username: ")
    password = await UI.input("Admin password: ")
  } catch {
    return false
  }

  if (username === expectedUser && password === expectedPass) {
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "OK" + UI.Style.TEXT_NORMAL + " admin bypass accepted")
    return true
  }

  UI.error("Invalid admin credentials")
  process.exit(1)
}

const hasMicrosoftAuth = Effect.gen(function* () {
  const auth = yield* Auth.Service
  const existing = yield* auth.get("microsoft").pipe(Effect.catch(() => Effect.succeed(undefined)))
  if (!existing) return false
  if (existing.type !== "oauth") return false
  if (!existing.access || !existing.refresh) return false
  return true
})

const storeMicrosoftTokens = Effect.fn("LoginGate.storeMicrosoftTokens")(function* (tokens: {
  access_token: string
  refresh_token: string
  expires_in?: number
  id_token?: string
  accountId?: string
}) {
  const auth = yield* Auth.Service
  const accountId = tokens.accountId ?? extractAccountId({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    ...(tokens.id_token !== undefined ? { id_token: tokens.id_token } : {}),
  })
  yield* auth.set("microsoft", {
    type: "oauth",
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(accountId ? { accountId } : {}),
  })
})

async function runMicrosoftOAuth(): Promise<void> {
  const config = resolveMicrosoftConfig()
  await startOAuthServer()

  const pkce = await generatePKCE()
  const state = generateState()
  const authUrl = buildAuthorizeUrl(config.tenant, pkce, state, config.clientId, config.scopes)

  UI.println(UI.Style.TEXT_INFO_BOLD + "Microsoft Entra ID" + UI.Style.TEXT_NORMAL + " authentication required")
  UI.println("Opening browser to " + authUrl)
  void open(authUrl).catch(() => {
    UI.println(UI.Style.TEXT_WARNING + "Could not open browser automatically." + UI.Style.TEXT_NORMAL)
    UI.println("Visit: " + authUrl)
  })

  try {
    const tokens = await waitForOAuthCallback(pkce, state, config)
    await Effect.runPromise(storeMicrosoftTokens(tokens).pipe(Effect.provide(Auth.defaultLayer)))
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + "OK" + UI.Style.TEXT_NORMAL + " Microsoft authentication successful")
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    UI.error("Microsoft authentication failed: " + message)
    process.exit(1)
  } finally {
    stopOAuthServer()
  }
}

export async function enforceMicrosoftLogin(): Promise<void> {
  if (isBypassEnabled()) {
    return
  }

  if (await checkAdminBypass()) {
    return
  }

  const alreadyAuthed = await Effect.runPromise(hasMicrosoftAuth.pipe(Effect.provide(Auth.defaultLayer)))
  if (alreadyAuthed) {
    return
  }

  await runMicrosoftOAuth()
}
