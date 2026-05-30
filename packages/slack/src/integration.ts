import { App } from "@slack/bolt"
import type { OpencodeClient, ToolPart } from "@opencode-ai/sdk"

export interface Integration {
  readonly name: string
  start(client: OpencodeClient, bus?: unknown): Promise<void>
  stop(): Promise<void>
}

export interface IntegrationConfig {
  enabled: boolean
  [key: string]: unknown
}

export function createSlackIntegration(config: IntegrationConfig): Integration {
  const token = config.token as string
  const signingSecret = config.signingSecret as string
  const appToken = config.appToken as string
  let app: App | undefined
  let unsubBus: (() => void) | undefined

  type Session = { client: OpencodeClient; sessionId: string; channel: string; thread: string }
  const sessions = new Map<string, Session>()

  async function handleToolUpdate(part: ToolPart, channel: string, thread: string) {
    if (part.state.status !== "completed") return
    const toolMessage = `*${part.tool}* - ${part.state.title}`
    await app?.client.chat
      .postMessage({ channel, thread_ts: thread, text: toolMessage })
      .catch(() => {})
  }

  return {
    name: "slack",
    async start(client, bus) {
      if (!token || !signingSecret || !appToken) {
        throw new Error("Slack integration requires token, signingSecret, and appToken")
      }

      app = new App({ token, signingSecret, socketMode: true, appToken })

      // Event subscription — use in-process bus when available, fall back to SSE
      if (bus) {
        unsubBus = (bus as any).subscribeAllCallback((event: any) => {
          if (event.type === "message.part.updated") {
            const part = event.properties.part as ToolPart
            if (part.type === "tool") {
              for (const [_sessionKey, session] of sessions.entries()) {
                if (session.sessionId === part.sessionID) {
                  void handleToolUpdate(part, session.channel, session.thread)
                  break
                }
              }
            }
          }
        })
      } else {
        void (async () => {
          const events = await client.event.subscribe()
          for await (const event of events.stream) {
            if (event.type === "message.part.updated") {
              const part = event.properties.part as ToolPart
              if (part.type === "tool") {
                for (const [_sessionKey, session] of sessions.entries()) {
                  if (session.sessionId === part.sessionID) {
                    void handleToolUpdate(part, session.channel, session.thread)
                    break
                  }
                }
              }
            }
          }
        })()
      }

      // Debug middleware
      app.use(async ({ next, context }) => {
        console.log("📡 Raw Slack event:", JSON.stringify(context, null, 2))
        await next()
      })

      // Message handler
      app.message(async ({ message, say }) => {
        if (message.subtype || !("text" in message) || !message.text) return

        const channel = message.channel
        const thread = (message as any).thread_ts || message.ts
        const sessionKey = `${channel}-${thread}`

        let session = sessions.get(sessionKey)

        if (!session) {
          const createResult = await client.session.create({
            body: { title: `Slack thread ${thread}` },
          })

          if (createResult.error) {
            await say({
              text: "Sorry, I had trouble creating a session. Please try again.",
              thread_ts: thread,
            })
            return
          }

          session = { client, sessionId: createResult.data.id, channel, thread }
          sessions.set(sessionKey, session)

          const shareResult = await client.session.share({ path: { id: createResult.data.id } })
          if (!shareResult.error && shareResult.data) {
            const sessionUrl = shareResult.data.share?.url
            if (sessionUrl) {
              await app!.client.chat.postMessage({ channel, thread_ts: thread, text: sessionUrl })
            }
          }
        }

        const result = await session.client.session.prompt({
          path: { id: session.sessionId },
          body: { parts: [{ type: "text", text: message.text }] },
        })

        if (result.error) {
          await say({
            text: "Sorry, I had trouble processing your message. Please try again.",
            thread_ts: thread,
          })
          return
        }

        const response = result.data as any
        const responseText =
          response.info?.content ||
          response.parts
            ?.filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n") ||
          "I received your message but didn't have a response."

        await say({ text: responseText, thread_ts: thread })
      })

      // /test command
      app.command("/test", async ({ ack, say }) => {
        await ack()
        await say("🤖 Bot is working! I can hear you loud and clear.")
      })

      await app.start()
      console.log("⚡️ Slack integration started")
    },
    async stop() {
      unsubBus?.()
      await app?.stop()
      app = undefined
      sessions.clear()
      console.log("🛑 Slack integration stopped")
    },
  }
}
