/**
 * Authentication middleware for Cerebras
 *
 * Checks if user is authenticated before allowing CLI commands
 */

import { CredentialStorage } from "../storage/credentials"
import { ClerkConfigManager } from "../config/clerk"
import { ClerkAuthProvider } from "../auth/clerk"
import * as prompts from "@clack/prompts"
import { UI } from "../cli/ui"

/**
 * Commands that don't require authentication
 */
const UNAUTHENTICATED_COMMANDS = ["auth", "login", "help", "version", "--help", "-h", "--version", "-v"]

/**
 * Check if command requires authentication
 */
function requiresAuth(argv: string[]): boolean {
  // If no command specified, it's the default interactive mode
  if (argv.length === 0) return true

  const command = argv[0]

  // Check if it's an unauthenticated command
  return !UNAUTHENTICATED_COMMANDS.some((cmd) => command === cmd || command.startsWith(cmd))
}

/**
 * Authentication middleware
 * Runs before command execution to verify user is authenticated
 */
export async function authMiddleware(opts: any) {
  const argv = process.argv.slice(2)

  // Skip auth check for certain commands
  if (!requiresAuth(argv)) {
    return
  }

  // Check if Clerk is configured
  if (!ClerkConfigManager.isConfigured()) {
    // In development, allow unauthenticated access with warning
    if (process.env.NODE_ENV === "development" || process.env.CEREBRAS_SKIP_AUTH === "true") {
      console.warn("⚠️  Running in unauthenticated mode (development)")
      return
    }

    UI.error("\n⛔ Clerk is not configured\n")
    prompts.log.error("Missing required environment variables:")
    prompts.log.info("  - CLERK_PUBLISHABLE_KEY")
    prompts.log.info("  - CLERK_SECRET_KEY")
    prompts.log.message("\nPlease configure Clerk to use Cerebras.")
    prompts.log.message("Visit: https://dashboard.clerk.com\n")
    process.exit(1)
  }

  // Check if user is authenticated
  const isAuthenticated = await CredentialStorage.isAuthenticated()

  if (!isAuthenticated) {
    UI.empty()
    prompts.log.warn("You are not logged in")
    prompts.log.message("\nTo use Cerebras, you need to authenticate.")
    prompts.log.message(`Run: ${UI.Style.TEXT_BOLD}cerebras auth login${UI.Style.TEXT_DIM}\n`)

    const shouldLogin = await prompts.confirm({
      message: "Would you like to login now?",
      initialValue: true,
    })

    if (prompts.isCancel(shouldLogin) || !shouldLogin) {
      prompts.outro("Authentication required")
      process.exit(1)
    }

    // Start login flow
    const config = ClerkConfigManager.getConfig()
    const auth = new ClerkAuthProvider(config)

    try {
      const session = await auth.interactiveLogin()

      if (session) {
        await CredentialStorage.updateSession(session)
        prompts.outro("Login successful! Starting Cerebras...\n")
      } else {
        prompts.outro("Login failed")
        process.exit(1)
      }
    } catch (error) {
      if (error instanceof UI.CancelledError) {
        prompts.outro("Login cancelled")
      } else {
        prompts.log.error("Login failed: " + (error instanceof Error ? error.message : String(error)))
      }
      process.exit(1)
    }
  }

  // Verify session is still valid
  const session = await CredentialStorage.getSession()
  if (session) {
    const config = ClerkConfigManager.getConfig()
    const auth = new ClerkAuthProvider(config)

    const isValid = await auth.verifySession(session.sessionToken)

    if (!isValid) {
      UI.empty()
      prompts.log.warn("Your session has expired")
      await CredentialStorage.clear()

      prompts.log.message(`\nPlease login again: ${UI.Style.TEXT_BOLD}cerebras auth login${UI.Style.TEXT_DIM}\n`)
      process.exit(1)
    }
  }
}
