import { Hono } from "hono"
import { DurableObject } from "cloudflare:workers"
let randomUUID = crypto.randomUUID

// type Env = {
//   SYNC_SERVER: DurableObjectNamespace<Env.SyncServer>
//   Bucket: R2Bucket
//   WEB_DOMAIN: string
//   ADMIN_SECRET: string
// }

async function getFeishuTenantToken(): Promise<string> {
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: Resource.FEISHU_APP_ID.value,
      app_secret: Resource.FEISHU_APP_SECRET.value,
    }),
  })
  const data = (await response.json()) as { tenant_access_token?: string }
  if (!data.tenant_access_token) throw new Error("Failed to get Feishu tenant token")
  return data.tenant_access_token
}

export class SyncServer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  async fetch() {
    console.log("SyncServer subscribe")

    const webSocketPair = new WebSocketPair()
    const [client, server] = Object.values(webSocketPair)

    this.ctx.acceptWebSocket(server)

    const data = await this.ctx.storage.list()
    Array.from(data.entries())
      .filter(([key, _]) => key.startsWith("session/"))
      .map(([key, content]) => server.send(JSON.stringify({ key, content })))

    return new Response(null, {
      status: 101,
      webSocket: client,
    })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {}

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    ws.close(code, "Durable Object is closing WebSocket")
  }

  async publish(key: string, content: any) {
    const sessionID = await this.getSessionID()
    if (
      !key.startsWith(`session/info/${sessionID}`) &&
      !key.startsWith(`session/message/${sessionID}/`) &&
      !key.startsWith(`session/part/${sessionID}/`)
    )
      return new Response("Error: Invalid key", { status: 400 })

    // store message
    await this.env.Bucket.put(`share/${key}.json`, JSON.stringify(content), {
      httpMetadata: {
        contentType: "application/json",
      },
    })
    await this.ctx.storage.put(key, content)

    // Update session metadata
    await this.updateMetadata(key, content)

    const clients = this.ctx.getWebSockets()
    console.log("SyncServer publish", key, "to", clients.length, "subscribers")
    for (const client of clients) {
      client.send(JSON.stringify({ key, content }))
    }
  }

  private async updateMetadata(key: string, content: any) {
    const sessionID = await this.getSessionID()
    const shortName = SyncServer.shortName(sessionID!)

    // Get or create metadata
    let metadata = (await this.ctx.storage.get<any>("metadata")) || {
      id: shortName,
      sessionID,
      messageCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Update metadata based on content type
    const [, type] = key.split("/")
    if (type === "info") {
      metadata.title = content.title || "Untitled Session"
      metadata.directory = content.directory || ""
    } else if (type === "message") {
      metadata.messageCount++
      if (content.usage) {
        metadata.inputTokens += content.usage.inputTokens || 0
        metadata.outputTokens += content.usage.outputTokens || 0
      }
    }

    metadata.updatedAt = new Date().toISOString()

    // Store metadata in durable storage
    await this.ctx.storage.put("metadata", metadata)

    // Store metadata in R2 for quick listing
    await this.env.Bucket.put(`share/metadata/${shortName}.json`, JSON.stringify(metadata), {
      httpMetadata: {
        contentType: "application/json",
      },
    })
  }

  public async getMetadata() {
    return this.ctx.storage.get<any>("metadata")
  }

  public async share(sessionID: string) {
    let secret = await this.getSecret()
    if (secret) return secret
    secret = randomUUID()

    await this.ctx.storage.put("secret", secret)
    await this.ctx.storage.put("sessionID", sessionID)

    return secret
  }

  public async getData(): Promise<
    Array<{
      key: string
      content: {
        id?: string
        messageID?: string
        parts?: any[]
        [key: string]: any
      }
    }>
  > {
    const data = (await this.ctx.storage.list()) as Map<string, any>
    return Array.from(data.entries())
      .filter(([key, _]) => key.startsWith("session/"))
      .map(([key, content]) => ({ key, content }))
  }

  public async assertSecret(secret: string) {
    if (secret !== (await this.getSecret())) throw new Error("Invalid secret")
  }

  private async getSecret() {
    return this.ctx.storage.get<string>("secret")
  }

  private async getSessionID() {
    return this.ctx.storage.get<string>("sessionID")
  }

  async clear() {
    const sessionID = await this.getSessionID()
    const shortName = sessionID ? SyncServer.shortName(sessionID) : null

    // Delete R2 objects
    const list = await this.env.Bucket.list({
      prefix: `share/session/message/${sessionID}/`,
      limit: 1000,
    })
    for (const item of list.objects) {
      await this.env.Bucket.delete(item.key)
    }
    await this.env.Bucket.delete(`share/session/info/${sessionID}.json`)

    // Delete metadata from R2
    if (shortName) {
      await this.env.Bucket.delete(`share/metadata/${shortName}.json`)
    }

    await this.ctx.storage.deleteAll()
  }

  static shortName(id: string) {
    return id.substring(id.length - 8)
  }
}

export default new Hono<{ Bindings: Env }>()
  .get("/", (c) => c.text("Hello, world!"))
  .post("/share_create", async (c) => {
    const body = await c.req.json<{ sessionID: string }>()
    const sessionID = body.sessionID
    const short = SyncServer.shortName(sessionID)
    const id = c.env.SYNC_SERVER.idFromName(short)
    const stub = c.env.SYNC_SERVER.get(id)
    const secret = await stub.share(sessionID)
    console.log("WEB_DOMAIN:", c.env.WEB_DOMAIN)
    return c.json({
      secret,
      url: `https://${c.env.WEB_DOMAIN}/s/${short}`,
    })
  })
  .post("/share_delete", async (c) => {
    const body = await c.req.json<{ sessionID: string; secret: string }>()
    const sessionID = body.sessionID
    const secret = body.secret
    const id = c.env.SYNC_SERVER.idFromName(SyncServer.shortName(sessionID))
    const stub = c.env.SYNC_SERVER.get(id)
    await stub.assertSecret(secret)
    await stub.clear()
    return c.json({})
  })
  .post("/share_delete_admin", async (c) => {
    const body = await c.req.json<{ sessionShortName: string; adminSecret: string }>()
    const sessionShortName = body.sessionShortName
    const adminSecret = body.adminSecret
    if (adminSecret !== c.env.ADMIN_SECRET) {
      return c.text("Error: Invalid admin secret", { status: 403 })
    }
    const id = c.env.SYNC_SERVER.idFromName(sessionShortName)
    const stub = c.env.SYNC_SERVER.get(id)
    await stub.clear()
    return c.json({})
  })
  .post("/share_sync", async (c) => {
    const body = await c.req.json<{
      sessionID: string
      secret: string
      key: string
      content: any
    }>()
    const name = SyncServer.shortName(body.sessionID)
    const id = c.env.SYNC_SERVER.idFromName(name)
    const stub = c.env.SYNC_SERVER.get(id)
    await stub.assertSecret(body.secret)
    await stub.publish(body.key, body.content)
    return c.json({})
  })
  .get("/share_poll", async (c) => {
    const upgradeHeader = c.req.header("Upgrade")
    if (!upgradeHeader || upgradeHeader !== "websocket") {
      return c.text("Error: Upgrade header is required", { status: 426 })
    }
    const id = c.req.query("id")
    console.log("share_poll", id)
    if (!id) return c.text("Error: Share ID is required", { status: 400 })
    const stub = c.env.SYNC_SERVER.get(c.env.SYNC_SERVER.idFromName(id))
    return stub.fetch(c.req.raw)
  })
  .get("/share_data", async (c) => {
    const id = c.req.query("id")
    console.log("share_data", id)
    if (!id) return c.text("Error: Share ID is required", { status: 400 })
    const stub = c.env.SYNC_SERVER.get(c.env.SYNC_SERVER.idFromName(id))
    const data = await stub.getData()

    let info
    const messages: Record<string, any> = {}
    data.forEach((d) => {
      const [root, type] = d.key.split("/")
      if (root !== "session") return
      if (type === "info") {
        info = d.content
      }
      if (type === "message") {
        messages[d.content.id] = {
          parts: [],
          ...d.content,
        }
      }
      if (type === "part") {
        messages[d.content.messageID].parts.push(d.content)
      }
    })

    return c.json({ info, messages })
  })
  .post("/feishu", async (c) => {
    const body = (await c.req.json()) as {
      challenge?: string
      event?: {
        message?: {
          message_id?: string
          root_id?: string
          parent_id?: string
          chat_id?: string
          content?: string
        }
      }
    }
    console.log(JSON.stringify(body, null, 2))
    const challenge = body.challenge
    if (challenge) return c.json({ challenge })

    const content = body.event?.message?.content
    const parsed =
      typeof content === "string" && content.trim().startsWith("{")
        ? (JSON.parse(content) as {
            text?: string
          })
        : undefined
    const text = typeof parsed?.text === "string" ? parsed.text : typeof content === "string" ? content : ""

    let message = text.trim().replace(/^@_user_\d+\s*/, "")
    message = message.replace(/^aiden,?\s*/i, "<@759257817772851260> ")
    if (!message) return c.json({ ok: true })

    const threadId = body.event?.message?.root_id || body.event?.message?.message_id
    if (threadId) message = `${message} [${threadId}]`

    const response = await fetch(
      `https://discord.com/api/v10/channels/${Resource.DISCORD_SUPPORT_CHANNEL_ID.value}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bot ${Resource.DISCORD_SUPPORT_BOT_TOKEN.value}`,
        },
        body: JSON.stringify({
          content: `${message}`,
        }),
      },
    )

    if (!response.ok) {
      console.error(await response.text())
      return c.json({ error: "Discord bot message failed" }, { status: 502 })
    }

    return c.json({ ok: true })
  })
  .get("/sessions_list", async (c) => {
    console.log("sessions_list")
    const list = await c.env.Bucket.list({
      prefix: "share/metadata/",
      limit: 1000,
    })

    const sessions = await Promise.all(
      list.objects.map(async (obj) => {
        const content = await c.env.Bucket.get(obj.key)
        if (!content) return null
        const metadata = await content.json()
        return metadata
      }),
    )

    return c.json({
      sessions: sessions
        .filter(Boolean)
        .sort((a: any, b: any) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    })
  })
  .post("/migrate_metadata", async (c) => {
    const body = await c.req.json<{ adminSecret: string }>()
    if (body.adminSecret !== c.env.ADMIN_SECRET) {
      return c.text("Error: Invalid admin secret", { status: 403 })
    }

    console.log("migrate_metadata: Starting migration")
    const infoList = await c.env.Bucket.list({
      prefix: "share/session/info/",
      limit: 1000,
    })

    const results: { id: string; status: string }[] = []
    for (const obj of infoList.objects) {
      const content = await c.env.Bucket.get(obj.key)
      if (!content) continue

      const info: any = await content.json()
      const sessionID = obj.key.replace("share/session/info/", "").replace(".json", "")
      const shortName = SyncServer.shortName(sessionID)

      // Check if metadata already exists
      const existingMetadata = await c.env.Bucket.get(`share/metadata/${shortName}.json`)
      if (existingMetadata) {
        results.push({ id: shortName, status: "skipped" })
        continue
      }

      // Count messages and tokens
      const messagesList = await c.env.Bucket.list({
        prefix: `share/session/message/${sessionID}/`,
        limit: 1000,
      })

      let inputTokens = 0
      let outputTokens = 0
      for (const msgObj of messagesList.objects) {
        const msgContent = await c.env.Bucket.get(msgObj.key)
        if (msgContent) {
          const msg: any = await msgContent.json()
          if (msg.usage) {
            inputTokens += msg.usage.inputTokens || 0
            outputTokens += msg.usage.outputTokens || 0
          }
        }
      }

      const metadata = {
        id: shortName,
        sessionID,
        title: info.title || "Untitled Session",
        directory: info.directory || "",
        messageCount: messagesList.objects.length,
        inputTokens,
        outputTokens,
        createdAt: obj.uploaded?.toISOString() || new Date().toISOString(),
        updatedAt: obj.uploaded?.toISOString() || new Date().toISOString(),
      }

      await c.env.Bucket.put(`share/metadata/${shortName}.json`, JSON.stringify(metadata), {
        httpMetadata: {
          contentType: "application/json",
        },
      })

      results.push({ id: shortName, status: "migrated" })
    }

    return c.json({
      message: "Migration complete",
      total: results.length,
      migrated: results.filter((r) => r.status === "migrated").length,
      skipped: results.filter((r) => r.status === "skipped").length,
      results,
    })
  })
  .all("*", (c) => c.text("Not Found", { status: 404 }))
