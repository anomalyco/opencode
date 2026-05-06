import type { APIEvent } from "@solidjs/start/server"
import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"

const DISCORD_ALERT_ROLE_ID = "1501447160175136838"

const groupName = z.union([
  z.string(),
  z.object({ Value: z.string() }).transform((o) => o.Value),
  z.object({ value: z.string() }).transform((o) => o.value),
])

const HoneycombWebhookPayload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("model_http_errors"),
    product: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    isTest: z.boolean().optional(),
    url: z.string().optional(),
    groups: z.array(z.record(z.string(), groupName)).optional(),
  }),
  z.object({
    type: z.literal("provider_http_errors"),
    product: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    isTest: z.boolean().optional(),
    url: z.string().optional(),
    groups: z.array(z.record(z.string(), groupName)).optional(),
  }),
])


const postDiscordMessage = async (payload: z.infer<typeof HoneycombWebhookPayload>) => {
  const group = payload.type === "model_http_errors" ? "model" : "provider"
  const names = (payload.groups ?? []).flatMap((row) => Object.values(row))

  const content = [
    `**${payload.isTest ? "[TEST] " : ""}${payload.name ?? "Honeycomb alert"}**`,
    payload.product ? `Product: ${payload.product}` : undefined,
    names.length > 0 ? `Affected ${group}s:` : undefined,
    ...names.map((name) => `- ${name}`),
    `<@&${DISCORD_ALERT_ROLE_ID}>`,
    payload.url,
  ]
    .filter((line) => line !== undefined && line !== "")
    .join("\n")

  return fetch(Resource.DISCORD_INCIDENT_WEBHOOK_URL.value, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content,
      allowed_mentions: { roles: [DISCORD_ALERT_ROLE_ID] },
      flags: 4,
    }),
  })
}

export async function POST(input: APIEvent) {
  if (input.request.headers.get("X-Honeycomb-Webhook-Token") !== Resource.HoneycombWebhookSecret.value) {
    return Response.json({ message: "invalid token" }, { status: 401 })
  }

  const body = await input.request.json()
  const parsed = HoneycombWebhookPayload.safeParse(body)
  if (!parsed.success) return Response.json({ message: "invalid payload" }, { status: 400 })

  const payload = parsed.data
  if (payload.status !== "TRIGGERED") return Response.json({ message: "ignored" }, { status: 200 })

  const response = await postDiscordMessage(payload)
  if (!response.ok) return Response.json({ message: "discord webhook failed" }, { status: 502 })

  return Response.json({ message: "sent" }, { status: 200 })
}
