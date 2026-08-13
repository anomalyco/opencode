import type { APIEvent } from "@solidjs/start/server"
import { z } from "zod"
import { Resource } from "@opencode-ai/console-resource"
import { safeEqual } from "@opencode-ai/console-core/util/crypto.js"

const DISCORD_ALERT_ROLE_ID = "1520924666359713863"

const basePayload = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  isTest: z.boolean().optional(),
  url: z.string(),
})

const groups = z
  .object({
    result: z.union([z.number(), z.string()]).nullish(),
    group: z.object({ key: z.string(), value: z.string() }).array(),
  })
  .array()

const honeycombWebhookPayload = z.discriminatedUnion("type", [
  basePayload.extend({
    type: z.literal("model_http_errors"),
    groups,
  }),
  basePayload.extend({
    type: z.literal("model_low_tps"),
    groups,
  }),
  basePayload.extend({
    type: z.literal("provider_http_errors"),
    groups,
  }),
  basePayload.extend({
    type: z.literal("custom"),
  }),
])

const alertDetails = (payload: z.infer<typeof honeycombWebhookPayload>) =>
  payload.type === "custom"
    ? []
    : payload.groups.flatMap((item) =>
        item.group.map((group) => {
          const result = item.result == null ? undefined : Number(item.result)
          return `- ${group.value}${
            result !== undefined && Number.isFinite(result)
              ? payload.type === "model_low_tps"
                ? ` (${Math.round(result)} TPS)`
                : ` (${Math.round(result * 100)}% errors)`
              : ""
          }`
        }),
      )

const postDiscordMessage = async (payload: z.infer<typeof honeycombWebhookPayload>) => {
  const content = [
    `[**${payload.isTest ? "[TEST] " : ""}${payload.name ?? "Honeycomb alert"}**](${payload.url})`,
    ...alertDetails(payload),
    "",
    `<@&${DISCORD_ALERT_ROLE_ID}>`,
  ].join("\n")

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

const postSlackMessage = async (payload: z.infer<typeof honeycombWebhookPayload>) => {
  const text = [
    `<${payload.url}|*${payload.isTest ? "[TEST] " : ""}${payload.name ?? "Honeycomb alert"}*>`,
    ...alertDetails(payload),
    "",
    "<!channel>",
  ].join("\n")

  return fetch(Resource.SLACK_INCIDENT_WEBHOOK_URL.value, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, unfurl_links: false }),
  })
}

export async function POST(input: APIEvent) {
  const token = input.request.headers.get("X-Honeycomb-Webhook-Token")
  if (!safeEqual(token ?? "", Resource.HoneycombWebhookSecret.value)) {
    console.debug("Invalid Honeycomb webhook token")
    return Response.json({ message: "invalid token" }, { status: 401 })
  }

  const body = await input.request.json()
  console.log(body, JSON.stringify(body, null, 2))

  const parsed = honeycombWebhookPayload.safeParse(body)

  if (!parsed.success) {
    console.error(parsed.error)
    return Response.json({ message: "invalid payload" }, { status: 400 })
  }

  if (parsed.data.status !== "TRIGGERED") {
    console.debug("Skipping resolved alert Honeycomb webhook")
    return Response.json({ message: "ignored" }, { status: 200 })
  }

  const [discord, slack] = await Promise.all([postDiscordMessage(parsed.data), postSlackMessage(parsed.data)])
  if (!discord.ok || !slack.ok) {
    console.error("Honeycomb alert delivery failed", { discord: discord.status, slack: slack.status })
    return Response.json({ message: "alert webhook failed" }, { status: 502 })
  }

  return Response.json({ message: "sent" }, { status: 200 })
}
