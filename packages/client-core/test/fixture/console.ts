import { Effect } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

export const server = "https://console.test/console"

/**
 * An in-process OpenCode Console with the device sign-in, refresh, revoke and config endpoints the connector calls.
 * Like the real Console, a refresh token works once: reusing one answers `invalid_grant`.
 */
export function fakeConsole(
  input: {
    config?: () => Response | Promise<Response>
    revoke?: () => Response | undefined
    /** Where the Console is reachable; device approval links point here. */
    server?: string
  } = {},
) {
  const base = input.server ?? server
  const state = {
    access: "access-1",
    refresh: "refresh-1",
    expiresIn: 3600,
    refreshes: 0,
    configs: 0,
    revoked: [] as string[],
    requests: [] as Request[],
    config: input.config ?? (() => Response.json({})),
  }
  const issue = (orgID: string) => {
    const generation = state.refreshes + 1
    state.access = `access-${generation}`
    state.refresh = `refresh-${generation}`
    return Response.json({
      access_token: state.access,
      refresh_token: state.refresh,
      token_type: "Bearer",
      expires_in: state.expiresIn,
      org_id: orgID,
    })
  }
  const handle = async (request: Request): Promise<Response> => {
    state.requests.push(request.clone())
    const path = new URL(request.url).pathname.replace(/^\/console/, "")
    if (path === "/auth/device/code")
      return Response.json({
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_uri_complete: `${base}/device?user_code=ABCD-EFGH`,
        expires_in: 600,
        interval: 0,
      })
    if (path === "/auth/device/token") {
      const body = await request.json()
      if (body.grant_type !== "refresh_token") return issue("org_acme")
      // Hold the refresh briefly so concurrent callers overlap, as they would across processes.
      await Bun.sleep(20)
      if (body.refresh_token !== state.refresh || body.client_id !== "opencode-connect")
        return Response.json({ error: "invalid_grant" }, { status: 400 })
      state.refreshes++
      return issue("org_acme")
    }
    if (path === "/api/user") return Response.json({ id: "usr_ada", email: "ada@example.com" })
    if (path === "/api/orgs") return Response.json([{ id: "org_acme", name: "Acme" }])
    if (path === "/auth/oauth/revoke") {
      const answer = input.revoke?.()
      if (answer) return answer
      state.revoked.push((await request.json()).token)
      return Response.json({})
    }
    if (path === "/api/v2/config") {
      state.configs++
      return state.config()
    }
    return new Response(null, { status: 404 })
  }
  const http = HttpClient.make((request) =>
    HttpClientRequest.toWeb(request).pipe(
      Effect.orDie,
      Effect.flatMap((web) => Effect.promise(() => handle(web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
    ),
  )
  return { state, http, fetch: handle }
}

/** A stored device sign-in for Acme whose access token expires at `expires`. */
export function signIn(state: ReturnType<typeof fakeConsole>["state"], expires: number, base = server) {
  return {
    type: "oauth" as const,
    methodID: "device",
    access: state.access,
    refresh: state.refresh,
    expires,
    metadata: { server: base, accountID: "usr_ada", email: "ada@example.com", orgID: "org_acme", orgName: "Acme" },
  }
}
