import type { APIEvent } from "@solidjs/start/server"
import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"

const DISCORD_ALERT_ROLE_ID = "1501447160175136838"

const HoneycombWebhookPayload = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("model_http_errors"),
    product: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    isTest: z.boolean().optional(),
    url: z.string().optional(),
    groupsTriggered: z.record(z.string(), z.unknown()).array().optional(),
  }),
  z.object({
    type: z.literal("provider_http_errors"),
    product: z.string().optional(),
    name: z.string().optional(),
    status: z.string().optional(),
    isTest: z.boolean().optional(),
    url: z.string().optional(),
    groupsTriggered: z.record(z.string(), z.unknown()).array().optional(),
  }),
])

const getGroupName = (value: unknown): string | undefined => {
  if (Array.isArray(value))
    return value
      .map(getGroupName)
      .filter((v) => v !== undefined)
      .join(", ")
  if (typeof value === "string") return value
  if (typeof value !== "object" || value === null) return undefined
  const record = value as Record<string, unknown>
  const str =
    (record.Value as string | undefined) ??
    (record.value as string | undefined) ??
    Object.values(record).find((v): v is string => typeof v === "string")
  return str
}

const getGroupNames = (payload: z.infer<typeof HoneycombWebhookPayload>) =>
  (payload.groupsTriggered ?? [])
    .map((item) => getGroupName(item.Group ?? item.group))
    .filter((name): name is string => name !== undefined)

const postDiscordMessage = async (payload: z.infer<typeof HoneycombWebhookPayload>) => {
  const group = payload.type === "model_http_errors" ? "model" : "provider"
  const names = getGroupNames(payload)

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

  return fetch(Resource.DISCORD_ALERT_WEBHOOK_URL.value, {
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
  if (input.request.headers.get("X-Honeycomb-Webhook-Token") !== Resource.HONEYCOMB_WEBHOOK_SECRET.value) {
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
