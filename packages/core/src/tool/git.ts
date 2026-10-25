import { Effect, Schema, Stream } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import DESCRIPTION from "./git.txt"

const MAX_PATCH = 40_000
const DEFAULT_LOG_COUNT = 20

// %x1f/%x1e are unit/record separators; they cannot appear in commit subjects
// or author names, so splitting on them is unambiguous.
const LOG_FORMAT = "%H%x1f%an%x1f%aI%x1f%s%x1e"

export type StatusEntry = {
  path: string
  status: string
  from?: string
}

/** Human-readable name for a porcelain v2 status letter. */
function statusName(letter: string) {
  if (letter === "M") return "modified"
  if (letter === "A") return "added"
  if (letter === "D") return "deleted"
  if (letter === "R") return "renamed"
  if (letter === "C") return "copied"
  if (letter === "T") return "typechange"
  return letter
}

/**
 * Parse `git status --porcelain=v2 -z` output into staged/unstaged/untracked
 * buckets. Rename and copy records ("2") carry the original path in the next
 * NUL-separated token.
 */
export function parseStatus(text: string) {
  const tokens = text.split("\0").filter((token) => token.length > 0)
  const staged: StatusEntry[] = []
  const unstaged: StatusEntry[] = []
  const untracked: string[] = []
  let index = 0
  while (index < tokens.length) {
    const record = tokens[index]
    index++
    if (record.startsWith("? ")) {
      untracked.push(record.slice(2))
      continue
    }
    if (record.startsWith("1 ")) {
      const fields = record.split(" ")
      const xy = fields[1]
      const file = fields.slice(8).join(" ")
      if (xy[0] !== ".") staged.push({ path: file, status: statusName(xy[0]) })
      if (xy[1] !== ".") unstaged.push({ path: file, status: statusName(xy[1]) })
      continue
    }
    if (record.startsWith("2 ")) {
      const fields = record.split(" ")
      const xy = fields[1]
      const file = fields.slice(9).join(" ")
      const from = tokens[index]
      index++
      if (xy[0] !== ".") staged.push({ path: file, status: statusName(xy[0]), from })
      if (xy[1] !== ".") unstaged.push({ path: file, status: statusName(xy[1]), from })
      continue
    }
    if (record.startsWith("u ")) {
      const fields = record.split(" ")
      unstaged.push({ path: fields.slice(10).join(" "), status: "conflicted" })
      continue
    }
  }
  return { staged, unstaged, untracked }
}

export type FilePatch = {
  file: string
  hunks: number
  additions: number
  deletions: number
}

/** Summarize unified diff text into per-file hunk and line-change counts. */
export function parsePatch(text: string): FilePatch[] {
  const files: FilePatch[] = []
  for (const line of text.split("\n")) {
    const header = line.match(/^diff --git a\/.* b\/(.*)$/)
    if (header) {
      files.push({ file: header[1], hunks: 0, additions: 0, deletions: 0 })
      continue
    }
    const current = files[files.length - 1]
    if (!current) continue
    if (line.startsWith("@@")) {
      current.hunks++
      continue
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions++
      continue
    }
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions++
  }
  return files
}

export type LogEntry = {
  sha: string
  author: string
  date: string
  subject: string
}

/** Parse log output produced with LOG_FORMAT into structured entries. */
export function parseLog(text: string): LogEntry[] {
  return text
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const fields = record.split("\x1f")
      return { sha: fields[0] ?? "", author: fields[1] ?? "", date: fields[2] ?? "", subject: fields[3] ?? "" }
    })
    .filter((entry) => entry.sha.length > 0)
}

export type BlameLine = {
  line: number
  sha: string
  author: string
  content: string
}

/**
 * Parse `git blame --porcelain` output into per-line attributions. Commit
 * headers (author, etc.) appear once per sha, so they are cached and reused
 * for later lines attributed to the same commit.
 */
export function parseBlame(text: string): BlameLine[] {
  const authors = new Map<string, string>()
  const out: BlameLine[] = []
  let sha = ""
  let final = 0
  for (const line of text.split("\n")) {
    if (line.startsWith("\t")) {
      out.push({ line: final, sha, author: authors.get(sha) ?? "", content: line.slice(1) })
      continue
    }
    const header = line.match(/^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/)
    if (header) {
      sha = header[1]
      final = Number(header[2])
      continue
    }
    if (line.startsWith("author ")) authors.set(sha, line.slice("author ".length))
  }
  return out
}

function cap(text: string) {
  if (text.length <= MAX_PATCH) return text
  return `${text.slice(0, MAX_PATCH)}\n(truncated: showing first ${MAX_PATCH} of ${text.length} characters)`
}

function renderStatusEntry(entry: StatusEntry) {
  if (entry.from) return `- ${entry.status} ${entry.path} (from ${entry.from})`
  return `- ${entry.status} ${entry.path}`
}

function renderFilePatch(file: FilePatch) {
  return `- ${file.file} (${file.hunks} hunk${file.hunks === 1 ? "" : "s"}, +${file.additions} -${file.deletions})`
}

export const Parameters = Schema.Struct({
  action: Schema.Literals(["status", "diff", "log", "blame", "show"]).annotate({
    description: "The git query to run",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Optional file or directory to scope diff/log to. Required for blame.",
  }),
  staged: Schema.optional(Schema.Boolean).annotate({
    description: "For diff: compare the index against HEAD instead of the working tree",
  }),
  count: Schema.optional(Schema.Number).annotate({
    description: `For log: number of commits to return (default ${DEFAULT_LOG_COUNT})`,
  }),
  sha: Schema.optional(Schema.String).annotate({ description: "For show: the commit sha (or any revision) to show" }),
  start: Schema.optional(Schema.Number).annotate({ description: "For blame: first line of the range (1-indexed)" }),
  end: Schema.optional(Schema.Number).annotate({ description: "For blame: last line of the range (inclusive)" }),
})

type Metadata = { [key: string]: unknown }

export const GitTool = Tool.define(
  "git",
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner

    const run = Effect.fnUntraced(
      function* (args: string[], cwd: string) {
        const handle = yield* spawner.spawn(ChildProcess.make("git", args, { cwd, extendEnv: true, stdin: "ignore" }))
        const collected = yield* Effect.all(
          [Stream.mkString(Stream.decodeText(handle.stdout)), Stream.mkString(Stream.decodeText(handle.stderr))],
          { concurrency: 2 },
        )
        const code = yield* handle.exitCode
        if (code !== 0) {
          throw new Error(`git ${args[0]} failed (exit ${code}): ${collected[1].trim() || collected[0].trim()}`)
        }
        return collected[0]
      },
      Effect.scoped,
      Effect.orDie,
    )

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ): Effect.Effect<Tool.ExecuteResult<Metadata>> =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const cwd = instance.directory

          if (params.action === "status") {
            const parsed = parseStatus(yield* run(["status", "--porcelain=v2", "-z"], cwd))
            const lines: string[] = []
            if (parsed.staged.length) lines.push("staged:", ...parsed.staged.map(renderStatusEntry))
            if (parsed.unstaged.length) lines.push("unstaged:", ...parsed.unstaged.map(renderStatusEntry))
            if (parsed.untracked.length) lines.push("untracked:", ...parsed.untracked.map((file) => `- ${file}`))
            return {
              title: "git status",
              output: lines.length ? lines.join("\n") : "working tree clean",
              metadata: {
                staged: parsed.staged.length,
                unstaged: parsed.unstaged.length,
                untracked: parsed.untracked.length,
              },
            }
          }

          if (params.action === "diff") {
            const args = ["diff", ...(params.staged ? ["--cached"] : []), ...(params.path ? ["--", params.path] : [])]
            const patch = yield* run(args, cwd)
            const files = parsePatch(patch)
            if (files.length === 0) {
              return {
                title: `git diff${params.staged ? " --cached" : ""}`,
                output: "no changes",
                metadata: { files: 0, staged: params.staged ?? false },
              }
            }
            const additions = files.reduce((acc, file) => acc + file.additions, 0)
            const deletions = files.reduce((acc, file) => acc + file.deletions, 0)
            return {
              title: `git diff${params.staged ? " --cached" : ""} (${files.length} file${files.length === 1 ? "" : "s"})`,
              output: [
                `files changed: ${files.length} (+${additions} -${deletions})`,
                ...files.map(renderFilePatch),
                "",
                cap(patch),
              ].join("\n"),
              metadata: { files: files.length, additions, deletions, staged: params.staged ?? false },
            }
          }

          if (params.action === "log") {
            const count = params.count ?? DEFAULT_LOG_COUNT
            const args = [
              "log",
              "-n",
              String(count),
              `--format=${LOG_FORMAT}`,
              ...(params.path ? ["--", params.path] : []),
            ]
            const entries = parseLog(yield* run(args, cwd))
            return {
              title: `git log (${entries.length} commit${entries.length === 1 ? "" : "s"})`,
              output: entries.length
                ? entries
                    .map((entry) => `${entry.sha.slice(0, 8)} ${entry.date} ${entry.author}: ${entry.subject}`)
                    .join("\n")
                : "no commits",
              metadata: { entries },
            }
          }

          if (params.action === "blame") {
            if (!params.path) throw new Error("blame requires the path parameter")
            const range = params.start !== undefined && params.end !== undefined
            const args = [
              "blame",
              "--porcelain",
              ...(range ? ["-L", `${params.start},${params.end}`] : []),
              "--",
              params.path,
            ]
            const lines = parseBlame(yield* run(args, cwd))
            return {
              title: `git blame ${params.path}`,
              output: lines.length
                ? lines
                    .map(
                      (line) =>
                        `${String(line.line).padStart(5)} ${line.sha.slice(0, 8)} ${line.author}: ${line.content}`,
                    )
                    .join("\n")
                : "no lines",
              metadata: { lines: lines.length, path: params.path },
            }
          }

          if (!params.sha) throw new Error("show requires the sha parameter")
          const meta = parseLog(yield* run(["show", "-s", `--format=${LOG_FORMAT}`, params.sha], cwd))
          const entry = meta[0]
          if (!entry) throw new Error(`no commit found for ${params.sha}`)
          const patch = yield* run(["show", "--format=", "--patch", params.sha], cwd)
          const files = parsePatch(patch)
          return {
            title: `git show ${entry.sha.slice(0, 8)}`,
            output: [
              `commit ${entry.sha}`,
              `author ${entry.author}`,
              `date ${entry.date}`,
              `subject ${entry.subject}`,
              "",
              ...files.map(renderFilePatch),
              "",
              cap(patch),
            ].join("\n"),
            metadata: { sha: entry.sha, files: files.length },
          }
        }),
    }
  }),
)
