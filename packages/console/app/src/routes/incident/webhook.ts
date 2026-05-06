import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"
import { Webhook } from "svix"

type Incident = {
  mode?: "test" | "standard"
  name?: string
  permalink?: string
  summary?: string
}

type IncidentWebhookPayload = {
  event_type?: string
  "public_incident.incident_created_v2"?: Incident
}

const verifyWebhook = async (request: Request) => {
  const body = await request.text()
  try {
    return new Webhook(Resource.INCIDENT_WEBHOOK_SIGNING_SECRET.value).verify(
      body,
      Object.fromEntries(request.headers.entries()),
    ) as IncidentWebhookPayload
  } catch {
    return undefined
  }
}

const postDiscordMessage = async (incident: Incident) => {
  return fetch(Resource.DISCORD_INCIDENT_WEBHOOK_URL.value, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: [
        `**${incident.mode === "test" ? "[TEST] " : ""}${incident.name ?? "Incident has been created"}**`,
        incident.summary,
        "",
        "@inference",
        "",
        incident.permalink,
      ]
        .filter((line) => line !== undefined)
        .join("\n"),
      allowed_mentions: {
        parse: ["everyone"],
      },
      flags: 4,
    }),
  })
}

export async function POST(input: APIEvent) {
  const payload = await verifyWebhook(input.request)
  if (!payload) {
    return Response.json({ message: "invalid signature" }, { status: 401 })
  }

  if (payload.event_type !== "public_incident.incident_created_v2") {
    return Response.json({ message: "ignored event" }, { status: 200 })
  }

  const incident = payload["public_incident.incident_created_v2"]
  if (!incident) {
    return Response.json({ message: "missing incident" }, { status: 400 })
  }

  const response = await postDiscordMessage(incident)
  if (!response.ok) {
    return Response.json({ message: "discord webhook failed" }, { status: 502 })
  }

  return Response.json({ message: "sent" }, { status: 200 })
}
