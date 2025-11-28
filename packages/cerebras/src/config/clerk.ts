/**
 * Clerk configuration for Cerebras
 *
 * Load Clerk API keys from environment or config file
 */

export interface ClerkConfig {
  publishableKey: string
  secretKey: string
  frontendApi?: string
}

export class ClerkConfigManager {
  /**
   * Get Clerk configuration from environment variables
   */
  static getConfig(): ClerkConfig {
    const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
    const secretKey = process.env.CLERK_SECRET_KEY

    if (!publishableKey || !secretKey) {
      throw new Error(
        'Clerk configuration missing. Please set CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY environment variables.'
      )
    }

    return {
      publishableKey,
      secretKey,
      frontendApi: process.env.CLERK_FRONTEND_API,
    }
  }

  /**
   * Check if Clerk is configured
   */
  static isConfigured(): boolean {
    return !!(
      (process.env.CLERK_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
      process.env.CLERK_SECRET_KEY
    )
  }

  /**
   * Get configuration with fallback defaults (for development)
   */
  static getConfigOrDefault(): ClerkConfig | null {
    try {
      return this.getConfig()
    } catch {
      return null
    }
  }
}
