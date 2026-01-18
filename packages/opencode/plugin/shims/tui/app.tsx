/**
 * Shim for @/cli/cmd/tui/app
 *
 * This wraps the upstream TUI app to inject shell-mode providers
 * without modifying the original upstream file.
 *
 * The "original:" prefix tells the shim plugin to resolve to the
 * actual upstream file, bypassing the shim redirect.
 */

// Import everything from the original module
// The "original:" prefix bypasses the shim plugin
export * from "original:@/cli/cmd/tui/app"

// Import the original tui function to wrap it
import { tui as originalTui } from "original:@/cli/cmd/tui/app"

// Import our shell-mode providers
import { ExecutionModeProvider, WorkingDirProvider } from "@tui-integration"

// Re-export a wrapped version of the tui function that adds our providers
// Note: The actual implementation requires modifying the JSX tree, which
// can't be done externally. See the alternative approach below.

/**
 * ALTERNATIVE APPROACH: Monkey-patch at runtime
 *
 * Since we can't easily inject JSX children into the provider tree,
 * the cleaner solution is to use a different strategy:
 *
 * Option 1: Use onLoad to transform the source code
 * Option 2: Export providers and have upstream check for them
 * Option 3: Create a complete replacement file
 *
 * For this example, we'll demonstrate Option 1 in the plugin.
 */

// For now, just re-export the original
export { originalTui as tui }
