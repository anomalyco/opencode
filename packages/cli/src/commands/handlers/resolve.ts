import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd, fail } from "../effect-cmd"

const LIMIT = 60_000

const INSTRUCTIONS = [
  "You are resolving a git merge conflict by intent, not by picking lines.",
  "The file below contains conflict markers. Understand what each side is trying to accomplish and produce a resolution that preserves the intent of both sides. When the changes are independent, combine them. When they genuinely contradict, prefer the side whose change is more recent and explain why.",
  "First explain each conflict and your resolution in one or two sentences. Then output the complete resolved file in a single fenced code block. The block must contain the entire file with no conflict markers.",
].join("\n")

export type Hunk = {
  readonly ours: string
  readonly theirs: string
  readonly base?: string
  readonly ourl: string
  readonly theirl: string
}

/** Parse conflict-marker hunks out of a conflicted file, including diff3-style base sections. */
export function hunks(text: string) {
  const found: Hunk[] = []
  const lines = text.split("\n")
  let at = 0
  while (at < lines.length) {
    const line = lines[at]
    if (!line.startsWith("<<<<<<<")) {
      at += 1
      continue
    }
    const ourl = line.slice(7).trim()
    const ours: string[] = []
    const base: string[] = []
    const theirs: string[] = []
    let section = "ours"
    let closed = false
    at += 1
    while (at < lines.length && !closed) {
      const current = lines[at]
      if (current.startsWith("|||||||") && section === "ours") {
        section = "base"
        at += 1
        continue
      }
      if (current.startsWith("=======") && section !== "theirs") {
        section = "theirs"
        at += 1
        continue
      }
      if (current.startsWith(">>>>>>>") && section === "theirs") {
        found.push({
          ours: ours.join("\n"),
          theirs: theirs.join("\n"),
          ...(base.length ? { base: base.join("\n") } : {}),
          ourl,
          theirl: current.slice(7).trim(),
        })
        closed = true
        at += 1
        continue
      }
      if (section === "ours") ours.push(current)
      if (section === "base") base.push(current)
      if (section === "theirs") theirs.push(current)
      at += 1
    }
  }
  return found
}

/** Parse unmerged paths out of `git status --porcelain=v1` output. */
export function unmerged(text: string) {
  const codes = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"]
  return text
    .split("\n")
    .filter((line) => codes.includes(line.slice(0, 2)))
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
}

/** Extract the resolved file content from the last fenced code block of an agent response. */
export function merged(text: string) {
  const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
  const last = blocks.at(-1)
  if (!last) return undefined
  const content = last[1]
  if (!content.trim()) return undefined
  if (/^(<{7}|={7}$|>{7}|\|{7})/mu.test(content)) return undefined
  return content.endsWith("\n") ? content : `${content}\n`
}

export const ResolveCommand = effectCmd({
  command: "resolve [file..]",
  describe: "resolve merge conflicts by intent with the agent",
  builder: (yargs) =>
    yargs
      .positional("file", {
        type: "string",
        array: true,
        default: [] as string[],
        describe: "conflicted files to resolve (defaults to every unmerged file)",
      })
      .option("apply", {
        type: "boolean",
        default: false,
        describe: "write resolutions to the worktree and stage them",
      })
      .option("model", {
        alias: "m",
        type: "string",
        describe: "model to use in the format of provider/model",
      }),
  handler: Effect.fn("Cli.resolve")(function* (args) {
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { Git } = yield* Effect.promise(() => import("@/git"))
    const ctx = yield* InstanceRef
    if (!ctx) return yield* fail("Could not load instance context")
    if (ctx.project.vcs !== "git") {
      return yield* fail("Could not find git repository. Please run this command from a git repository.")
    }
    const git = yield* Git.Service
    const cwd = ctx.worktree

    const status = yield* git.run(["status", "--porcelain=v1"], { cwd })
    if (status.exitCode !== 0) return yield* fail(status.stderr.toString().trim() || "git status failed")
    const conflicted = unmerged(status.text())
    const wanted: string[] = args.file.filter((entry: unknown): entry is string => typeof entry === "string")
    const files: string[] = wanted.length ? wanted : conflicted
    if (!files.length) {
      UI.println("No merge conflicts to resolve.")
      return
    }
    const unknown = files.filter((file) => !conflicted.includes(file))
    if (unknown.length) return yield* fail(`Not unmerged: ${unknown.join(", ")}`)

    const { Session } = yield* Effect.promise(() => import("@/session/session"))
    const { SessionPrompt } = yield* Effect.promise(() => import("@/session/prompt"))
    const { MessageID, PartID } = yield* Effect.promise(() => import("../../session/schema"))
    const { parseModel } = yield* Effect.promise(() => import("@/provider/provider"))
    const { extractResponseText } = yield* Effect.promise(() => import("./github.shared"))
    const { join } = yield* Effect.promise(() => import("node:path"))
    const sessions = yield* Session.Service
    const prompt = yield* SessionPrompt.Service
    const session = yield* sessions.create({
      title: `bolt resolve: ${files.join(", ")}`,
      permission: [
        { permission: "question", action: "deny", pattern: "*" },
        { permission: "plan_enter", action: "deny", pattern: "*" },
        { permission: "plan_exit", action: "deny", pattern: "*" },
      ],
    })

    const failures: string[] = []
    yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const absolute = join(cwd, file)
        const content = yield* Effect.promise(() => Bun.file(absolute).text())
        if (content.length > LIMIT) {
          failures.push(`${file}: too large to resolve in one shot`)
          return
        }
        const found = hunks(content)
        if (!found.length) {
          failures.push(`${file}: no conflict markers found`)
          return
        }

        UI.println(`Resolving ${file} (${found.length} conflict${found.length === 1 ? "" : "s"})...`)
        const result = yield* prompt
          .prompt({
            sessionID: session.id,
            messageID: MessageID.ascending(),
            model: args.model ? parseModel(args.model) : undefined,
            parts: [
              {
                id: PartID.ascending(),
                type: "text",
                text: `${INSTRUCTIONS}\n\nFile: ${file}\nOurs: ${found[0].ourl}\nTheirs: ${found[0].theirl}\n\n\`\`\`\n${content}\n\`\`\``,
              },
            ],
          })
          .pipe(Effect.orDie)

        if (result.info.role === "assistant" && result.info.error) {
          const err = result.info.error
          const message = "message" in err.data ? err.data.message : ""
          failures.push(`${file}: ${err.name}: ${message}`)
          return
        }

        const text = extractResponseText(result.parts) ?? ""
        const resolution = merged(text)
        if (!resolution) {
          failures.push(`${file}: the model did not return a clean resolution`)
          return
        }

        const opening = text.lastIndexOf("```", text.lastIndexOf("```") - 1)
        const explanation = opening > 0 ? text.slice(0, opening).trim() : ""
        UI.empty()
        UI.println(UI.markdown(explanation || `Resolved ${file}.`))
        UI.empty()

        if (!args.apply) {
          UI.println(`Proposed resolution for ${file} (rerun with --apply to write and stage it):`)
          UI.println(resolution)
          return
        }

        yield* Effect.promise(() => Bun.write(absolute, resolution))
        const added = yield* git.run(["add", "--", file], { cwd })
        if (added.exitCode !== 0) {
          failures.push(`${file}: resolved but failed to stage: ${added.stderr.toString().trim()}`)
          return
        }
        UI.println(`Resolved and staged ${file}.`)
      }),
    )

    if (!failures.length) return
    UI.empty()
    return yield* fail(failures.join("\n"))
  }),
})
