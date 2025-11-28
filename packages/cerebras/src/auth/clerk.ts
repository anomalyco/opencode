/**
 * Clerk Authentication Provider for Cerebras
 *
 * Implements device authorization flow for CLI authentication
 */

import { createClerkClient } from '@clerk/backend'
import * as prompts from "@clack/prompts"
import { UI } from "../cli/ui"
import open from "open"

export interface ClerkConfig {
  publishableKey: string
  secretKey: string
  frontendApi?: string
}

export interface DeviceAuthResponse {
  deviceCode: string
  userCode: string
  verificationUrl: string
  verificationUrlComplete: string
  expiresIn: number
  interval: number
}

export interface ClerkSession {
  userId: string
  sessionId: string
  sessionToken: string
  expiresAt: number
}

export class ClerkAuthProvider {
  private client: ReturnType<typeof createClerkClient>
  private config: ClerkConfig

  constructor(config: ClerkConfig) {
    this.config = config
    this.client = createClerkClient({
      secretKey: config.secretKey,
      publishableKey: config.publishableKey,
    })
  }

  /**
   * Start device authorization flow
   * Returns verification URL and user code for user to complete auth
   */
  async startDeviceFlow(): Promise<DeviceAuthResponse> {
    // For Clerk, we'll use a simpler approach with PKCE flow
    // Since Clerk doesn't have built-in device flow, we'll implement a custom one

    // Generate a random device code
    const deviceCode = this.generateCode(32)
    const userCode = this.generateUserCode()

    // In production, you'd send this to your backend
    // For now, we'll use Clerk's sign-in URL
    const verificationUrl = `${this.getClerkFrontendUrl()}/sign-in`

    return {
      deviceCode,
      userCode,
      verificationUrl,
      verificationUrlComplete: `${verificationUrl}?device_code=${deviceCode}`,
      expiresIn: 900, // 15 minutes
      interval: 5, // Poll every 5 seconds
    }
  }

  /**
   * Poll for device authorization completion
   */
  async pollDeviceAuth(deviceCode: string): Promise<ClerkSession | null> {
    // This would typically call your backend endpoint
    // that checks if the user completed the auth flow

    // For now, returning null to indicate pending
    // You'll need to implement backend polling endpoint
    return null
  }

  /**
   * Verify a session token
   */
  async verifySession(sessionToken: string): Promise<boolean> {
    try {
      const session = await this.client.sessions.verifySession(sessionToken, sessionToken)
      return session.status === 'active'
    } catch (error) {
      return false
    }
  }

  /**
   * Get user information from session
   */
  async getUser(userId: string) {
    try {
      return await this.client.users.getUser(userId)
    } catch (error) {
      return null
    }
  }

  /**
   * Interactive login flow for CLI
   */
  async interactiveLogin(): Promise<ClerkSession | null> {
    UI.empty()
    prompts.intro("Login to Cerebras")

    const auth = await this.startDeviceFlow()

    prompts.log.info("To authenticate, visit:")
    prompts.log.message(`\n  ${UI.Style.TEXT_BOLD}${auth.verificationUrlComplete}\n`)
    prompts.log.info(`Or enter code: ${UI.Style.TEXT_BOLD}${auth.userCode}`)

    // Ask if they want to open browser
    const shouldOpen = await prompts.confirm({
      message: "Open browser now?",
      initialValue: true,
    })

    if (prompts.isCancel(shouldOpen)) {
      throw new UI.CancelledError()
    }

    if (shouldOpen) {
      await open(auth.verificationUrlComplete)
      prompts.log.success("Browser opened")
    }

    // Start polling
    const spinner = prompts.spinner()
    spinner.start("Waiting for authentication...")

    const maxAttempts = Math.floor(auth.expiresIn / auth.interval)
    let attempts = 0

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, auth.interval * 1000))

      const session = await this.pollDeviceAuth(auth.deviceCode)

      if (session) {
        spinner.stop("Authentication successful!")
        return session
      }

      attempts++
    }

    spinner.stop("Authentication timed out", 1)
    return null
  }

  /**
   * Generate a random code
   */
  private generateCode(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let result = ''
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    return result
  }

  /**
   * Generate a user-friendly code (e.g., ABCD-EFGH)
   */
  private generateUserCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    const parts = []
    for (let i = 0; i < 2; i++) {
      let part = ''
      for (let j = 0; j < 4; j++) {
        part += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      parts.push(part)
    }
    return parts.join('-')
  }

  /**
   * Get Clerk frontend URL from publishable key
   */
  private getClerkFrontendUrl(): string {
    // Use configured frontend API URL if provided
    if (this.config.frontendApi) {
      return this.config.frontendApi
    }

    // Extract the frontend API from publishable key
    // Format: pk_test_xxx or pk_live_xxx
    const match = this.config.publishableKey.match(/^pk_(test|live)_(.+)$/)
    if (!match) {
      throw new Error('Invalid Clerk publishable key')
    }

    const [, env, subdomain] = match

    // Use Clerk's default hosted pages
    // Format: https://[subdomain].accounts.dev (for test) or https://accounts.[domain].com (for live)
    return `https://${subdomain}.accounts.dev`
  }
}
