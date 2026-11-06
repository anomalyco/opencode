import type { APIEvent } from "@solidjs/start/server"
import { voiceMode } from "~/component/site/voice/flag"

// Turns a recorded question into text with ElevenLabs Scribe, for browsers without speech
// recognition. Only with ELEVENLABS_API_KEY; the key never reaches the browser.
export async function POST(event: APIEvent) {
  // Voice mode is off for launch (voice/flag.ts): no route, no model or speech calls.
  if (!voiceMode) return new Response("Not found", { status: 404 })
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return new Response("Transcription is not configured.", { status: 501 })
  const audio = await event.request.blob()
  if (audio.size === 0 || audio.size > 4_000_000) return new Response("No audio.", { status: 400 })
  const form = new FormData()
  form.append("file", audio, "question.webm")
  form.append("model_id", "scribe_v1")
  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": key },
    body: form,
  })
  if (!response.ok) return new Response("Transcription failed.", { status: 502 })
  const json = (await response.json()) as { text?: string }
  return Response.json({ text: json.text?.trim() ?? "" })
}
