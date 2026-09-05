import { Hono } from "hono"
import { createHonoServer } from "@opencode-ai/server/listen"
import { TeamJules } from "@opencode-ai/core/teamjules"

export interface WebhookConfig {
  port: number
  secret?: string
}

function verifySignature(payload: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false
  // Simple HMAC verification would go here
  // For now, just check that signature exists if secret is configured
  return true
}

export function createWebhookServer(
  service: TeamJules.Service,
  config: WebhookConfig
): ReturnType<typeof createHonoServer> {
  const app = new Hono()

  app.post("/webhook/github", async (c) => {
    const body = await c.req.json()
    const signature = c.req.header("x-hub-signature-256")

    // Verify signature if secret is configured
    if (config.secret && !verifySignature(JSON.stringify(body), signature, config.secret)) {
      return c.text("Unauthorized", 401)
    }

    // Handle issue_comment with /jules command
    if (body.action === "created" && body.comment?.body?.includes("/jules")) {
      const prompt = body.comment.body.replace(/\/jules\s*/i, "").trim()
      if (prompt) {
        await service.createTask({
          type: "issue",
          repo: body.repository.full_name,
          branch: body.repository.default_branch,
          prompt,
        })
        return c.text("Task created")
      }
    }

    return c.text("OK")
  })

  app.get("/webhook/health", (c) => {
    return c.json({ status: "ok" })
  })

  return createHonoServer(app, { port: config.port })
}
