import { resolveToken } from "../config/integration.js"
import type { IntegrationManager } from "./manager.js"
import type { Integrations } from "../config/integration.js"

export async function bootstrapIntegrations(
  manager: IntegrationManager,
  integrations: Integrations | undefined,
): Promise<void> {
  if (!integrations) return

  // Telegram
  if (integrations.telegram?.enabled) {
    const token = integrations.telegram.token
      ? resolveToken(integrations.telegram.token)
      : process.env.TELEGRAM_BOT_TOKEN
    if (!token) {
      console.error("Telegram integration enabled but TELEGRAM_BOT_TOKEN not set")
    } else {
      try {
        // @ts-expect-error - lazy dynamic import; package may not be installed
        const { createTelegramIntegration } = await import("@opencode-ai/telegram/integration")
        manager.register(
          (cfg) => createTelegramIntegration(cfg),
          { enabled: true, token, directory: integrations.telegram.directory },
        )
      } catch (error) {
        console.error("Failed to load telegram integration:", error)
      }
    }
  }

  // Slack
  if (integrations.slack?.enabled) {
    const token = integrations.slack.token
      ? resolveToken(integrations.slack.token)
      : process.env.SLACK_BOT_TOKEN
    const signingSecret = integrations.slack.signingSecret
      ? resolveToken(integrations.slack.signingSecret)
      : process.env.SLACK_SIGNING_SECRET
    const appToken = integrations.slack.appToken
      ? resolveToken(integrations.slack.appToken)
      : process.env.SLACK_APP_TOKEN
    if (!token || !signingSecret || !appToken) {
      console.error("Slack integration enabled but required env vars not set")
    } else {
      try {
        // @ts-expect-error - lazy dynamic import; package may not be installed
        const { createSlackIntegration } = await import("@opencode-ai/slack/integration")
        manager.register(
          (cfg) => createSlackIntegration(cfg),
          { enabled: true, token, signingSecret, appToken },
        )
      } catch (error) {
        console.error("Failed to load slack integration:", error)
      }
    }
  }
}
