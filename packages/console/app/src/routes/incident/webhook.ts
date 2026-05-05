import type { APIEvent } from "@solidjs/start/server"
import { Resource } from "@opencode-ai/console-resource"
import { Webhook } from "svix"

type Incident = {
  name?: string
  permalink?: string
  summary?: string
}

type IncidentWebhookPayload = {
  event_type?: string
  "public_incident.incident_created_v2"?: Incident
}

const verifyIncidentWebhook = (request: Request, body: string) => {
  try {
    return new Webhook(Resource.INCIDENT_WEBHOOK_SIGNING_SECRET.value).verify(
      body,
      Object.fromEntries(request.headers.entries()),
    ) as IncidentWebhookPayload
  } catch {
    return undefined
  }
}

const postToDiscord = async (incident: Incident) =>
  fetch(Resource.DISCORD_INCIDENT_WEBHOOK_URL.value, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: [
        `**${incident.name ?? "Incident created"}**`,
        incident.summary,
        "",
        "@everyone",
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

export async function POST(input: APIEvent) {
  const body = await input.request.text()
  const payload = verifyIncidentWebhook(input.request, body)
  if (!payload) {
    return Response.json({ message: "invalid signature" }, { status: 401 })
  }

  if (payload.event_type !== "public_incident.incident_created_v2") {
    return Response.json({ message: "ignored" }, { status: 200 })
  }

  const incident = payload["public_incident.incident_created_v2"]
  if (!incident) return Response.json({ message: "missing incident" }, { status: 400 })

  const response = await postToDiscord(incident)
  if (!response.ok) {
    console.error(await response.text())
    return Response.json({ message: "discord webhook failed" }, { status: 502 })
  }

  return Response.json({ message: "sent" }, { status: 200 })
}
