// Example plugin demonstrating HTTP route registration for webhook endpoints
// This plugin registers endpoints to receive webhooks from GitHub and GitLab

import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export default async function webhookPlugin(input: PluginInput): Promise<Hooks> {
  const { client } = input

  return {
    http: {
      routes: [
        // GitHub webhook endpoint
        {
          method: "POST",
          path: "/webhook/github",
          handler: async (request: Request) => {
            const signature = request.headers.get("x-hub-signature-256")
            const eventType = request.headers.get("x-github-event")
            const body = await request.text()

            console.log(`[Webhook Plugin] GitHub ${eventType} event received`)

            // TODO: Verify signature using crypto
            // const secret = process.env.GITHUB_WEBHOOK_SECRET
            // const expectedSignature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
            // if (signature !== expectedSignature) {
            //   return new Response("Invalid signature", { status: 401 })
            // }

            try {
              const payload = JSON.parse(body)

              // Handle different GitHub event types
              if (eventType === "issues" && payload.action === "opened") {
                const session = await client.session.create()
                await client.session.chat({
                  sessionId: session.id,
                  message: `GitHub issue #${payload.issue.number} opened: ${payload.issue.title}\n\n${payload.issue.body}`,
                })
                console.log(`[Webhook Plugin] Created session ${session.id} for GitHub issue #${payload.issue.number}`)
              } else if (eventType === "pull_request" && payload.action === "opened") {
                const session = await client.session.create()
                await client.session.chat({
                  sessionId: session.id,
                  message: `GitHub PR #${payload.pull_request.number} opened: ${payload.pull_request.title}\n\n${payload.pull_request.body}`,
                })
                console.log(`[Webhook Plugin] Created session ${session.id} for GitHub PR #${payload.pull_request.number}`)
              }

              return new Response(JSON.stringify({ received: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            } catch (error) {
              console.error("[Webhook Plugin] Error processing GitHub webhook:", error)
              return new Response("Internal server error", { status: 500 })
            }
          },
        },

        // GitLab webhook endpoint
        {
          method: "POST",
          path: "/webhook/gitlab",
          handler: async (request: Request) => {
            const token = request.headers.get("x-gitlab-token")
            const eventType = request.headers.get("x-gitlab-event")
            const body = await request.text()

            console.log(`[Webhook Plugin] GitLab ${eventType} event received`)

            // TODO: Verify token
            // const expectedToken = process.env.GITLAB_WEBHOOK_TOKEN
            // if (token !== expectedToken) {
            //   return new Response("Invalid token", { status: 401 })
            // }

            try {
              const payload = JSON.parse(body)

              // Handle different GitLab event types
              if (eventType === "Issue Hook" && payload.object_attributes?.action === "open") {
                const session = await client.session.create()
                await client.session.chat({
                  sessionId: session.id,
                  message: `GitLab issue #${payload.object_attributes.iid} opened: ${payload.object_attributes.title}\n\n${payload.object_attributes.description}`,
                })
                console.log(`[Webhook Plugin] Created session ${session.id} for GitLab issue #${payload.object_attributes.iid}`)
              } else if (eventType === "Merge Request Hook" && payload.object_attributes?.action === "open") {
                const session = await client.session.create()
                await client.session.chat({
                  sessionId: session.id,
                  message: `GitLab MR !${payload.object_attributes.iid} opened: ${payload.object_attributes.title}\n\n${payload.object_attributes.description}`,
                })
                console.log(`[Webhook Plugin] Created session ${session.id} for GitLab MR !${payload.object_attributes.iid}`)
              }

              return new Response(JSON.stringify({ received: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            } catch (error) {
              console.error("[Webhook Plugin] Error processing GitLab webhook:", error)
              return new Response("Internal server error", { status: 500 })
            }
          },
        },

        // Generic webhook endpoint with path parameter
        {
          method: "POST",
          path: "/webhook/:provider",
          handler: async (request: Request) => {
            const url = new URL(request.url)
            const provider = url.pathname.split("/").pop()
            const body = await request.text()

            console.log(`[Webhook Plugin] Generic webhook from ${provider} received`)

            try {
              const payload = JSON.parse(body)
              console.log(`[Webhook Plugin] Payload:`, payload)

              return new Response(JSON.stringify({ received: true, provider }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              })
            } catch (error) {
              console.error(`[Webhook Plugin] Error processing ${provider} webhook:`, error)
              return new Response("Internal server error", { status: 500 })
            }
          },
        },

        // Health check endpoint
        {
          method: "GET",
          path: "/webhook/health",
          handler: async () => {
            return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            })
          },
        },
      ],
    },

    // Also listen to OpenCode events
    async event(input) {
      console.log(`[Webhook Plugin] OpenCode event: ${input.event.type}`)
    },

    async dispose() {
      console.log("[Webhook Plugin] Disposed")
    },
  }
}
