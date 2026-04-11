/**
 * Auth orchestration for webfetch — Layer 2.
 *
 * Handles the full OAuth flow when webfetch encounters a 401/403:
 *
 * Flow: 401/403 -> parse WWW-Authenticate (RFC 9110 §11.6.1)
 *       -> discover resource metadata (RFC 9728)
 *       -> discover AS metadata (RFC 8414)
 *       -> dynamic client registration (RFC 7591) or use stored client
 *       -> OAuth authorization code + PKCE (RFC 7636) or device code (RFC 8628)
 *       -> retry request with credentials
 *
 * @see https://www.rfc-editor.org/rfc/rfc9110.html#section-11.6.1
 * @see https://www.rfc-editor.org/rfc/rfc9728.html
 */

import { Log } from "../util/log"
import { lookup, headers, type CredentialStore, type Credential } from "./webfetch-auth"
import * as WwwAuthenticate from "./www-authenticate"
import * as Discovery from "./discovery"
import * as Flow from "./flow"
import type { Interaction, CallbackServer, ClientRegistration } from "./flow"

function credential(resource: string, tokens: Flow.TokenResult, issuer: string): Credential {
  return {
    resource,
    scheme: "bearer",
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_in ? Date.now() / 1000 + tokens.expires_in : undefined,
    scope: tokens.scope,
    oauth_client_id: tokens.client.client_id,
    oauth_client_secret: tokens.client.client_secret,
    issuer,
  }
}

/**
 * Handle an auth challenge (401/403) by running the full interactive OAuth flow.
 *
 * This is Layer 2: discovery, consent, browser auth or device code, token
 * exchange, credential storage, retry. The consumer calls this explicitly
 * when they decide to handle an auth challenge.
 */
export async function handleAuthChallenge(options: {
  response: Response
  url: string
  baseHeaders: Record<string, string>
  signal: AbortSignal
  store: CredentialStore
  interaction: Interaction
  callbackServer?: CallbackServer
  client?: ClientRegistration
  logger?: Log.Logger
  preferDevice?: boolean
}): Promise<Response | undefined> {
  const log = options.logger ?? Log.create({ service: "webfetch-auth" })
  log.info("auth required", { url: options.url, status: options.response.status })

  // 1. Parse WWW-Authenticate challenges — RFC 9110 §11.6.1
  //    Extract resource_metadata URL from Bearer challenge — RFC 9728 §5.1
  const challenges = WwwAuthenticate.all(options.response)
  const metaUrl = WwwAuthenticate.resourceMetadataUrl(challenges)

  // 2. Discovery — RFC 9728 §4 (resource metadata) + RFC 8414 §3 (AS metadata)
  const result = await Discovery.discover(options.url, metaUrl ?? undefined, options.signal, log)

  if (!result.resource || !result.servers.length) {
    // Basic auth challenge without discovery — RFC 7617
    const basic = challenges.find((c) => c.scheme.toLowerCase() === "basic")
    if (basic) {
      log.info("basic auth challenge detected", { realm: basic.params["realm"] })
      throw new Error(
        `This URL requires Basic authentication (realm: ${basic.params["realm"] ?? "unknown"}). ` +
          `Configure credentials for this origin in the credential store.`,
      )
    }

    log.info("no auth discovery available", { url: options.url, challenges: challenges.length })
    return undefined
  }

  const registration = options.client ?? { name: "OAuth Client" }
  let last: Error | undefined

  for (const server of result.servers) {
    // 3. Client resolution — RFC 7591 §2 (dynamic registration) or stored credentials.
    //    Registration is NOT done here for auth code flow — it is deferred to
    //    authorizationCode() which registers after the callback server binds,
    //    ensuring the redirect_uri port matches the actual listening port.
    let resolved: Flow.ClientInfo | undefined

    if (options.client?.clientId) {
      resolved = { client_id: options.client.clientId, client_secret: options.client.clientSecret }
    }

    if (!resolved) {
      const existing = await lookup(options.url, options.store).catch(() => undefined)
      if (existing?.oauth_client_id && (!existing.issuer || existing.issuer === server.issuer)) {
        resolved = { client_id: existing.oauth_client_id, client_secret: existing.oauth_client_secret }
      }
    }

    await options.interaction.askConsent({
      resource: options.url,
      server: server.issuer,
      scopes: result.resource.scopes_supported,
    })

    const supports = server.grant_types_supported ?? ["authorization_code"]
    const device = supports.includes("urn:ietf:params:oauth:grant-type:device_code") && !!server.device_authorization_endpoint
    const canRegister = !!server.registration_endpoint && !!options.callbackServer
    let cred: Credential | undefined
    let authError: Error | undefined

    if (options.preferDevice && !device) {
      last = new Error(
        `This URL requires browser-based OAuth via ${server.issuer}, ` +
          `but this environment only supports device authorization.`,
      )
      continue
    }

    if (!options.preferDevice && supports.includes("authorization_code") && server.authorization_endpoint && options.callbackServer) {
      const tokens = await Flow.authorizationCode(
        options.url,
        result.resource,
        server,
        resolved,
        result.resource.scopes_supported,
        {
          server: options.callbackServer,
          interaction: options.interaction,
          registration,
          logger: log,
          signal: options.signal,
        },
      ).catch((err) => {
        authError = err instanceof Error ? err : new Error(String(err))
        return undefined
      })
      if (tokens) {
        cred = credential(result.resource.resource, tokens, server.issuer)
        await options.store.set(result.resource.resource, cred)
      }
    }

    if (!cred && device) {
      if (!resolved && server.registration_endpoint && options.callbackServer) {
        try {
          const { redirectUri } = await options.callbackServer.start()
          resolved = (await Flow.register(server, redirectUri, registration, log, options.signal)) ?? undefined
          await options.callbackServer.stop()
        } catch {
          // If callback server fails, can't register
        }
      }
      if (resolved) {
        const device = await Flow.deviceCode(
          options.url,
          result.resource,
          server,
          resolved,
          result.resource.scopes_supported,
          log,
          options.signal,
        )
        if (device) {
          await options.interaction.showDeviceCode(device.info)
          const tokens = await device.poll()
          if (tokens) {
            cred = credential(result.resource.resource, tokens, server.issuer)
            await options.store.set(result.resource.resource, cred)
          }
        }
      }
    }

    if (!cred) {
      if (authError) {
        last = authError
        continue
      }
      if (!resolved && !canRegister) {
        const docs = server.service_documentation ?? server.issuer
        last = new Error(
          `This URL requires OAuth authentication via ${server.issuer}, ` +
            `but no client_id is configured and dynamic registration is not available. ` +
            `Register a client at ${docs} and configure a client_id.`,
        )
        continue
      }
      last = new Error(`OAuth authentication failed for ${options.url} via ${server.issuer}. Please try again.`)
      continue
    }

    // 6. Retry with credentials — RFC 6750 §2.1 (Bearer in Authorization header)
    // redirect: "error" prevents the Bearer token from being forwarded to a
    // redirect target, potentially on a different origin. If the server
    // returns a 3xx, the token must not leak to the redirect destination.
    const auth = headers(cred, log)
    const retry = await fetch(options.url, {
      signal: options.signal,
      redirect: "error",
      headers: { ...options.baseHeaders, ...auth },
    }).catch(() => undefined)

    if (retry?.ok) return retry

    log.error("auth retry failed, removing stale credential", {
      url: options.url,
      issuer: server.issuer,
      status: retry?.status,
    })
    await options.store.remove(result.resource.resource).catch(() => {})
    last = new Error(`OAuth authentication succeeded but retry failed for ${options.url} via ${server.issuer}.`)
  }

  if (last) throw last
  return undefined
}
