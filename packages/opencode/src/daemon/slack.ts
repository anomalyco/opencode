import { EventEmitter } from "events"

export interface SlackDaemonConfig {
  enabled: boolean
  appToken?: string // xapp-... for Socket Mode
  botToken?: string // xoxb-... for Slack Bot API
  defaultChannel?: string
  allowedUsers?: string[]
}

export interface SlackMessageEvent {
  channelId: string
  threadTs?: string
  userId: string
  text: string
}

export class SlackDaemon extends EventEmitter {
  private config: SlackDaemonConfig
  private isRunning = false
  private ws: WebSocket | null = null

  constructor(config: SlackDaemonConfig) {
    super()
    this.config = config
  }

  public get active(): boolean {
    return this.isRunning
  }

  public async start(): Promise<boolean> {
    if (!this.config.enabled || !this.config.appToken || !this.config.botToken) {
      return false
    }

    if (this.isRunning) return true
    this.isRunning = true

    try {
      // Connect to Slack via Socket Mode WSS URL
      const response = await fetch("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.appToken}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      })

      const data = (await response.json()) as { ok: boolean; url?: string; error?: string }
      if (!data.ok || !data.url) {
        this.emit("error", new Error(`Failed to open Slack Socket Mode connection: ${data.error}`))
        this.isRunning = false
        return false
      }

      this.ws = new WebSocket(data.url)

      this.ws.onopen = () => {
        this.emit("connected")
      }

      this.ws.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data.toString())
          // Acknowledge event immediately to Slack
          if (payload.envelope_id && this.ws) {
            this.ws.send(JSON.stringify({ envelope_id: payload.envelope_id }))
          }

          if (payload.type === "events_api" && payload.payload?.event) {
            const ev = payload.payload.event
            // Filter out bot's own messages
            if (ev.type === "app_mention" || (ev.type === "message" && !ev.bot_id && ev.channel_type === "im")) {
              const msg: SlackMessageEvent = {
                channelId: ev.channel,
                threadTs: ev.thread_ts ?? ev.ts,
                userId: ev.user,
                text: ev.text.replace(/<@[A-Z0-9]+>/g, "").trim(),
              }
              this.emit("command", msg)
            }
          }
        } catch (err) {
          this.emit("error", err)
        }
      }

      this.ws.onclose = () => {
        this.isRunning = false
        this.emit("disconnected")
      }

      return true
    } catch (err) {
      this.isRunning = false
      this.emit("error", err)
      return false
    }
  }

  public async postReply(channelId: string, threadTs: string | undefined, markdownText: string): Promise<boolean> {
    if (!this.config.botToken) return false

    try {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId,
          thread_ts: threadTs,
          text: markdownText,
          mrkdwn: true,
        }),
      })

      const json = (await res.json()) as { ok: boolean; error?: string }
      return json.ok
    } catch {
      return false
    }
  }

  public stop(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.isRunning = false
  }
}
