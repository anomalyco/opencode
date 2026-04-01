import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { BUILTIN_PRESETS } from "../src/personality/presets"
import { Personality } from "../src/personality"

const DEFAULT_QUESTION = "Explain what a closure is in JavaScript and give an example."

function parseArgs() {
  const args = process.argv.slice(2)
  let full = false
  let filter: string[] | undefined
  let question = DEFAULT_QUESTION

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--full") {
      full = true
    } else if (arg === "--personality" && args[i + 1]) {
      filter = args[++i].split(",").map((s) => s.trim())
    } else if (!arg.startsWith("--")) {
      question = arg
    }
  }

  return { full, filter, question }
}

function countCodeBlocks(text: string): number {
  return Math.floor((text.match(/```/g) ?? []).length / 2)
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function countLines(text: string): number {
  return text.split("\n").length
}

type Result = {
  name: string
  text: string
  words: number
  lines: number
  blocks: number
}

async function main() {
  const { full, filter, question } = parseArgs()

  const baseURL = process.env.ANTHROPIC_BASE_URL
    ? `${process.env.ANTHROPIC_BASE_URL.replace(/\/$/, "")}/v1`
    : undefined

  const anthropic = createAnthropic({ baseURL })

  const names = filter ?? Object.keys(BUILTIN_PRESETS).sort()

  console.log("=".repeat(55))
  console.log(` PERSONALITY QA — "${question.slice(0, 45)}${question.length > 45 ? "..." : ""}"`)
  console.log("=".repeat(55))
  console.log()

  const results: Result[] = []

  for (const name of names) {
    const info = BUILTIN_PRESETS[name]
    if (!info) {
      console.log(`-- ${name} -- (unknown preset, skipping)\n`)
      continue
    }

    const system = Personality.resolvePrompt(info)
    const result = await generateText({
      model: anthropic(process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL ?? "claude-haiku-4-5"),
      system,
      prompt: question,
      maxOutputTokens: 1024,
    })

    const text = result.text
    const words = countWords(text)
    const lines = countLines(text)
    const blocks = countCodeBlocks(text)

    results.push({ name, text, words, lines, blocks })

    const display = full ? text : text.slice(0, 500) + (text.length > 500 ? "..." : "")

    console.log(`-- ${name} ${"─".repeat(Math.max(0, 50 - name.length))}`)
    console.log(display)
    console.log(`Words: ${words} | Lines: ${lines} | Code blocks: ${blocks}`)
    console.log()
  }

  console.log("=".repeat(55))
  console.log(" SUMMARY")
  console.log("=".repeat(55))
  console.log(` ${"Personality".padEnd(14)} | ${"Words".padStart(5)} | ${"Lines".padStart(5)} | ${"Code blocks".padStart(11)}`)
  console.log(` ${"-".repeat(14)} | ${"-".repeat(5)} | ${"-".repeat(5)} | ${"-".repeat(11)}`)
  for (const r of results) {
    console.log(
      ` ${r.name.padEnd(14)} | ${String(r.words).padStart(5)} | ${String(r.lines).padStart(5)} | ${String(r.blocks).padStart(11)}`,
    )
  }
}

main().catch((e) => {
  console.error("Error:", e.message)
  process.exit(1)
})
