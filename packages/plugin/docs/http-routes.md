# Plugin HTTP Routes

This feature allows plugins to register custom HTTP endpoints on the main OpenCode server port.

## Overview

Plugins can now expose HTTP endpoints by defining routes in their `Hooks` object. These routes are registered on the same port as the main OpenCode API server, allowing plugins to receive webhooks and provide custom API endpoints without requiring additional ports or infrastructure.

## Usage

To register HTTP routes, add an `http` property to your plugin's `Hooks` object:

```typescript
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  return {
    http: {
      routes: [
        {
          method: "POST",
          path: "/webhook/github",
          handler: async (request: Request) => {
            const payload = await request.json()
            console.log("GitHub webhook received:", payload)
            return new Response(JSON.stringify({ received: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          }
        }
      ]
    }
  }
}
```

## Route Configuration

Each route has the following properties:

- `method`: HTTP method (`"GET"`, `"POST"`, `"PUT"`, `"DELETE"`, `"PATCH"`)
- `path`: URL path (supports path parameters)
- `handler`: Async function that receives a `Request` and returns a `Response`

## Path Parameters

Routes support path parameters using the `:paramName` syntax:

```typescript
{
  method: "GET",
  path: "/api/users/:id",
  handler: async (request: Request) => {
    const url = new URL(request.url)
    const id = url.pathname.split("/")[3]
    return new Response(JSON.stringify({ userId: id }))
  }
}
```

## Accessing the OpenCode Client

Your plugin has access to the OpenCode SDK client through the `input` parameter:

```typescript
export default async function myPlugin(input: PluginInput): Promise<Hooks> {
  const { client } = input
  
  return {
    http: {
      routes: [
        {
          method: "POST",
          path: "/create-session",
          handler: async (request: Request) => {
            const session = await client.session.create()
            return new Response(JSON.stringify(session), {
              status: 201,
              headers: { "Content-Type": "application/json" }
            })
          }
        }
      ]
    }
  }
}
```

## Example: GitHub Webhook Integration

Here's a complete example of a plugin that receives GitHub webhooks and creates OpenCode sessions:

```typescript
import type { Hooks, PluginInput } from "@opencode-ai/plugin"

export default async function githubWebhookPlugin(input: PluginInput): Promise<Hooks> {
  const { client } = input
  
  return {
    http: {
      routes: [
        {
          method: "POST",
          path: "/webhook/github",
          handler: async (request: Request) => {
            // Verify GitHub webhook signature
            const signature = request.headers.get("x-hub-signature-256")
            const body = await request.text()
            
            // TODO: Verify signature using crypto
            
            // Parse webhook payload
            const payload = JSON.parse(body)
            
            // Handle different event types
            const eventType = request.headers.get("x-github-event")
            
            if (eventType === "issues" && payload.action === "opened") {
              // Create a new session for the issue
              const session = await client.session.create()
              
              // Send a message to the session
              await client.session.chat({
                sessionId: session.id,
                message: `Please help with GitHub issue #${payload.issue.number}: ${payload.issue.title}\n\n${payload.issue.body}`
              })
            }
            
            return new Response(JSON.stringify({ received: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" }
            })
          }
        }
      ]
    }
  }
}
```

## Security Considerations

When implementing webhook endpoints, consider the following security measures:

1. **Verify signatures**: Always verify webhook signatures from services like GitHub, Stripe, etc.
2. **Rate limiting**: Implement rate limiting to prevent abuse
3. **Authentication**: Consider adding API key authentication for sensitive endpoints
4. **Input validation**: Validate all incoming data before processing

## Limitations

- Routes are registered on the main server port and share the same authentication as the OpenCode API
- Plugin routes are checked before the main API, so avoid paths that conflict with OpenCode's built-in routes
- Each request to a plugin route is processed sequentially, so heavy operations should be offloaded to background tasks
