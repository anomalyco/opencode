import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Effect } from "effect"

export function refreshOAuth(endpoint: string, methodID: Integration.MethodID, credential: Credential.OAuth) {
  return Effect.tryPromise(async () => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh: credential.refresh }),
    })
    const body = await response.json()
    if (!response.ok || typeof body !== "object" || body === null) throw new Error("OAuth refresh failed")
    if (!("access" in body) || typeof body.access !== "string") throw new Error("OAuth access token missing")
    if (!("refresh" in body) || typeof body.refresh !== "string") throw new Error("OAuth refresh token missing")
    if (!("expires" in body) || typeof body.expires !== "number") throw new Error("OAuth expiry missing")
    return Credential.OAuth.make({
      type: "oauth",
      methodID,
      access: body.access,
      refresh: body.refresh,
      expires: body.expires,
    })
  })
}
