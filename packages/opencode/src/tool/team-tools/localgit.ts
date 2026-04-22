import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { Tool } from "../shared/tool"
import { Instance } from "@/project/instance"
import { Process } from "@/util/process"
import { blank, seen, zero } from "../shared/shape"

const limit = z.coerce.number().int().min(1).max(200)

const state_mode = z.enum(["status", "diff"])
const log_mode = z.enum(["log", "show", "refs", "ahead_behind", "merge_base"])
const annotate_mode = z.enum(["blame", "grep", "pickaxe", "regex"])
const localgit_state_action = z.enum(["repo", "status", "diff"])
const localgit_log_action = z.enum(["history", "show", "file_history", "refs", "ahead_behind", "merge_base"])
const localgit_annotate_action = z.enum(["blame", "line", "range", "grep", "pickaxe", "regex"])

const status_input = z.object({
  path: z
    .string()
    .optional()
    .describe("Optional file or directory inside the current worktree to narrow the status view."),
})

const diff_input = z.object({
  path: z.string().optional().describe("Optional file or directory inside the current worktree to narrow the diff."),
  staged: z.boolean().optional().describe("Show staged changes instead of unstaged changes."),
  base: z.string().optional().describe("Optional base ref to diff from."),
  head: z.string().optional().describe("Optional head ref when comparing two refs."),
  stat: z.boolean().optional().describe("Show diffstat instead of full patch output."),
  name_only: z.boolean().optional().describe("Show changed file names only."),
})

const state_input = z
  .object({
    mode: z.preprocess(blank, state_mode.optional()).describe("Git state mode: working tree status or diff output."),
    path: z
      .string()
      .optional()
      .describe("Optional file or directory inside the current worktree to narrow the state view."),
    staged: z.boolean().optional().describe("Show staged changes instead of unstaged changes in diff mode."),
    base: z.string().optional().describe("Optional base ref to diff from in diff mode."),
    head: z.string().optional().describe("Optional head ref when comparing two refs in diff mode."),
    stat: z.boolean().optional().describe("Show diffstat instead of full patch output in diff mode."),
    name_only: z.boolean().optional().describe("Show changed file names only in diff mode."),
    porcelain: z
      .boolean()
      .optional()
      .describe("Use porcelain v2 output in status mode. Defaults to true when omitted."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const forbid = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not valid when mode=${value.mode}`,
        })
      }
    }
    if ((value.mode ?? "status") === "status") {
      forbid(["staged", "base", "head", "stat", "name_only"])
      return
    }
    if (value.head && !value.base) {
      ctx.addIssue({
        code: "custom",
        path: ["head"],
        message: "head requires base when mode=diff",
      })
    }
    forbid(["porcelain"])
  })

const log_input = z
  .object({
    mode: z.preprocess(blank, log_mode.optional()).describe("Git history mode to run."),
    path: z.string().optional().describe("Optional file or directory inside the current worktree to narrow log mode."),
    ref: z.string().optional().describe("Optional ref or branch to inspect. Required in show mode."),
    limit: limit.optional().describe("Maximum number of commits or refs to return."),
    stat: z.boolean().optional().describe("Include diffstat in log or show mode."),
    name_only: z.boolean().optional().describe("Show changed file names in show mode."),
    base: z.string().optional().describe("Base ref for ahead_behind or merge_base mode."),
    head: z.string().optional().describe("Head ref for ahead_behind or merge_base mode. Defaults to HEAD."),
    since: z.string().optional().describe("Optional lower date bound for log mode."),
    until: z.string().optional().describe("Optional upper date bound for log mode."),
    all: z.boolean().optional().describe("Search across all refs in log mode."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when mode=${value.mode}`,
        })
      }
    }
    const forbid = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not valid when mode=${value.mode}`,
        })
      }
    }
    if ((value.mode ?? "log") === "log") {
      forbid(["name_only", "base", "head"])
      return
    }
    if (value.mode === "show") {
      need(["ref"])
      forbid(["path", "base", "head"])
      return
    }
    if (value.mode === "refs") {
      forbid(["path", "ref", "stat", "name_only", "base", "head"])
      return
    }
    need(["base"])
    forbid(["path", "ref", "stat", "name_only"])
  })

const show_input = z.object({
  ref: z.string().min(1).describe("Commit, tag, or revision expression to show."),
  stat: z.boolean().optional().describe("Include diffstat."),
  name_only: z.boolean().optional().describe("Show changed file names only."),
})

const annotate_input = z
  .object({
    mode: annotate_mode.describe("Git annotate mode to run."),
    filePath: z.string().optional().describe("File path for blame mode."),
    path: z.string().optional().describe("Optional file or directory filter for grep, pickaxe, or regex mode."),
    line: z.coerce.number().int().min(1).optional().describe("Starting line for blame mode."),
    end: z.coerce.number().int().min(1).optional().describe("Ending line for blame mode. Defaults to line."),
    pattern: z.string().optional().describe("Pattern or literal text to search for in grep, pickaxe, or regex mode."),
    ref: z.string().optional().describe("Optional ref to inspect. Defaults to HEAD where applicable."),
    limit: limit.optional().describe("Maximum number of matches or commits to return."),
    case_sensitive: z.boolean().optional().describe("Case-sensitive grep matching."),
    since: z.string().optional().describe("Optional lower date bound for pickaxe or regex history search."),
    until: z.string().optional().describe("Optional upper date bound for pickaxe or regex history search."),
    all: z.boolean().optional().describe("Search across all refs where supported by pickaxe or regex mode."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when mode=${value.mode}`,
        })
      }
    }
    const forbid = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not valid when mode=${value.mode}`,
        })
      }
    }
    if (value.end && (!value.line || value.end < value.line)) {
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "end must be greater than or equal to line",
      })
    }
    if (value.mode === "blame") {
      need(["filePath", "line"])
      forbid(["path", "pattern", "ref", "case_sensitive", "since", "until", "all"])
      return
    }
    need(["pattern"])
    forbid(["filePath", "line", "end"])
    if (value.mode === "grep") forbid(["since", "until", "all"])
    if (value.mode !== "grep") forbid(["case_sensitive"])
  })

export const LocalGitStateParametersSchema = z
  .object({
    action: localgit_state_action.describe("Repository state action to run."),
    path: z.string().optional().describe("Optional file or directory inside the current worktree to narrow the view."),
    staged: z.boolean().optional().describe("Show staged changes instead of unstaged changes in diff action."),
    base: z.string().optional().describe("Optional base ref to diff from in diff action."),
    head: z.string().optional().describe("Optional head ref when comparing two refs in diff action."),
    stat: z.boolean().optional().describe("Show diffstat instead of full patch output in diff action."),
    name_only: z.boolean().optional().describe("Show changed file names only in diff action."),
    porcelain: z.boolean().optional().describe("Use porcelain v2 output for repo or status actions."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const forbid = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not valid when action=${value.action}`,
        })
      }
    }
    if (value.action === "repo") {
      forbid(["path", "staged", "base", "head", "stat", "name_only"])
      return
    }
    if (value.action === "status") {
      forbid(["staged", "base", "head", "stat", "name_only"])
      return
    }
    if (value.head && !value.base) {
      ctx.addIssue({
        code: "custom",
        path: ["head"],
        message: "head requires base when action=diff",
      })
    }
    forbid(["porcelain"])
  })

export const LocalGitLogParametersSchema = z
  .object({
    action: localgit_log_action.describe("Repository history action to run."),
    path: z
      .string()
      .optional()
      .describe("Optional file or directory inside the current worktree to narrow history or file_history actions."),
    ref: z.string().optional().describe("Optional ref or branch to inspect. Required for show action."),
    limit: limit.optional().describe("Maximum number of commits or refs to return."),
    stat: z.boolean().optional().describe("Include diffstat in history or show action."),
    name_only: z.boolean().optional().describe("Show changed file names in show action."),
    base: z.string().optional().describe("Base ref for ahead_behind or merge_base action."),
    head: z.string().optional().describe("Head ref for ahead_behind or merge_base action. Defaults to HEAD."),
    since: z.string().optional().describe("Optional lower date bound for history or file_history action."),
    until: z.string().optional().describe("Optional upper date bound for history or file_history action."),
    all: z.boolean().optional().describe("Search across all refs in history or file_history action."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when action=${value.action}`,
        })
      }
    }
    const forbid = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not valid when action=${value.action}`,
        })
      }
    }
    if (value.action === "history") {
      forbid(["name_only", "base", "head"])
      return
    }
    if (value.action === "file_history") {
      need(["path"])
      forbid(["name_only", "base", "head"])
      return
    }
    if (value.action === "show") {
      need(["ref"])
      forbid(["path", "base", "head"])
      return
    }
    if (value.action === "refs") {
      forbid(["path", "ref", "stat", "name_only", "base", "head"])
      return
    }
    need(["base"])
    forbid(["path", "ref", "stat", "name_only"])
  })

export const LocalGitAnnotateParametersSchema = z
  .object({
    action: localgit_annotate_action.describe("Repository archaeology action to run."),
    filePath: z.string().optional().describe("File path for blame, line, or range actions."),
    path: z.string().optional().describe("Optional file or directory filter for grep, pickaxe, or regex actions."),
    line: z.coerce.number().int().min(1).optional().describe("Starting line for line or range actions."),
    end: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Ending line for range action. Defaults to line when omitted."),
    pattern: z
      .string()
      .optional()
      .describe("Pattern or literal text to search for in grep, pickaxe, or regex actions."),
    ref: z.string().optional().describe("Optional ref to inspect. Defaults to HEAD where applicable."),
    limit: limit.optional().describe("Maximum number of matches or commits to return."),
    case_sensitive: z.boolean().optional().describe("Case-sensitive grep matching."),
    since: z.string().optional().describe("Optional lower date bound for pickaxe or regex history search."),
    until: z.string().optional().describe("Optional upper date bound for pickaxe or regex history search."),
    all: z.boolean().optional().describe("Search across all refs where supported by pickaxe or regex actions."),
  })
  .strict()
  .superRefine((value, ctx) => {
    const need = (keys: string[]) => {
      for (const key of keys) {
        if (seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is required when action=${value.action}`,
        })
      }
    }
    const forbid = (keys: string[]) => {
      for (const key of keys) {
        if (!seen(value[key as keyof typeof value])) continue
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `${key} is not valid when action=${value.action}`,
        })
      }
    }
    if (value.end && (!value.line || value.end < value.line)) {
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: "end must be greater than or equal to line",
      })
    }
    if (value.action === "blame") {
      need(["filePath"])
      forbid(["path", "pattern", "case_sensitive", "since", "until", "all"])
      return
    }
    if (value.action === "line") {
      need(["filePath", "line"])
      forbid(["path", "pattern", "ref", "case_sensitive", "since", "until", "all"])
      return
    }
    if (value.action === "range") {
      need(["filePath", "line"])
      forbid(["path", "pattern", "ref", "case_sensitive", "since", "until", "all"])
      return
    }
    need(["pattern"])
    forbid(["filePath", "line", "end"])
    if (value.action === "grep") forbid(["since", "until", "all"])
    if (value.action !== "grep") forbid(["case_sensitive"])
  })

const commit_input = z.object({
  message: z
    .string()
    .trim()
    .min(1)
    .describe("Full local commit message. Use a strong subject line and an explanatory body when appropriate."),
  paths: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Exact changed file paths to include in this local commit. Only these paths are committed; do not pass the repository root.",
    ),
})

type StepTool =
  | "git_status"
  | "git_diff"
  | "git_log"
  | "git_show"
  | "git_state"
  | "git_annotate"
  | "localgit_state"
  | "localgit_log"
  | "localgit_annotate"

type Step = {
  tool: StepTool
  title: string
  file?: string
  cmd: string[]
  data?: Record<string, unknown>
}

function permissionFor(tool: StepTool) {
  if (tool.startsWith("localgit_")) return "git_read"
  return tool
}

const empty_tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

function abs(input?: string) {
  if (!input) return undefined
  return path.isAbsolute(input) ? input : path.resolve(Instance.directory, input)
}

function inside(file?: string) {
  if (!file) return
  if (Instance.containsPath(file)) return file
  throw new Error(`Path is outside the current project boundary: ${file}`)
}

function rel(file?: string) {
  if (!file) return
  const out = path.relative(Instance.worktree, file)
  return out || undefined
}

function paths(list: (string | undefined)[]) {
  return [...new Set(list.filter((item): item is string => Boolean(item)))]
}

async function allow(ctx: Tool.Context, permission: string, patterns: string[], metadata: unknown) {
  await ctx.ask({
    permission,
    patterns,
    always: ["*"],
    metadata: typeof metadata === "object" && metadata ? (metadata as Record<string, unknown>) : {},
  })
}

async function call(cmd: string[], ctx: Tool.Context, opts?: { env?: NodeJS.ProcessEnv; nothrow?: boolean }) {
  return Process.text(cmd, {
    cwd: Instance.worktree,
    abort: ctx.abort,
    env: opts?.env,
    stdin: "ignore",
    nothrow: opts?.nothrow ?? true,
  })
}

function lines(text: string) {
  return text.split(/\r?\n/).filter(Boolean)
}

function output(cwd: string, cmd: string[], out: Awaited<ReturnType<typeof call>>) {
  const body = out.text.trim() || out.stderr.toString().trim() || (out.code === 1 ? "No matches found" : "No output")
  return [`cwd: ${cwd}`, `command: ${cmd.join(" ")}`, `exit_code: ${out.code}`, "", body].join("\n")
}

function row(step: Step, out: Awaited<ReturnType<typeof call>>) {
  return {
    title: step.title,
    metadata: {
      cwd: Instance.worktree,
      code: out.code,
      command: step.cmd.join(" "),
      ...step.data,
    },
    output: output(Instance.worktree, step.cmd, out),
  }
}

async function run(step: Step, ctx: Tool.Context, input: unknown) {
  await allow(ctx, permissionFor(step.tool), paths([Instance.worktree, step.file]), input)
  return row(step, await call(step.cmd, ctx))
}

async function maybe_head(ctx: Tool.Context) {
  const out = await call(["git", "rev-parse", "-q", "--verify", "HEAD"], ctx)
  return out.code === 0 ? out.text.trim() || undefined : undefined
}

async function head_ref(ctx: Tool.Context) {
  const out = await call(["git", "symbolic-ref", "-q", "HEAD"], ctx)
  const ref = out.code === 0 ? out.text.trim() : ""
  if (!ref) throw new Error("git_commit requires an attached branch HEAD")
  return ref
}

async function tracked(input: string) {
  try {
    const stat = await fs.stat(input)
    if (stat.isDirectory()) throw new Error(`git_commit requires explicit file paths, not directories: ${input}`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("requires explicit file paths")) throw err
  }
}

async function commit(input: z.infer<typeof commit_input>, ctx: Tool.Context) {
  const files = paths(
    await Promise.all(
      input.paths.map(async (item) => {
        const file = inside(abs(item))
        if (!file) throw new Error("git_commit requires explicit file paths")
        if (path.resolve(file) === path.resolve(Instance.worktree)) {
          throw new Error("git_commit does not allow the repository root; pass exact changed files instead")
        }
        await tracked(file)
        return file
      }),
    ),
  )
  const rels = files.map((file) => rel(file)).filter((item): item is string => Boolean(item))
  await allow(ctx, "git_write", paths([Instance.worktree, ...files]), {
    paths: rels,
    message: input.message,
    mode: "path-scoped local commit",
  })

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-git-commit-"))
  const file = path.join(dir, "message.txt")
  const index = path.join(dir, "index")
  await fs.writeFile(file, input.message)

  const env = { GIT_INDEX_FILE: index }

  try {
    const head = await maybe_head(ctx)
    if (head) {
      const tree = await call(["git", "read-tree", head], ctx, { env })
      if (tree.code !== 0) throw new Error(tree.stderr.toString().trim() || tree.text.trim() || "git read-tree failed")
    }

    const add = await call(["git", "add", "-A", "--", ...rels], ctx, { env })
    if (add.code !== 0) throw new Error(add.stderr.toString().trim() || add.text.trim() || "git add failed")

    if (head) {
      const diff = await call(["git", "diff-index", "--quiet", "--cached", head, "--", ...rels], ctx, {
        env,
      })
      if (diff.code === 0) throw new Error("No changes in the selected paths to commit")
      if (diff.code !== 1) throw new Error(diff.stderr.toString().trim() || diff.text.trim() || "git diff-index failed")
    }

    const tree = await call(["git", "write-tree"], ctx, { env })
    if (tree.code !== 0) throw new Error(tree.stderr.toString().trim() || tree.text.trim() || "git write-tree failed")
    const next = tree.text.trim()
    if (!next || (!head && next === empty_tree)) throw new Error("No changes in the selected paths to commit")

    const cmd = ["git", "commit-tree", next, ...(head ? ["-p", head] : []), "-F", file]
    const made = await call(cmd, ctx)
    if (made.code !== 0) throw new Error(made.stderr.toString().trim() || made.text.trim() || "git commit-tree failed")
    const sha = made.text.trim()
    if (!sha) throw new Error("git commit-tree did not return a commit SHA")

    const ref = await head_ref(ctx)
    const move = await call(["git", "update-ref", ref, sha, ...(head ? [head] : [])], ctx)
    if (move.code !== 0) throw new Error(move.stderr.toString().trim() || move.text.trim() || "git update-ref failed")

    const sync = await call(["git", "reset", "--mixed", "HEAD", "--", ...rels], ctx)
    if (sync.code !== 0) throw new Error(sync.stderr.toString().trim() || sync.text.trim() || "git reset failed")

    const show = await call(["git", "show", "--stat", "--name-status", "--format=fuller", sha], ctx)
    if (show.code !== 0) throw new Error(show.stderr.toString().trim() || show.text.trim() || "git show failed")

    return {
      title: `git commit ${sha.slice(0, 7)}`,
      metadata: {
        cwd: Instance.worktree,
        commit: sha,
        ref,
        paths: rels,
        mode: "path-scoped local commit",
      },
      output: [
        `cwd: ${Instance.worktree}`,
        `ref: ${ref}`,
        `commit: ${sha}`,
        `paths: ${rels.join(", ")}`,
        "",
        show.text.trim(),
      ].join("\n"),
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

function statusStep(
  input: { path?: string },
  tool: StepTool = "git_status",
  opts?: { porcelain?: boolean; title?: string },
): Step {
  const file = inside(abs(input.path))
  const out = rel(file)
  const cmd = opts?.porcelain
    ? ["git", "--no-optional-locks", "status", "--porcelain=v2", "--branch", "--untracked-files=all"]
    : ["git", "status", "--short", "--branch", "--untracked-files=all"]
  if (out) cmd.push("--", out)
  return {
    tool,
    title: opts?.title ?? out ?? path.basename(Instance.worktree),
    file,
    cmd,
    data: {
      mode: opts?.porcelain ? "status" : "status_short",
    },
  }
}

function status(input: z.infer<typeof status_input>): Step {
  return statusStep(input)
}

function diffStep(input: z.infer<typeof diff_input>, tool: StepTool = "git_diff", title?: string): Step {
  const file = inside(abs(input.path))
  const out = rel(file)
  const cmd = ["git", "diff"]
  if (input.staged) cmd.push("--staged")
  if (input.stat) cmd.push("--stat")
  if (input.name_only) cmd.push("--name-only")
  if (input.base && input.head) cmd.push(`${input.base}..${input.head}`)
  else if (input.base) cmd.push(input.base)
  else if (input.head) throw new Error("head requires base for git_diff")
  if (out) cmd.push("--", out)
  return {
    tool,
    title: title ?? out ?? "git diff",
    file,
    cmd,
    data: {
      mode: "diff",
      staged: Boolean(input.staged),
    },
  }
}

function diff(input: z.infer<typeof diff_input>): Step {
  return diffStep(input)
}

function logStep(
  input: { path?: string; ref?: string; limit?: number; stat?: boolean; since?: string; until?: string; all?: boolean },
  tool: StepTool = "git_log",
  title?: string,
): Step {
  const file = inside(abs(input.path))
  const out = rel(file)
  const cmd = ["git", "log", `--max-count=${input.limit ?? 20}`, "--date=iso", "--pretty=format:%H%x09%an%x09%ad%x09%s"]
  if (input.stat) cmd.push("--stat")
  if (input.since) cmd.push(`--since=${input.since}`)
  if (input.until) cmd.push(`--until=${input.until}`)
  if (input.all) cmd.push("--all")
  if (input.ref) cmd.push(input.ref)
  if (out) cmd.push("--", out)
  return {
    tool,
    title: title ?? out ?? "git log",
    file,
    cmd,
    data: {
      mode: "log",
    },
  }
}

function log(input: { path?: string; ref?: string; limit?: number; stat?: boolean }): Step {
  return logStep(input)
}

function showStep(input: z.infer<typeof show_input>, tool: StepTool = "git_show", title?: string): Step {
  const cmd = ["git", "show"]
  if (input.stat) cmd.push("--stat")
  if (input.name_only) cmd.push("--name-only")
  cmd.push(input.ref)
  return {
    tool,
    title: title ?? input.ref,
    cmd,
    data: {
      mode: "show",
    },
  }
}

function show(input: z.infer<typeof show_input>): Step {
  return showStep(input)
}

function state(input: z.infer<typeof state_input>): Step {
  if (input.mode === "diff") {
    return diffStep(
      {
        path: input.path,
        staged: input.staged,
        base: input.base,
        head: input.head,
        stat: input.stat,
        name_only: input.name_only,
      },
      "git_state",
      input.path ?? "git state diff",
    )
  }
  return statusStep({ path: input.path }, "git_state", {
    porcelain: input.porcelain ?? true,
    title: input.path ?? "git state",
  })
}

function history(input: z.infer<typeof log_input>): Step {
  if (input.mode === "show") {
    return showStep({ ref: input.ref!, stat: input.stat, name_only: input.name_only }, "git_log")
  }
  if (input.mode === "refs") {
    return {
      tool: "git_log",
      title: "git refs",
      cmd: [
        "git",
        "for-each-ref",
        `--count=${input.limit}`,
        "--sort=-committerdate",
        "--format=%(refname:short)%x09%(objectname:short)%x09%(committerdate:iso8601)%x09%(subject)",
        "refs/heads",
        "refs/tags",
        "refs/remotes",
      ],
      data: {
        mode: "refs",
      },
    }
  }
  if (input.mode === "ahead_behind") {
    const head = input.head ?? "HEAD"
    return {
      tool: "git_log",
      title: `${input.base}...${head}`,
      cmd: ["git", "rev-list", "--left-right", "--count", `${input.base}...${head}`],
      data: {
        mode: "ahead_behind",
        base: input.base,
        head,
      },
    }
  }
  if (input.mode === "merge_base") {
    const head = input.head ?? "HEAD"
    return {
      tool: "git_log",
      title: `${input.base}...${head}`,
      cmd: ["git", "merge-base", input.base!, head],
      data: {
        mode: "merge_base",
        base: input.base,
        head,
      },
    }
  }
  return logStep(
    {
      path: input.path,
      ref: input.ref,
      limit: input.limit,
      stat: input.stat,
      since: input.since,
      until: input.until,
      all: input.all,
    },
    "git_log",
  )
}

function annotate(input: z.infer<typeof annotate_input>): Step {
  if (input.mode === "blame") {
    const file = inside(abs(input.filePath))
    if (!file) throw new Error("git_annotate blame requires filePath")
    const out = rel(file)
    return {
      tool: "git_annotate",
      title: `${out}:${input.line}`,
      file,
      cmd: ["git", "blame", "--porcelain", "-L", `${input.line},${input.end ?? input.line}`, "--", out!],
      data: {
        mode: "blame",
      },
    }
  }
  const file = inside(abs(input.path))
  const out = rel(file)
  if (input.mode === "grep") {
    const cmd = ["git", "grep", "-n", "--full-name"]
    if (!input.case_sensitive) cmd.push("-i")
    cmd.push("-e", input.pattern!)
    if (out) cmd.push("--", out)
    return {
      tool: "git_annotate",
      title: out ?? input.pattern!,
      file,
      cmd,
      data: {
        mode: "grep",
      },
    }
  }
  const cmd = [
    "git",
    "log",
    input.mode === "pickaxe" ? "-S" : "-G",
    input.pattern!,
    `--max-count=${input.limit ?? 20}`,
    "--date=iso",
    "--pretty=format:%H%x09%an%x09%ad%x09%s",
  ]
  if (input.since) cmd.push(`--since=${input.since}`)
  if (input.until) cmd.push(`--until=${input.until}`)
  if (input.all) cmd.push("--all")
  if (input.ref) cmd.push(input.ref)
  if (out) cmd.push("--", out)
  return {
    tool: "git_annotate",
    title: out ?? input.pattern!,
    file,
    cmd,
    data: {
      mode: input.mode,
    },
  }
}

function localgitState(input: z.infer<typeof LocalGitStateParametersSchema>): Step {
  if (input.action === "repo") {
    return statusStep({}, "localgit_state", {
      porcelain: input.porcelain ?? true,
      title: "repo state",
    })
  }
  if (input.action === "status") {
    return statusStep({ path: input.path }, "localgit_state", {
      porcelain: input.porcelain ?? true,
      title: input.path ?? "git state",
    })
  }
  return diffStep(
    {
      path: input.path,
      staged: input.staged,
      base: input.base,
      head: input.head,
      stat: input.stat,
      name_only: input.name_only,
    },
    "localgit_state",
    input.path ?? "git state diff",
  )
}

function localgitLog(input: z.infer<typeof LocalGitLogParametersSchema>): Step {
  if (input.action === "show") {
    return showStep({ ref: input.ref!, stat: input.stat, name_only: input.name_only }, "localgit_log")
  }
  if (input.action === "refs") {
    return {
      tool: "localgit_log",
      title: "git refs",
      cmd: [
        "git",
        "for-each-ref",
        `--count=${input.limit ?? 20}`,
        "--sort=-committerdate",
        "--format=%(refname:short)%x09%(objectname:short)%x09%(committerdate:iso8601)%x09%(subject)",
        "refs/heads",
        "refs/tags",
        "refs/remotes",
      ],
      data: { action: input.action },
    }
  }
  if (input.action === "ahead_behind") {
    const head = input.head ?? "HEAD"
    return {
      tool: "localgit_log",
      title: `${input.base}...${head}`,
      cmd: ["git", "rev-list", "--left-right", "--count", `${input.base}...${head}`],
      data: { action: input.action, base: input.base, head },
    }
  }
  if (input.action === "merge_base") {
    const head = input.head ?? "HEAD"
    return {
      tool: "localgit_log",
      title: `${input.base}...${head}`,
      cmd: ["git", "merge-base", input.base!, head],
      data: { action: input.action, base: input.base, head },
    }
  }
  return logStep(
    {
      path: input.path,
      ref: input.ref,
      limit: input.limit,
      stat: input.stat,
      since: input.since,
      until: input.until,
      all: input.all,
    },
    "localgit_log",
    input.action === "file_history" ? input.path! : undefined,
  )
}

function localgitAnnotate(input: z.infer<typeof LocalGitAnnotateParametersSchema>): Step {
  if (["blame", "line", "range"].includes(input.action)) {
    const file = inside(abs(input.filePath))
    if (!file) throw new Error("localgit_annotate requires filePath for blame actions")
    const out = rel(file)
    const cmd = ["git", "blame", "--porcelain"]
    if (input.action !== "blame") cmd.push("-L", `${input.line},${input.end ?? input.line}`)
    cmd.push("--", out!)
    return {
      tool: "localgit_annotate",
      title:
        input.action === "blame"
          ? out!
          : input.action === "range"
            ? `${out}:${input.line}-${input.end ?? input.line}`
            : `${out}:${input.line}`,
      file,
      cmd,
      data: { action: input.action },
    }
  }
  const file = inside(abs(input.path))
  const out = rel(file)
  if (input.action === "grep") {
    const cmd = ["git", "grep", "-n", "--full-name"]
    if (!input.case_sensitive) cmd.push("-i")
    cmd.push("-e", input.pattern!)
    if (out) cmd.push("--", out)
    return {
      tool: "localgit_annotate",
      title: out ?? input.pattern!,
      file,
      cmd,
      data: { action: input.action },
    }
  }
  const cmd = [
    "git",
    "log",
    input.action === "pickaxe" ? "-S" : "-G",
    input.pattern!,
    `--max-count=${input.limit ?? 20}`,
    "--date=iso",
    "--pretty=format:%H%x09%an%x09%ad%x09%s",
  ]
  if (input.since) cmd.push(`--since=${input.since}`)
  if (input.until) cmd.push(`--until=${input.until}`)
  if (input.all) cmd.push("--all")
  if (input.ref) cmd.push(input.ref)
  if (out) cmd.push("--", out)
  return {
    tool: "localgit_annotate",
    title: out ?? input.pattern!,
    file,
    cmd,
    data: { action: input.action },
  }
}

export async function repoStatus(cwd: string, abort: AbortSignal) {
  const out = await Process.text(["git", "status", "--short", "--untracked-files=all"], {
    cwd,
    abort,
    stdin: "ignore",
    nothrow: true,
  })
  if (out.code !== 0) return
  return lines(out.text)
}

const statusDescription =
  "Show local git working tree status for the current repo or an optional narrowed path without using bash. Returns `git status --short --branch --untracked-files=all` style output."

export const GitStatusTool = Tool.define("git_status", {
  description: statusDescription,
  parameters: status_input,
  async execute(input, ctx) {
    return run(status(input), ctx, input)
  },
})

const diffDescription =
  "Show a local git diff for the current worktree, staged changes, an optional narrowed path, or an optional base/head comparison without using bash."

export const GitDiffTool = Tool.define("git_diff", {
  description: diffDescription,
  parameters: diff_input,
  async execute(input, ctx) {
    return run(diff(input), ctx, input)
  },
})

const stateDescription =
  "Inspect local git state without using bash. Supports working-tree status mode and diff mode in one read-only tool."

export const GitStateTool = Tool.define("git_state", {
  description: stateDescription,
  parameters: state_input,
  async execute(input, ctx) {
    return run(state(input), ctx, input)
  },
})

const localgitStateDescription =
  "Canonical local git state tool. Use action=repo for whole-repo porcelain state, action=status for narrowed status, and action=diff for staged, unstaged, or base/head comparisons without using bash."

export const LocalGitStateTool = Tool.define("localgit_state", {
  description: localgitStateDescription,
  parameters: LocalGitStateParametersSchema,
  async execute(input, ctx) {
    return run(localgitState(input), ctx, input)
  },
})

const logDescription =
  "Show local git history without using bash. Supports commit log mode, show mode, refs mode, ahead/behind counts, and merge-base lookup in one read-only tool."

export const GitLogTool = Tool.define("git_log", {
  description: logDescription,
  parameters: log_input,
  async execute(input, ctx) {
    return run(history(input), ctx, input)
  },
})

const localgitLogDescription =
  "Canonical local git history tool. Use action=history, show, file_history, refs, ahead_behind, or merge_base to inspect repository history without using bash. Supports optional date bounds and all-ref history scans where they make sense."

export const LocalGitLogTool = Tool.define("localgit_log", {
  description: localgitLogDescription,
  parameters: LocalGitLogParametersSchema,
  async execute(input, ctx) {
    return run(localgitLog(input), ctx, input)
  },
})

const showDescription =
  "Show one local git object such as a commit, tag, or file revision without using bash. Supports optional diffstat or changed-file-name output."

export const GitShowTool = Tool.define("git_show", {
  description: showDescription,
  parameters: show_input,
  async execute(input, ctx) {
    return run(show(input), ctx, input)
  },
})

const annotateDescription =
  "Run local git archaeology without using bash. Supports blame, git grep, pickaxe string history search, and regex history search in one read-only tool."

export const GitAnnotateTool = Tool.define("git_annotate", {
  description: annotateDescription,
  parameters: annotate_input,
  async execute(input, ctx) {
    return run(annotate(input), ctx, input)
  },
})

const localgitAnnotateDescription =
  "Canonical local git archaeology tool. Use action=blame, line, range, grep, pickaxe, or regex to inspect authorship and history without using bash. Supports optional date bounds and all-ref history scans for pickaxe or regex archaeology."

export const LocalGitAnnotateTool = Tool.define("localgit_annotate", {
  description: localgitAnnotateDescription,
  parameters: LocalGitAnnotateParametersSchema,
  async execute(input, ctx) {
    return run(localgitAnnotate(input), ctx, input)
  },
})

const commitDescription =
  "Create a local path-scoped git commit without using bash. Requires a full commit message with a strong subject line and an explanatory body when appropriate. This tool commits only the exact file paths you provide, does not include unrelated changes, and does not push. Use it after verification when you want a local commit for the completed work."

export const GitCommitTool = Tool.define("git_commit", {
  description: commitDescription,
  parameters: commit_input,
  async execute(input, ctx) {
    return commit(input, ctx)
  },
})
