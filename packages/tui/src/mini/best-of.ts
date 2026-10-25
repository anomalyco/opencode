import { EOL } from "os"
import type { OpencodeClient } from "@bolt-ai/sdk/v2"
import { UI } from "../../ui"

// Best-of-N runs: fire the same task at several models in parallel sessions,
// have a judge model rank the anonymized outputs, and keep the winner. The
// winner's text goes to stdout; the scoreboard and progress notes go to
// stderr so the output stays pipeable.

type Prompt = Parameters<OpencodeClient["session"]["prompt"]>[0]
type Create = NonNullable<Parameters<OpencodeClient["session"]["create"]>[0]>

export type Model = NonNullable<Prompt["model"]>
export type Parts = NonNullable<Prompt["parts"]>

export const LABELS = "ABCDEFGH"
export const LIMIT = LABELS.length

export interface Candidate {
  label: string
  model: Model
  sessionID?: string
  text?: string
  error?: string
}

export function format(model: Model) {
  return `${model.providerID}/${model.modelID}`
}

// Parses the comma-separated provider/model list for --best-of. Returns an
// error message instead of throwing so the CLI can die() with it.
export function parseCandidates(value: string): Model[] | string {
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const unique = [...new Set(entries)]
  if (unique.length < 2) return "--best-of needs at least two comma-separated provider/model entries"
  if (unique.length > LIMIT) return `--best-of supports at most ${LIMIT} models`
  const invalid = unique.find((item) => {
    const slash = item.indexOf("/")
    return slash <= 0 || slash === item.length - 1
  })
  if (invalid) return `--best-of entries must be in provider/model format, got: ${invalid}`
  return unique.map((item) => {
    const [providerID, ...rest] = item.split("/")
    return { providerID, modelID: rest.join("/") } as Model
  })
}

// The judge sees anonymous labeled outputs so model reputation cannot bias
// the ranking. The RANKING line is the machine-readable verdict.
export function judgePrompt(task: string, outputs: { label: string; text: string }[]) {
  const blocks = outputs
    .map((item) => `### Candidate ${item.label}\n\n${item.text.trim() || "(empty output)"}`)
    .join("\n\n")
  return [
    "You are judging anonymous candidate responses to the same task. Answer directly and do not use any tools.",
    "Rank the candidates from best to worst by correctness first, then completeness, then clarity.",
    "",
    "## Task",
    "",
    task,
    "",
    "## Candidates",
    "",
    blocks,
    "",
    "Reply with one short sentence per candidate explaining its rank.",
    `End with a final line of the form "RANKING: X > Y" listing every candidate label (${outputs
      .map((item) => item.label)
      .join(", ")}) from best to worst.`,
  ].join("\n")
}

// Pulls the last RANKING line out of the judge's reply. Returns the label
// order, or undefined when the judge did not produce a usable verdict.
export function parseVerdict(text: string, labels: string[]): string[] | undefined {
  const matches = [...text.matchAll(/RANKING:\s*([A-Z](?:\s*>\s*[A-Z])*)/gi)]
  const last = matches.at(-1)
  if (!last) return undefined
  const order = last[1].split(">").map((item) => item.trim().toUpperCase())
  const valid =
    order.length === labels.length && new Set(order).size === order.length && labels.every((l) => order.includes(l))
  if (!valid) return undefined
  return order
}

export async function runBestOf(input: {
  sdk: OpencodeClient
  candidates: Model[]
  judge: Model
  message: string
  parts: Parts
  agent?: string
  variant?: string
  permission: Create["permission"]
  json: boolean
}): Promise<number> {
  const note = (text: string) => {
    if (!input.json) UI.println(UI.Style.TEXT_DIM + text + UI.Style.TEXT_NORMAL)
  }

  const answer = (result: Awaited<ReturnType<OpencodeClient["session"]["prompt"]>>) =>
    (result.data?.parts ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n")

  const attempt = async (model: Model, label: string): Promise<Candidate> => {
    const session = await input.sdk.session.create({
      title: `best-of ${label}: ${format(model)}`,
      permission: input.permission,
    })
    const id = session.data?.id
    if (!id) return { label, model, error: "failed to create session" }
    const result = await input.sdk.session.prompt({
      sessionID: id,
      model,
      agent: input.agent,
      variant: input.variant,
      parts: input.parts,
    })
    if (result.error) return { label, model, sessionID: id, error: JSON.stringify(result.error) }
    note(`${label} · ${format(model)} finished`)
    return { label, model, sessionID: id, text: answer(result) }
  }

  note(`racing ${input.candidates.length} models, judged by ${format(input.judge)}`)
  const settled = await Promise.all(
    input.candidates.map((model, i) =>
      attempt(model, LABELS[i]).catch((err): Candidate => ({ label: LABELS[i], model, error: String(err) })),
    ),
  )
  const done = settled.filter((item): item is Candidate & { text: string } => item.text !== undefined)

  if (done.length === 0) {
    if (input.json) {
      process.stdout.write(
        JSON.stringify({
          type: "best_of",
          timestamp: Date.now(),
          candidates: settled.map((item) => ({
            label: item.label,
            model: format(item.model),
            sessionID: item.sessionID,
            error: item.error,
          })),
        }) + EOL,
      )
      return 1
    }
    settled.forEach((item) => UI.error(`${item.label} · ${format(item.model)}: ${item.error}`))
    return 1
  }

  const verdict = await (async () => {
    if (done.length === 1) return { order: [done[0].label], sessionID: undefined }
    const session = await input.sdk.session.create({
      title: `best-of judge: ${format(input.judge)}`,
      permission: input.permission,
    })
    const id = session.data?.id
    if (!id) return undefined
    const result = await input.sdk.session.prompt({
      sessionID: id,
      model: input.judge,
      variant: input.variant,
      parts: [{ type: "text", text: judgePrompt(input.message, done) }],
    })
    if (result.error) return undefined
    const order = parseVerdict(
      answer(result),
      done.map((item) => item.label),
    )
    if (!order) return undefined
    return { order, sessionID: id }
  })().catch(() => undefined)

  if (!verdict) note("judge produced no usable verdict; keeping the first successful candidate in submission order")
  const order = verdict?.order ?? done.map((item) => item.label)
  const ranked = new Map(settled.map((item) => [item.label, item]))
  const winner = ranked.get(order[0])!

  if (input.json) {
    process.stdout.write(
      JSON.stringify({
        type: "best_of",
        timestamp: Date.now(),
        winner: { label: winner.label, model: format(winner.model), sessionID: winner.sessionID, text: winner.text },
        ranking: order,
        judge: { model: format(input.judge), sessionID: verdict?.sessionID },
        candidates: settled.map((item) => ({
          label: item.label,
          model: format(item.model),
          sessionID: item.sessionID,
          error: item.error,
        })),
      }) + EOL,
    )
    return 0
  }

  UI.empty()
  order.forEach((label, i) => {
    const item = ranked.get(label)!
    const marker = i === 0 ? UI.Style.TEXT_SUCCESS + "★" : UI.Style.TEXT_DIM + `${i + 1}.`
    UI.println(
      `${marker} ${label} · ${format(item.model)} ${UI.Style.TEXT_DIM}${item.sessionID}${UI.Style.TEXT_NORMAL}`,
    )
  })
  settled
    .filter((item) => item.error !== undefined)
    .forEach((item) =>
      UI.println(
        `${UI.Style.TEXT_DANGER_BOLD}✗${UI.Style.TEXT_NORMAL} ${item.label} · ${format(item.model)} ${UI.Style.TEXT_DIM}${item.error}${UI.Style.TEXT_NORMAL}`,
      ),
    )
  UI.empty()
  process.stdout.write((winner.text ?? "") + EOL)
  return 0
}
