import { describe, expect, test } from "bun:test"
import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { BUILTIN_PRESETS } from "../../src/personality/presets"
import { Personality } from "../../src/personality"

const ENABLED = !!process.env.XCSH_EVAL

const QUESTION = "Explain what a closure is in JavaScript and give an example."

const BUGGY_CODE = `Review this function:\n\nfunction add(a, b) { return a - b }`

const baseURL = process.env.ANTHROPIC_BASE_URL ? `${process.env.ANTHROPIC_BASE_URL.replace(/\/$/, "")}/v1` : undefined

const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY_EVAL ?? process.env.ANTHROPIC_API_KEY,
  baseURL,
})

async function ask(preset: string, prompt?: string): Promise<string> {
  const info = BUILTIN_PRESETS[preset]
  const system = Personality.resolvePrompt(info)
  const result = await generateText({
    model: anthropic(process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5"),
    system,
    prompt: prompt ?? QUESTION,
    maxOutputTokens: 1024,
  })
  return result.text
}

function countCodeBlocks(text: string): number {
  return (text.match(/```/g) ?? []).length / 2
}

describe.skipIf(!ENABLED)("Tier 2 — Behavioral eval (XCSH_EVAL=1)", () => {
  test(
    "minimal is significantly shorter than teacher",
    async () => {
      const minimal = await ask("minimal")
      const teacher = await ask("teacher")
      expect(minimal.length).toBeLessThan(teacher.length * 0.9)
    },
    { timeout: 60_000 },
  )

  test(
    "minimal response is code-dominant",
    async () => {
      const response = await ask("minimal")
      const blocks = countCodeBlocks(response)
      expect(blocks).toBeGreaterThanOrEqual(1)

      const lines = response.split("\n")
      let code = 0
      let prose = 0
      let inside = false
      for (const line of lines) {
        if (line.startsWith("```")) {
          inside = !inside
          continue
        }
        if (inside) code++
        else if (line.trim()) prose++
      }
      expect(code).toBeGreaterThanOrEqual(prose)
    },
    { timeout: 30_000 },
  )

  test(
    "formal uses more structure markers than concise",
    async () => {
      const concise = await ask("concise")
      const formal = await ask("formal")
      const markers = (t: string) => (t.match(/#{1,3}\s|^\*\*[^*]+\*\*/gm) ?? []).length
      expect(markers(formal)).toBeGreaterThan(markers(concise))
    },
    { timeout: 60_000 },
  )

  test(
    "reviewer flags issues in buggy code",
    async () => {
      const response = await ask("reviewer", BUGGY_CODE)
      const lower = response.toLowerCase()
      const critical = ["bug", "issue", "problem", "fix", "error", "incorrect", "wrong", "subtract"]
      const found = critical.some((w) => lower.includes(w))
      expect(found).toBe(true)
    },
    { timeout: 30_000 },
  )

  test(
    "creative suggests alternative approaches",
    async () => {
      const response = await ask("creative")
      const lower = response.toLowerCase()
      const signals = [
        "alternatively",
        "another approach",
        "could also",
        "different way",
        "option",
        "variation",
        "consider",
        "imagine",
        "think of",
        "what if",
        "one way",
        "another way",
        "you could",
        "practical example",
        "use case",
        "great for",
        "useful for",
        "real-world",
        "beyond",
        "multiple approach",
        "different approach",
      ]
      const found = signals.some((w) => lower.includes(w))
      expect(found).toBe(true)
    },
    { timeout: 30_000 },
  )

  test(
    "technical uses domain jargon that casual avoids",
    async () => {
      const technical = await ask("technical")
      const casual = await ask("casual")
      const jargon = ["lexical scope", "execution context", "call stack", "lexical environment", "scope chain"]
      const techHits = jargon.filter((j) => technical.toLowerCase().includes(j)).length
      const casualHits = jargon.filter((j) => casual.toLowerCase().includes(j)).length
      expect(techHits).toBeGreaterThan(casualHits)
    },
    { timeout: 60_000 },
  )
})
