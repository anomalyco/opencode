import { TeamJules } from "@opencode-ai/core/teamjules"
import { Effect } from "effect"
import { createHmac, timingSafeEqual } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

export interface WebhookConfig {
  port: number
  secret?: string
}

export function verifySignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  const expected = "sha256=" + createHmac("sha256", secret).update(payload, "utf8").digest("hex")
  if (signature.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expected, "utf8"))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => resolve(body))
    req.on("error", reject)
  })
}

interface GitHubCommentPayload {
  action?: string
  comment?: {
    body?: string
  }
  repository?: {
    full_name?: string
    default_branch?: string
  }
}

export function createWebhookServer(
  service: TeamJules.Interface,
  config: WebhookConfig
) {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "POST" && req.url === "/webhook/github") {
      const bodyStr = await readBody(req)
      const signature = req.headers["x-hub-signature-256"] as string | undefined

      if (config.secret && !verifySignature(bodyStr, signature, config.secret)) {
        res.writeHead(401)
        res.end("Unauthorized")
        return
      }

      let body: GitHubCommentPayload
      try {
        body = JSON.parse(bodyStr) as GitHubCommentPayload
      } catch {
        res.writeHead(400)
        res.end("Invalid JSON")
        return
      }

      if (body.action === "created" && body.comment?.body?.includes("/jules")) {
        const prompt = body.comment.body.replace(/^[\s\S]*?\/jules\s*/i, "").trim()
        if (prompt && body.repository?.full_name) {
          await Effect.runPromise(service.createTask({
            type: "issue",
            repo: body.repository.full_name,
            branch: body.repository.default_branch || "main",
            prompt,
          }))
          res.writeHead(200)
          res.end("Task created")
          return
        }
      }

      res.writeHead(200)
      res.end("OK")
    } else if (req.method === "GET" && req.url === "/webhook/health") {
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: "ok" }))
    } else {
      res.writeHead(404)
      res.end("Not Found")
    }
  })

  return {
    listen: () => new Promise<void>((resolve) => server.listen(config.port, resolve)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    server,
  }
}
