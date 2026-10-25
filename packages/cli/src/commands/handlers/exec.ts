import type { PermissionV1 } from "@bolt-ai/core/v1/permission"
import path from "path"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

export interface Step {
  title: string
  body: string
}

/**
 * Parse a markdown playbook into ordered steps. Level-2+ headings each start a
 * step (any preamble before the first heading is ignored). When the document
 * has no headings, top-level list items (`-`, `*`, `+`, `1.`, including task
 * checkboxes) become the steps instead. Markers inside fenced code blocks are
 * ignored.
 */
export function steps(markdown: string): Step[] {
  const lines = markdown.split("\n")
  const fences: boolean[] = []
  let fence: string | undefined
  for (const line of lines) {
    if (fence) {
      fences.push(true)
      const closing = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1]
      if (closing && closing[0] === fence[0] && closing.length >= fence.length) fence = undefined
      continue
    }
    fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    fences.push(Boolean(fence))
  }

  const heading = /^#{2,6}\s+(.+)$/
  const item = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+)$/

  const found: Step[] = []
  const hasHeading = lines.some((line, index) => !fences[index] && heading.test(line))
  const marker = hasHeading ? heading : item
  for (const [index, line] of lines.entries()) {
    const match = fences[index] ? null : line.match(marker)
    if (match) {
      found.push({ title: match[1].trim(), body: "" })
      continue
    }
    const last = found.at(-1)
    if (!last) continue
    if (!hasHeading && !fences[index] && /^\S/.test(line) && line.trim() !== "") continue
    last.body = last.body ? `${last.body}\n${line}` : line
  }
  return found.map((step) => ({ title: step.title, body: step.body.trim() })).filter((step) => step.title.length > 0)
}

/**
 * Parse the step outcome marker from the final non-empty line of an agent
 * response. Markers quoted or embedded mid-response do not count; the prompt
 * contract requires the response to end with the marker.
 */
export function outcome(text: string) {
  const match = /^step:\s*(done|failed)\s*$/i.exec(text.trimEnd().split("\n").at(-1) ?? "")
  if (!match) return undefined
  return match[1].toLowerCase() as "done" | "failed"
}

/** Prompt sent for one playbook step. */
export function prompt(step: Step, index: number, total: number) {
  return [
    `You are executing step ${index} of ${total} from a playbook, in order. Complete only this step, then stop.`,
    'End your final message with exactly one line: "Step: DONE" if the step was completed, or "Step: FAILED" if it could not be completed.',
    "",
    `Step ${index}: ${step.title}`,
    ...(step.body ? ["", step.body] : []),
  ].join("\n")
}

// Headless execution: never ask questions, never enter plan mode, and
// auto-approve edit/bash so a playbook step never blocks on a permission ask.
const RULES: PermissionV1.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
  { permission: "edit", action: "allow", pattern: "*" },
  { permission: "bash", action: "allow", pattern: "*" },
]

export const ExecCommand = effectCmd({
  command: "exec",
  describe: "run a markdown playbook of steps non-interactively, stopping on the first failure",
  builder: (yargs) =>
    yargs
      .option("file", {
        alias: "f",
        type: "string",
        demandOption: true,
        describe: "markdown playbook file to execute",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use for every step",
      }),
  handler: Effect.fn("Cli.exec")(function* (args) {
    const file = Bun.file(path.resolve(process.cwd(), args.file))
    const exists = yield* Effect.promise(() => file.exists())
    if (!exists) return yield* fail(`Playbook not found: ${args.file}`)
    const markdown = yield* Effect.promise(() => file.text())
    const list = steps(markdown)
    if (list.length === 0) {
      return yield* fail("No steps found in the playbook. Use level-2 headings or top-level list items.")
    }

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const sessions = yield* Session.Service
    const prompter = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: `bolt exec ${path.basename(args.file)}`,
      permission: [...RULES],
    })

    for (const [index, step] of list.entries()) {
      const position = `${index + 1}/${list.length}`
      UI.println(`── step ${position}: ${step.title} ──`)
      const result = yield* prompter
        .prompt({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          agent: args.agent,
          model: args.model ? parseModel(args.model) : undefined,
          parts: [{ id: PartID.ascending(), type: "text", text: prompt(step, index + 1, list.length) }],
        })
        .pipe(Effect.orDie)

      if (result.info.role === "assistant" && result.info.error) {
        const err = result.info.error
        const message = "message" in err.data ? err.data.message : ""
        return yield* fail(`Step ${position} failed: ${err.name}: ${message}`)
      }

      const text = extractResponseText(result.parts) ?? ""
      if (!text) return yield* fail(`Step ${position} returned an empty response.`)

      UI.empty()
      UI.println(UI.markdown(text))
      UI.empty()

      const verdict = outcome(text)
      if (verdict === "failed") return yield* fail(`Step ${position} reported failure; stopping the playbook.`)
      if (verdict === undefined) {
        return yield* fail(`Could not determine the outcome of step ${position}; stopping the playbook.`, 2)
      }
    }

    UI.println(`Completed ${list.length} step${list.length === 1 ? "" : "s"}.`)
  }),
})
