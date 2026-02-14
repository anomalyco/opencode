import type { Plugin } from "@opencode-ai/plugin"

/**
 * Example plugin that demonstrates the tui.input.changed hook
 *
 * This plugin listens to user input changes and can be used to:
 * - Pause notifications while user is typing
 * - Implement real-time input suggestions
 * - Track typing analytics
 * - Detect user intent
 */
export const InputNotificationPlugin: Plugin = async ({ client }) => {
  return {
    // Listen to all events (alternative approach)
    event: async ({ event }) => {
      if (event.type === "tui.input.changed") {
        const { sessionID, text } = event.properties as { sessionID: string; text: string }
        console.log(`[InputNotificationPlugin] User typing in session ${sessionID}: "${text}"`)

        // Your logic here:
        // - Pause notifications
        // - Show typing indicator
        // - etc.
      }
    },

    // Use the dedicated hook (recommended)
    "tui.input.changed": async (input, output) => {
      const { sessionID, text } = input

      console.log(`[InputNotificationPlugin] Hook triggered:`)
      console.log(`  Session: ${sessionID}`)
      console.log(`  Text: "${text}"`)
      console.log(`  Length: ${text.length} chars`)

      // Example: Pause notifications when user is actively typing
      if (text.length > 0) {
        // pauseNotifications()
        console.log("  -> Notifications paused (user is typing)")
      }

      // Example: Resume when input is cleared
      if (text.length === 0) {
        // resumeNotifications()
        console.log("  -> Notifications resumed (input cleared)")
      }
    },
  }
}
