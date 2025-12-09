#!/usr/bin/env bun
import fs from "fs/promises"
import path from "path"

const args = new Map<string, string>()
for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i]
  if (!arg.startsWith("--")) continue
  const [key, value] = arg.slice(2).split("=")
  args.set(key, value ?? process.argv[i + 1])
  if (!value) i += 1
}

function getArg(key: string, fallback?: string) {
  return args.get(key) ?? fallback
}

const base = getArg("base", process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1")
const head = getArg("head", "HEAD")
const outPath = getArg("output")
const apiKey = process.env.OPENAI_API_KEY
const model = process.env.AI_REVIEW_MODEL ?? "gpt-4o-mini"

async function run(cmd: string[], cwd = ".") {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" })
  const stdout = proc.stdout ? await Bun.readableStreamToText(proc.stdout) : ""
  const stderr = proc.stderr ? await Bun.readableStreamToText(proc.stderr) : ""
  const code = await proc.exited
  return { code, stdout, stderr }
}

async function readFileSafe(file: string, limit: number) {
  return fs.readFile(file, "utf8").then((text) => text.slice(0, limit)).catch(() => "")
}

async function main() {
  if (!apiKey) {
    console.error("OPENAI_API_KEY missing; skipping AI review.")
    return
  }

  const diff = await run(["git", "diff", "--unified=3", "--no-color", `${base}..${head}`])
  if (diff.code !== 0) {
    console.error("git diff failed", diff.stderr)
    process.exit(diff.code ?? 1)
  }
  if (!diff.stdout.trim()) {
    console.log("No diff to review.")
    return
  }

  const styleGuide = await readFileSafe("STYLE_GUIDE.md", 4000)
  const contributing = await readFileSafe("CONTRIBUTING.md", 2000)

  const policy = `Review focus:
- Correctness, regressions, security, privacy, data handling
- Missing tests and type safety
- Performance risks
- Style guide compliance (avoid else/try/any/let; concise names; single-function preference; Bun APIs)
- Keep comments concise; no markdown headings; bullets only

Org guides (truncated):
STYLE_GUIDE.md:\n${styleGuide}\n\nCONTRIBUTING.md:\n${contributing}`

  const prompt = `Diff to review (base ${base}, head ${head}):\n\n\n${diff.stdout.slice(0, 12000)}`

  const body = {
    model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content:
          "You are a senior OpenCode reviewer. Report only concrete issues. Format: '- [severity][file:line] message'. Severities: HIGH/ MED/ LOW. Add a final line 'Tests: added/needed/not needed'. If no issues, write '- LOW[general] No issues found.'",
      },
      { role: "user", content: policy },
      { role: "user", content: prompt },
    ],
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    console.error("OpenAI API error", await response.text())
    process.exit(1)
  }

  const json = await response.json()
  const content: string = json.choices?.[0]?.message?.content ?? ""
  const output = content.trim().concat("\n\n<!-- ai-review -->")

  if (outPath) {
    await fs.writeFile(outPath, output, "utf8")
    console.log(`Review written to ${outPath}`)
    return
  }

  console.log(output)
}

main()
