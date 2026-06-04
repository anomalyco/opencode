import type { Channel } from "./contracts/channel"
import { DiscordChannel } from "./transports/discord-plugin"
import { SlackChannel } from "./transports/slack-plugin"
import { TelegramChannel } from "./transports/telegram-plugin"
import { TeamsChannel } from "./transports/teams-plugin"
import { EmailChannel } from "./transports/email-plugin"
import { WhatsAppChannel } from "./transports/whatsapp-plugin"

// ---------------------------------------------------------------------------
// Channel plugin registry — maps type strings to their constructors.
// Each entry defines how to instantiate a Channel from a config object.
// ---------------------------------------------------------------------------

export interface ChannelPluginDefinition {
  readonly create: (id: string, name: string, config: Record<string, unknown>) => Channel
  readonly description: string
}

export const channelPlugins: ReadonlyMap<string, ChannelPluginDefinition> = new Map([
  [
    "discord",
    {
      create: (id, name, config) =>
        new DiscordChannel(id, name, {
          botToken: config.botToken as string,
          gatewayEnabled: config.gatewayEnabled as boolean | undefined,
        }),
      description: "Discord bot via REST API + optional Gateway WebSocket",
    },
  ],
  [
    "slack",
    {
      create: (id, name, config) =>
        new SlackChannel(id, name, {
          botToken: config.botToken as string,
          appToken: config.appToken as string | undefined,
          signingSecret: config.signingSecret as string | undefined,
        }),
      description: "Slack bot via Web API (Bot User OAuth Token)",
    },
  ],
  [
    "telegram",
    {
      create: (id, name, config) =>
        new TelegramChannel(id, name, {
          botToken: config.botToken as string,
          parseMode: config.parseMode as "MarkdownV2" | "HTML" | undefined,
          pollingEnabled: config.pollingEnabled as boolean | undefined,
        }),
      description: "Telegram bot via Bot API with optional long polling",
    },
  ],
  [
    "teams",
    {
      create: (id, name, config) =>
        new TeamsChannel(id, name, {
          webhookUrl: config.webhookUrl as string,
          tenantId: config.tenantId as string | undefined,
          appId: config.appId as string | undefined,
          appPassword: config.appPassword as string | undefined,
        }),
      description: "Microsoft Teams via Incoming Webhook (Adaptive Cards)",
    },
  ],
  [
    "email",
    {
      create: (id, name, config) =>
        new EmailChannel(id, name, {
          smtpHost: config.smtpHost as string,
          smtpPort: config.smtpPort as number,
          smtpSecure: config.smtpSecure as boolean | undefined,
          smtpUser: config.smtpUser as string | undefined,
          smtpPass: config.smtpPass as string | undefined,
          fromAddress: config.fromAddress as string,
          fromName: config.fromName as string | undefined,
        }),
      description: "Email via SMTP (nodemailer)",
    },
  ],
  [
    "whatsapp",
    {
      create: (id, name, config) =>
        new WhatsAppChannel(id, name, {
          phoneNumberId: config.phoneNumberId as string,
          accessToken: config.accessToken as string,
          graphApiVersion: config.graphApiVersion as string | undefined,
        }),
      description: "WhatsApp Business via Cloud API",
    },
  ],
])

/**
 * Get a channel plugin definition by type string.
 * Returns undefined if no plugin is registered for the given type.
 */
export function getChannelPlugin(type: string): ChannelPluginDefinition | undefined {
  return channelPlugins.get(type)
}

/**
 * List all registered channel type strings.
 */
export function getRegisteredTypes(): ReadonlyArray<string> {
  return Array.from(channelPlugins.keys())
}
