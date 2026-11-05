import type { APIEvent } from "@solidjs/start/server"
import { z } from "zod"
import { matchAnswer, voiceAnswers, type VoiceLink } from "~/lib/voice-answers"
import { voiceMode } from "~/component/site/voice/flag"

// Answers a question for the voice assistant. With OPENCODE_API_KEY set (an OpenCode Models key), a
// model answers from the site's own Markdown; otherwise, and whenever the model fails, the closest
// curated answer does. Curated answers have pre-generated audio in public/voice.

const body = z.object({ question: z.string().trim().min(1).max(500), page: z.string().max(200).optional() })

export async function POST(event: APIEvent) {
  // Voice mode is off for launch (voice/flag.ts): no route, no model or speech calls.
  if (!voiceMode) return new Response("Not found", { status: 404 })
  const parsed = body.safeParse(await event.request.json().catch(() => undefined))
  if (!parsed.success) return Response.json({ error: "Ask a question." }, { status: 400 })
  const curated = matchAnswer(parsed.data.question)
  const key = process.env.OPENCODE_API_KEY
  const model = key
    ? await askModel(key, parsed.data.question, parsed.data.page, new URL(event.request.url).origin).catch(
        () => undefined,
      )
    : undefined
  if (model) return Response.json({ id: "model", source: "model", audio: null, ...model })
  return Response.json({
    id: curated.id,
    source: "curated",
    text: curated.text,
    speech: curated.speech ?? curated.text,
    links: curated.links,
    audio: curated.unrecorded ? null : curated.id === "fallback" ? "/voice/fallback.mp3" : `/voice/${curated.id}.mp3`,
  })
}

const context = new Map<string, string>()

async function page(origin: string, path: string) {
  const cached = context.get(path)
  if (cached !== undefined) return cached
  const text = await fetch(`${origin}${path}`)
    .then((response) => (response.ok ? response.text() : ""))
    .catch(() => "")
  context.set(path, text.slice(0, 12000))
  return context.get(path)!
}

async function askModel(key: string, question: string, current: string | undefined, origin: string) {
  const markdown = current && /^\/[a-z0-9/-]*$/.test(current) && current !== "/" ? `${current}.md` : "/index.md"
  const pages = await Promise.all([page(origin, "/llms.txt"), page(origin, "/index.md"), page(origin, markdown)])
  const facts = voiceAnswers.map((answer) => `- ${answer.text}`).join("\n")
  const response = await fetch("https://opencode.ai/zen/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(12000),
    body: JSON.stringify({
      model: process.env.VOICE_DEMO_MODEL ?? "qwen3.8-flash",
      max_tokens: 400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "You are the voice assistant on opencode.ai. Answer questions about OpenCode and the website in one to three short spoken sentences, using only the facts and pages below. If they don't cover it, say so and suggest the docs.",
            'Reply with JSON: {"text": "the answer", "links": [{"label": "short label", "href": "a path or URL from the pages"}]} with at most two links.',
            `Facts:\n${facts}`,
            ...pages.filter(Boolean),
          ].join("\n\n"),
        },
        { role: "user", content: question },
      ],
    }),
  })
  if (!response.ok) return undefined
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] }
  const reply = z
    .object({ text: z.string().min(1), links: z.array(z.object({ label: z.string(), href: z.string() })).max(4) })
    .safeParse(JSON.parse(json.choices?.[0]?.message?.content ?? "null"))
  if (!reply.success) return undefined
  const links: VoiceLink[] = reply.data.links.filter(
    (link) => link.href.startsWith("/") || link.href.startsWith("https://"),
  )
  return { text: reply.data.text, speech: reply.data.text, links }
}
