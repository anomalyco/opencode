import { EOL } from "os"
import type { OpencodeClient } from "@bolt-ai/sdk/v2"
import { GlobalBus, type GlobalEvent } from "@/bus/global"
import { UI } from "../../ui"
import { LABELS, LIMIT, format, judgePrompt, parseVerdict, type Model, type Parts } from "./best-of"

// Arena runs: fire the same task at several agents in parallel, each in its
// own isolated git worktree, then have a judge model rank the anonymized
// outputs (final answer + code diff). The winner's worktree survives; with
// --cleanup the losers' worktrees and branches are deleted. The winner's text
// goes to stdout; the scoreboard and progress notes go to stderr.

type Prompt = Parameters<OpencodeClient["session"]["prompt"]>[0]
type Create = NonNullable<Parameters<OpencodeClient["session"]["create"]>[0]>
type Worktree = NonNullable<Awaited<ReturnType<OpencodeClient["worktree"]["create"]>>["data"]>

export interface Contender {
  label: string
  model: Model
  worktree?: Worktree
  sessionID?: string
  text?: string
  diff?: string
  error?: string
}

// Parses the comma-separated provider/model list for arena. Unlike --best-of,
// duplicates are allowed: racing the same model against itself in separate
// worktrees is a legitimate arena setup.
export function parseModels(value: string): Model[] | string {
  const entries = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (entries.length < 2) return "--models needs at least two comma-separated provider/model entries"
  if (entries.length > LIMIT) return `--models supports at most ${LIMIT} entries`
  const invalid = entries.find((item) => {
    const slash = item.indexOf("/")
    return slash <= 0 || slash === item.length - 1
  })
  if (invalid) return `--models entries must be in provider/model format, got: ${invalid}`
  return entries.map((item) => {
    const [providerID, ...rest] = item.split("/")
    return { providerID, modelID: rest.join("/") } as Model
  })
}

const READY_TIMEOUT = 5 * 60 * 1000
const DIFF_LIMIT = 20_000

// Watches GlobalBus for worktree boot results, keyed by worktree directory.
// The listener attaches before any worktree is created so a fast boot cannot
// slip past it; results are buffered until someone waits for them.
function watcher() {
  const results = new Map<string, string | undefined>()
  const waiters = new Map<string, (error?: string) => void>()
  const handler = (event: GlobalEvent) => {
    const dir = event.directory
    if (!dir) return
    const type = event.payload?.type
    if (type !== "worktree.ready" && type !== "worktree.failed") return
    const error =
      type === "worktree.failed" ? String(event.payload?.properties?.message ?? "worktree boot failed") : undefined
    const waiter = waiters.get(dir)
    if (waiter) {
      waiters.delete(dir)
      waiter(error)
      return
    }
    results.set(dir, error)
  }
  GlobalBus.on("event", handler)
  return {
    wait(directory: string) {
      return new Promise<void>((resolve, reject) => {
        const settle = (error?: string) => (error === undefined ? resolve() : reject(new Error(error)))
        if (results.has(directory)) {
          const error = results.get(directory)
          results.delete(directory)
          settle(error)
          return
        }
        const timer = setTimeout(() => {
          waiters.delete(directory)
          reject(new Error(`worktree boot timed out after ${READY_TIMEOUT / 1000}s`))
        }, READY_TIMEOUT)
        waiters.set(directory, (error) => {
          clearTimeout(timer)
          settle(error)
        })
      })
    },
    dispose() {
      GlobalBus.off("event", handler)
    },
  }
}

// Captures what the agent actually changed in its worktree. `add -N` records
// intent-to-add so new files show up in the diff; the worktree is disposable
// so mutating its index is fine.
async function capture(directory: string) {
  await Bun.spawn(["git", "add", "-N", "."], { cwd: directory, stdout: "ignore", stderr: "ignore" }).exited
  const proc = Bun.spawn(["git", "diff"], { cwd: directory, stdout: "pipe", stderr: "ignore" })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  if (text.length <= DIFF_LIMIT) return text
  return `${text.slice(0, DIFF_LIMIT)}\n... (diff truncated at ${DIFF_LIMIT} characters)`
}

export async function runArena(input: {
  sdk: OpencodeClient
  client: (directory: string) => OpencodeClient
  models: Model[]
  judge: Model
  message: string
  parts: Parts
  agent?: string
  variant?: string
  permission: Create["permission"]
  json: boolean
  cleanup: boolean
}): Promise<number> {
  const note = (text: string) => {
    if (!input.json) UI.println(UI.Style.TEXT_DIM + text + UI.Style.TEXT_NORMAL)
  }

  const answer = (result: Awaited<ReturnType<OpencodeClient["session"]["prompt"]>>) =>
    (result.data?.parts ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n")

  const events = watcher()

  const attempt = async (model: Model, label: string): Promise<Contender> => {
    const created = await input.sdk.worktree.create({
      worktreeCreateInput: { name: `arena-${label.toLowerCase()}` },
    })
    const worktree = created.data
    if (!worktree)
      return { label, model, error: created.error ? JSON.stringify(created.error) : "failed to create worktree" }
    const boot = await events
      .wait(worktree.directory)
      .then(() => undefined)
      .catch((err) => String(err))
    if (boot) return { label, model, worktree, error: boot }
    note(`${label} · ${format(model)} worktree ready at ${worktree.directory}`)

    const sdk = input.client(worktree.directory)
    const session = await sdk.session.create({
      title: `arena ${label}: ${format(model)}`,
      permission: input.permission,
    })
    const id = session.data?.id
    if (!id) return { label, model, worktree, error: "failed to create session" }
    const result = await sdk.session.prompt({
      sessionID: id,
      model,
      agent: input.agent,
      variant: input.variant,
      parts: input.parts,
    })
    if (result.error) return { label, model, worktree, sessionID: id, error: JSON.stringify(result.error) }
    const diff = await capture(worktree.directory).catch(() => "")
    note(`${label} · ${format(model)} finished`)
    return { label, model, worktree, sessionID: id, text: answer(result), diff }
  }

  note(`arena: racing ${input.models.length} agents in isolated worktrees, judged by ${format(input.judge)}`)
  const settled = await Promise.all(
    input.models.map((model, i) =>
      attempt(model, LABELS[i]).catch((err): Contender => ({ label: LABELS[i], model, error: String(err) })),
    ),
  ).finally(() => events.dispose())
  const done = settled.filter((item): item is Contender & { text: string } => item.text !== undefined)

  const summary = (item: Contender) => ({
    label: item.label,
    model: format(item.model),
    sessionID: item.sessionID,
    worktree: item.worktree ? { directory: item.worktree.directory, branch: item.worktree.branch } : undefined,
    error: item.error,
  })

  if (done.length === 0) {
    if (input.json) {
      process.stdout.write(
        JSON.stringify({ type: "arena", timestamp: Date.now(), candidates: settled.map(summary) }) + EOL,
      )
      return 1
    }
    settled.forEach((item) => UI.error(`${item.label} · ${format(item.model)}: ${item.error}`))
    return 1
  }

  // The judge sees the final answer plus the code diff so it can rank on what
  // was actually built, not just what was claimed.
  const exhibit = (item: Contender & { text: string }) => {
    const diff = item.diff?.trim()
    if (!diff) return { label: item.label, text: item.text }
    return { label: item.label, text: `${item.text}\n\n#### Diff\n\n\`\`\`diff\n${diff}\n\`\`\`` }
  }

  const verdict = await (async () => {
    if (done.length === 1) return { order: [done[0].label], sessionID: undefined }
    const session = await input.sdk.session.create({
      title: `arena judge: ${format(input.judge)}`,
      permission: input.permission,
    })
    const id = session.data?.id
    if (!id) return undefined
    // --variant is contender-specific (provider reasoning effort); the judge
    // may be a different provider that rejects it, so prompt the judge plain.
    const result = await input.sdk.session.prompt({
      sessionID: id,
      model: input.judge,
      parts: [{ type: "text", text: judgePrompt(input.message, done.map(exhibit)) }],
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
  const winner = ranked.get(order[0]) ?? done[0]

  if (input.cleanup) {
    const losers = settled.filter(
      (item): item is Contender & { worktree: Worktree } => item.label !== winner.label && item.worktree !== undefined,
    )
    const removed = await Promise.all(
      losers.map((item) =>
        input.sdk.worktree
          .remove({ worktreeRemoveInput: { directory: item.worktree.directory } })
          .then((result) => !result.error)
          .catch(() => false),
      ),
    )
    const count = removed.filter(Boolean).length
    if (count) note(`cleaned up ${count} losing worktree${count === 1 ? "" : "s"}`)
    losers.filter((_, i) => !removed[i]).forEach((item) => note(`could not remove worktree ${item.worktree.directory}`))
  }

  if (input.json) {
    process.stdout.write(
      JSON.stringify({
        type: "arena",
        timestamp: Date.now(),
        winner: { ...summary(winner), text: winner.text },
        ranking: order,
        judge: { model: format(input.judge), sessionID: verdict?.sessionID },
        candidates: settled.map(summary),
      }) + EOL,
    )
    return 0
  }

  UI.empty()
  order.forEach((label, i) => {
    const item = ranked.get(label)
    if (!item) return
    const marker = i === 0 ? `${UI.Style.TEXT_SUCCESS}★` : `${UI.Style.TEXT_DIM}${i + 1}.`
    UI.println(
      `${marker} ${label} · ${format(item.model)} ${UI.Style.TEXT_DIM}${item.sessionID}${UI.Style.TEXT_NORMAL}`,
    )
    if (item.worktree) {
      UI.println(
        `  ${UI.Style.TEXT_DIM}${item.worktree.directory}${item.worktree.branch ? ` (${item.worktree.branch})` : ""}${UI.Style.TEXT_NORMAL}`,
      )
    }
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
