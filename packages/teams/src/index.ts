import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { pathToFileURL } from "node:url"
import {
  createOpencode,
  type EventMessagePartUpdated,
  type SessionPromptResponse,
  type ToolPart,
} from "@opencode-ai/sdk"
import {
  ActivityHandler,
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TurnContext,
  type Activity,
  type ConversationReference,
  type Request,
  type Response,
} from "botbuilder"

type Session = {
  sessionId: string
  reference: Partial<ConversationReference>
}

export function conversationKey(activity: Partial<Activity>) {
  const tenant = tenantId(activity) || "unknown"
  const conversation = activity.conversation?.id || "unknown"
  return `teams:${tenant}:${conversation}`
}

export function messageText(activity: Partial<Activity>) {
  const text = TurnContext.removeRecipientMention(activity).trim()
  if (text) return text
  return activity.text?.trim() || ""
}

export function responseText(message: SessionPromptResponse) {
  const text = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n")

  if (text) return text
  return "I received your message but didn't have a response."
}

export function toolText(part: ToolPart) {
  if (part.state.status !== "completed") return ""
  return `*${part.tool}* - ${part.state.title}`
}

export async function start() {
  const required = ["TEAMS_APP_ID", "TEAMS_APP_PASSWORD"] as const
  const missing = required.filter((key) => !process.env[key])

  if (missing.length) {
    throw new Error(`Missing Teams env vars: ${missing.join(", ")}`)
  }

  const port = Number(process.env.PORT || 3978)
  const appId = process.env.TEAMS_APP_ID!
  const auth = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: appId,
    MicrosoftAppPassword: process.env.TEAMS_APP_PASSWORD,
    MicrosoftAppType: process.env.TEAMS_APP_TYPE || "MultiTenant",
    MicrosoftAppTenantId: process.env.TEAMS_APP_TENANT_ID,
  })
  const adapter = new CloudAdapter(auth)
  const opencode = await createOpencode({ port: 0 })
  const sessions = new Map<string, Session>()
  const bySession = new Map<string, Session>()
  const bot = new ActivityHandler()

  bot.onMembersAdded(async (context, next) => {
    await context.sendActivity("OpenCode is ready. Send me a message here to start a linked session.")
    await next()
  })

  bot.onMessage(async (context, next) => {
    if (context.activity.conversation?.conversationType !== "personal") {
      await context.sendActivity("This Teams bot currently supports personal chats only.")
      await next()
      return
    }

    const text = messageText(context.activity)
    if (!text) {
      await context.sendActivity("Send me a text message and I will forward it to OpenCode.")
      await next()
      return
    }

    const key = conversationKey(context.activity)
    const reference = TurnContext.getConversationReference(context.activity)
    let session = sessions.get(key)

    if (!session) {
      const created = await opencode.client.session.create({
        body: { title: `Teams conversation ${context.activity.conversation?.id || "personal"}` },
      })

      if (created.error) {
        await context.sendActivity("Sorry, I had trouble creating a session. Please try again.")
        await next()
        return
      }

      session = { sessionId: created.data.id, reference }
      sessions.set(key, session)
      bySession.set(session.sessionId, session)

      const shared = await opencode.client.session.share({ path: { id: session.sessionId } })
      if (!shared.error && shared.data.share?.url) {
        await context.sendActivity(shared.data.share.url)
      }
    }

    const result = await opencode.client.session.prompt({
      path: { id: session.sessionId },
      body: { parts: [{ type: "text", text }] },
    })

    if (result.error) {
      await context.sendActivity("Sorry, I had trouble processing your message. Please try again.")
      await next()
      return
    }

    await context.sendActivity(responseText(result.data))
    await next()
  })

  void watch(adapter, appId, opencode.client, bySession).catch((error) => {
    console.error("Teams event watch failed", error)
  })

  const server = createServer(async (req, res) => {
    if (req.url === "/health") {
      reply(res).status(200).send("ok")
      return
    }

    if (req.url !== "/api/messages") {
      reply(res).status(404).send("Not found")
      return
    }

    if (req.method !== "POST") {
      reply(res).status(405).send("Method not allowed")
      return
    }

    const body = await requestBody(req).catch(() => null)
    if (body === null) {
      reply(res).status(400).send("Invalid JSON body")
      return
    }

    await adapter
      .process(messageRequest(req, body), reply(res), async (context) => {
        await bot.run(context)
      })
      .catch(async (error) => {
        console.error("Teams request failed", error)
        if (!res.headersSent) {
          reply(res).status(500).send("Internal server error")
        }
      })
  })

  server.listen(port, () => {
    console.log(`Teams bot listening on http://127.0.0.1:${port}`)
    console.log(`Bot endpoint: http://127.0.0.1:${port}/api/messages`)
    console.log(`Health check: http://127.0.0.1:${port}/health`)
    console.log(`Opencode server ready at ${opencode.server.url}`)
  })

  const shutdown = () => {
    server.close()
    opencode.server.close()
  }

  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

function tenantId(activity: Partial<Activity>) {
  const value = activity.channelData
  if (!value || typeof value !== "object") return ""
  if (!("tenant" in value)) return ""
  const tenant = value.tenant
  if (!tenant || typeof tenant !== "object") return ""
  if (!("id" in tenant)) return ""
  return typeof tenant.id === "string" ? tenant.id : ""
}

function messageRequest(req: IncomingMessage, body: Record<string, unknown>) {
  return {
    body,
    headers: req.headers,
    method: req.method,
  } satisfies Request
}

function reply(res: ServerResponse) {
  return {
    socket: res.socket,
    end(...args: unknown[]) {
      const [value] = args
      if (typeof value === "string" || value instanceof Uint8Array) {
        return res.end(value)
      }
      if (value === undefined) {
        return res.end()
      }
      res.setHeader("content-type", "application/json; charset=utf-8")
      return res.end(JSON.stringify(value))
    },
    header(name: string, value: unknown) {
      res.setHeader(name, String(value))
      return this
    },
    send(...args: unknown[]) {
      const [first, second] = args
      if (typeof first === "number") {
        res.statusCode = first
        return this.end(second)
      }
      return this.end(first)
    },
    status(code: number) {
      res.statusCode = code
      return this
    },
  } satisfies Response
}

async function watch(
  adapter: CloudAdapter,
  appId: string,
  client: Awaited<ReturnType<typeof createOpencode>>["client"],
  bySession: Map<string, Session>,
) {
  const events = await client.event.subscribe()
  for await (const event of events.stream) {
    if (event.type !== "message.part.updated") continue
    const part = (event as EventMessagePartUpdated).properties.part
    if (part.type !== "tool" || part.state.status !== "completed") continue
    const session = bySession.get(part.sessionID)
    if (!session) continue
    const text = toolText(part)
    if (!text) continue

    await adapter
      .continueConversationAsync(appId, session.reference, async (context) => {
        await context.sendActivity(text)
      })
      .catch(() => {})
  }
}

function requestBody(req: IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = ""
    req.setEncoding("utf8")
    req.on("data", (chunk) => {
      body += chunk
    })
    req.on("end", () => {
      if (!body.trim()) {
        resolve({})
        return
      }

      try {
        const parsed = JSON.parse(body)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("Invalid activity payload"))
          return
        }

        resolve(parsed as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    })
    req.on("error", reject)
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await start()
}
