import { voiceMode } from "~/component/site/voice/flag"

// Which parts of the voice assistant run on a server key here: ElevenLabs speech and transcription
// with ELEVENLABS_API_KEY, model answers with OPENCODE_API_KEY. The browser falls back without them.
export function GET() {
  // Voice mode is off for launch (voice/flag.ts): no route, no model or speech calls.
  if (!voiceMode) return new Response("Not found", { status: 404 })
  return Response.json({
    speech: Boolean(process.env.ELEVENLABS_API_KEY),
    transcribe: Boolean(process.env.ELEVENLABS_API_KEY),
    model: Boolean(process.env.OPENCODE_API_KEY),
  })
}
