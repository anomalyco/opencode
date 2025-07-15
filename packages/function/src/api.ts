import { DurableObject } from "cloudflare:workers"
import { randomUUID } from "node:crypto"
import { jwtVerify, createRemoteJWKSet } from "jose"
import { createAppAuth } from "@octokit/auth-app"
import { Octokit } from "@octokit/rest"
import { Resource } from "sst"

type Env = {
  SYNC_SERVER: DurableObjectNamespace<SyncServer>
  Bucket: R2Bucket
  WEB_DOMAIN: string
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

  async webSocketMessage(ws, message) {}

  async webSocketClose(ws, code, reason, wasClean) {
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
    const clients = this.ctx.getWebSockets()
    console.log("SyncServer publish", key, "to", clients.length, "subscribers")
    for (const client of clients) {
      client.send(JSON.stringify({ key, content }))
    }
  }

  public async share(sessionID: string) {
    let secret = await this.getSecret()
    if (secret) return secret
    secret = randomUUID()

    await this.ctx.storage.put("secret", secret)
    await this.ctx.storage.put("sessionID", sessionID)

    return secret
  }

  public async getData() {
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
    const list = await this.env.Bucket.list({
      prefix: `session/message/${sessionID}/`,
      limit: 1000,
    })
    for (const item of list.objects) {
      await this.env.Bucket.delete(item.key)
    }
    await this.env.Bucket.delete(`session/info/${sessionID}`)
    await this.ctx.storage.deleteAll()
  }

  static shortName(id: string) {
    return id.substring(id.length - 8)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const splits = url.pathname.split("/")
    const method = splits[1]

    if (request.method === "GET" && method === "") {
      return new Response("Hello, world!", {
        headers: { "Content-Type": "text/plain" },
      })
    }

    if (request.method === "POST" && method === "share_create") {
      const body = await request.json<any>()
      const sessionID = body.sessionID
      const short = SyncServer.shortName(sessionID)
      const id = env.SYNC_SERVER.idFromName(short)
      const stub = env.SYNC_SERVER.get(id)
      const secret = await stub.share(sessionID)
      return new Response(
        JSON.stringify({
          secret,
          url: `https://${env.WEB_DOMAIN}/s/${short}`,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    if (request.method === "POST" && method === "share_delete") {
      const body = await request.json<any>()
      const sessionID = body.sessionID
      const secret = body.secret
      const id = env.SYNC_SERVER.idFromName(SyncServer.shortName(sessionID))
      const stub = env.SYNC_SERVER.get(id)
      await stub.assertSecret(secret)
      await stub.clear()
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (request.method === "POST" && method === "share_delete_admin") {
      const id = env.SYNC_SERVER.idFromName("oVF8Rsiv")
      const stub = env.SYNC_SERVER.get(id)
      await stub.clear()
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (request.method === "POST" && method === "share_sync") {
      const body = await request.json<{
        sessionID: string
        secret: string
        key: string
        content: any
      }>()
      const name = SyncServer.shortName(body.sessionID)
      const id = env.SYNC_SERVER.idFromName(name)
      const stub = env.SYNC_SERVER.get(id)
      await stub.assertSecret(body.secret)
      await stub.publish(body.key, body.content)
      return new Response(JSON.stringify({}), {
        headers: { "Content-Type": "application/json" },
      })
    }

    if (request.method === "GET" && method === "share_poll") {
      const upgradeHeader = request.headers.get("Upgrade")
      if (!upgradeHeader || upgradeHeader !== "websocket") {
        return new Response("Error: Upgrade header is required", {
          status: 426,
        })
      }
      const id = url.searchParams.get("id")
      console.log("share_poll", id)
      if (!id) return new Response("Error: Share ID is required", { status: 400 })
      const stub = env.SYNC_SERVER.get(env.SYNC_SERVER.idFromName(id))
      return stub.fetch(request)
    }

    if (request.method === "GET" && method === "share_data") {
      const id = url.searchParams.get("id")
      console.log("share_data", id)
      if (!id) return new Response("Error: Share ID is required", { status: 400 })
      const stub = env.SYNC_SERVER.get(env.SYNC_SERVER.idFromName(id))
      const data = await stub.getData()

      let info
      const messages: Record<string, any> = {}
      data.forEach((d) => {
        const [root, type, ...splits] = d.key.split("/")
        if (root !== "session") return
        if (type === "info") {
          info = d.content
          return
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

      return new Response(
        JSON.stringify({
          info,
          messages,
        }),
        {
          headers: { "Content-Type": "application/json" },
        },
      )
    }

    /**
     * Used by the GitHub action to get GitHub installation access token given the OIDC token
     */
    if (request.method === "POST" && method === "exchange_github_app_token") {
      const EXPECTED_AUDIENCE = "opencode-github-action"
      const GITHUB_ISSUER = "https://token.actions.githubusercontent.com"
      const JWKS_URL = `${GITHUB_ISSUER}/.well-known/jwks`

      // get Authorization header
      const authHeader = request.headers.get("Authorization")
      const token = authHeader?.replace(/^Bearer /, "")
      if (!token)
        return new Response(JSON.stringify({ error: "Authorization header is required" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })

      // verify token
      const JWKS = createRemoteJWKSet(new URL(JWKS_URL))
      let owner, repo
      try {
        const { payload } = await jwtVerify(token, JWKS, {
          issuer: GITHUB_ISSUER,
          audience: EXPECTED_AUDIENCE,
        })
        const sub = payload.sub // e.g. 'repo:my-org/my-repo:ref:refs/heads/main'
        const parts = sub.split(":")[1].split("/")
        owner = parts[0]
        repo = parts[1]
      } catch (err) {
        console.error("Token verification failed:", err)
        return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        })
      }

      // Create app JWT token
      const auth = createAppAuth({
        appId: Resource.GITHUB_APP_ID.value,
        privateKey: Resource.GITHUB_APP_PRIVATE_KEY.value,
      })
      const appAuth = await auth({ type: "app" })

      // Lookup installation
      const octokit = new Octokit({ auth: appAuth.token })
      const { data: installation } = await octokit.apps.getRepoInstallation({ owner, repo })

      // Get installation token
      const installationAuth = await auth({ type: "installation", installationId: installation.id })

      return new Response(JSON.stringify({ token: installationAuth.token }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    /**
     * Used by the opencode CLI to check if the GitHub app is installed
     */
    if (request.method === "GET" && method === "get_github_app_installation") {
      const owner = url.searchParams.get("owner")
      const repo = url.searchParams.get("repo")

      const auth = createAppAuth({
        appId: Resource.GITHUB_APP_ID.value,
        privateKey: Resource.GITHUB_APP_PRIVATE_KEY.value,
      })
      const appAuth = await auth({ type: "app" })

      // Lookup installation
      const octokit = new Octokit({ auth: appAuth.token })
      let installation
      try {
        const ret = await octokit.apps.getRepoInstallation({ owner, repo })
        installation = ret.data
      } catch (err) {
        if (err instanceof Error && err.message.includes("Not Found")) {
          // not installed
        } else {
          throw err
        }
      }

      return new Response(JSON.stringify({ installation }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    return new Response("Not Found", { status: 404 })
  },
}
