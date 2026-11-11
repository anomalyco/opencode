import type { APIEvent } from "@solidjs/start/server"
import { z } from "zod"
import { voiceMode } from "~/component/site/voice/flag"

// Reads an answer out with ElevenLabs, streamed as MP3. Only with ELEVENLABS_API_KEY; the key never
// reaches the browser. The voice is River, the one the pre-generated answers use.
const voice = process.env.VOICE_DEMO_VOICE ?? "SAz9YHcvj6GT2YYXdXww"
const body = z.object({ text: z.string().trim().min(1).max(800) })

export async function POST(event: APIEvent) {
  // Voice mode is off for launch (voice/flag.ts): no route, no model or speech calls.
  if (!voiceMode) return new Response("Not found", { status: 404 })
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return new Response("Speech is not configured.", { status: 501 })
  const parsed = body.safeParse(await event.request.json().catch(() => undefined))
  if (!parsed.success) return new Response("Nothing to say.", { status: 400 })
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: parsed.data.text, model_id: "eleven_flash_v2_5" }),
    },
  )
  if (!response.ok || !response.body) return new Response("Speech failed.", { status: 502 })
  return new Response(response.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } })
}
