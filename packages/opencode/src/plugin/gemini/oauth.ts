import { generatePKCE } from "@openauthjs/openauth/pkce"

import { GEMINI_CLIENT_ID, GEMINI_CLIENT_SECRET, GEMINI_REDIRECT_URI, GEMINI_SCOPES } from "./constants"

interface PkcePair {
  challenge: string
  verifier: string
}

interface GeminiAuthState {
  verifier: string
}

export interface GeminiAuthorization {
  url: string
  verifier: string
}

interface GeminiTokenExchangeSuccess {
  type: "success"
  refresh: string
  access: string
  expires: number
}

interface GeminiTokenExchangeFailure {
  type: "failed"
  error: string
}

export type GeminiTokenExchangeResult = GeminiTokenExchangeSuccess | GeminiTokenExchangeFailure

interface GeminiTokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
}


function encodeState(payload: GeminiAuthState): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")
}

function decodeState(state: string): GeminiAuthState {
  const normalized = state.replace(/-/g, "+").replace(/_/g, "/")
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=")
  const json = Buffer.from(padded, "base64").toString("utf8")
  const parsed = JSON.parse(json)
  if (typeof parsed.verifier !== "string") {
    throw new Error("Missing PKCE verifier in state")
  }
  return {
    verifier: parsed.verifier,
  }
}

export async function authorizeGemini(): Promise<GeminiAuthorization> {
  const pkce = (await generatePKCE()) as PkcePair

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
  url.searchParams.set("client_id", GEMINI_CLIENT_ID)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", GEMINI_REDIRECT_URI)
  url.searchParams.set("scope", GEMINI_SCOPES.join(" "))
  url.searchParams.set("code_challenge", pkce.challenge)
  url.searchParams.set("code_challenge_method", "S256")
  url.searchParams.set("state", encodeState({ verifier: pkce.verifier }))
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")

  return {
    url: url.toString(),
    verifier: pkce.verifier,
  }
}

export async function exchangeGemini(code: string, state: string): Promise<GeminiTokenExchangeResult> {
  try {
    const { verifier } = decodeState(state)

    return await exchangeGeminiWithVerifierInternal(code, verifier)
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

export async function exchangeGeminiWithVerifier(
  code: string,
  verifier: string,
): Promise<GeminiTokenExchangeResult> {
  try {
    return await exchangeGeminiWithVerifierInternal(code, verifier)
  } catch (error) {
    return {
      type: "failed",
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

async function exchangeGeminiWithVerifierInternal(
  code: string,
  verifier: string,
): Promise<GeminiTokenExchangeResult> {
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: GEMINI_REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text()
    return { type: "failed", error: errorText }
  }

  const tokenPayload = (await tokenResponse.json()) as GeminiTokenResponse

  const refreshToken = tokenPayload.refresh_token
  if (!refreshToken) {
    return { type: "failed", error: "Missing refresh token in response" }
  }

  return {
    type: "success",
    refresh: refreshToken,
    access: tokenPayload.access_token,
    expires: Date.now() + tokenPayload.expires_in * 1000,
  }
}
