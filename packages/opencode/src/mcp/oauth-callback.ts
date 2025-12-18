import { OAuthCallback } from "../oauth/callback"
import { OAUTH_CALLBACK_PATH, OAUTH_CALLBACK_PORT } from "./oauth-provider"

export namespace McpOAuthCallback {
  export async function ensureRunning(): Promise<void> {
    await OAuthCallback.ensureRunning({ port: OAUTH_CALLBACK_PORT, pathname: OAUTH_CALLBACK_PATH })
  }

  export function waitForCallback(key: string): Promise<string> {
    return OAuthCallback.waitForCallback({ port: OAUTH_CALLBACK_PORT, pathname: OAUTH_CALLBACK_PATH, key })
  }

  export function cancelPending(key: string): void {
    OAuthCallback.cancelPending({ port: OAUTH_CALLBACK_PORT, pathname: OAUTH_CALLBACK_PATH, key })
  }

  export async function stop(): Promise<void> {
    await OAuthCallback.stop({ port: OAUTH_CALLBACK_PORT, pathname: OAUTH_CALLBACK_PATH })
  }
}
