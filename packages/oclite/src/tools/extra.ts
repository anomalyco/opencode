import dns from "dns/promises"
import os from "os"
import path from "path"
import { Effect, Schema } from "effect"
import { ConfigMarkdown } from "@opencode-ai/core/config/markdown"
import type { ResolvedConfig, RunToolContext } from "../contract"
import SKILL from "@/tool/skill.txt"
import TODOWRITE from "@/tool/todowrite.txt"
import WEBFETCH from "@/tool/webfetch.txt"
import { attempt, define } from "./fs"

// webfetch, todowrite and skill with opencode's parameter names. `question` is left out: it needs an interactive
// channel that returns free text, which the Asker contract (once/always/reject) doesn't carry.
const MAX_RESPONSE = 5 * 1024 * 1024
const DEFAULT_FETCH_S = 30
const MAX_FETCH_S = 120

const FetchParameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.optional(Schema.Literals(["text", "markdown", "html"])).annotate({
    description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
  }),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})
const Todo = Schema.Struct({
  content: Schema.String.annotate({ description: "Brief description of the task" }),
  status: Schema.String.annotate({
    description: "Current status of the task: pending, in_progress, completed, cancelled",
  }),
  priority: Schema.String.annotate({ description: "Priority level of the task: high, medium, low" }),
})
const TodoParameters = Schema.Struct({ todos: Schema.Array(Todo).annotate({ description: "The updated todo list" }) })
const SkillParameters = Schema.Struct({
  name: Schema.String.annotate({ description: "The name of the skill from available_skills" }),
})

export function extraTools(ctx: RunToolContext, cfg: ResolvedConfig) {
  const fetchSeconds = (timeout: number | undefined) => Math.min(timeout ?? DEFAULT_FETCH_S, MAX_FETCH_S)
  return [
    define({
      name: "webfetch",
      description: WEBFETCH,
      parameters: FetchParameters,
      readOnly: true,
      access: (params) => ({ permission: "webfetch", patterns: [params.url], always: [`${origin(params.url)}/*`] }),
      summarize: (params) => `webfetch ${params.url}`,
      timeoutFor: (params) => fetchSeconds(params.timeout) * 1000,
      execute: (params) =>
        attempt((signal) => webfetch(params.url, params.format ?? "markdown", signal, allowedOrigin(ctx))),
    }),
    define({
      name: "todowrite",
      description: TODOWRITE,
      parameters: TodoParameters,
      readOnly: false,
      access: () => ({ permission: "todowrite", patterns: ["*"], always: ["*"] }),
      summarize: (params) => `todowrite ${params.todos.filter((todo) => todo.status !== "completed").length} todos`,
      // The list lives in the tool_call record; session replay rebuilds it from there.
      execute: (params) => Effect.succeed(JSON.stringify(params.todos, null, 2)),
    }),
    define({
      name: "skill",
      description: SKILL,
      parameters: SkillParameters,
      readOnly: true,
      access: (params) => ({ permission: "skill", patterns: [params.name], always: [params.name] }),
      summarize: (params) => `skill ${params.name}`,
      execute: (params) =>
        attempt(async () => {
          const skills = await listSkills([ctx.cwd, cfg.projectRoot])
          const skill = skills.find((item) => item.name === params.name)
          if (!skill)
            throw new Error(
              `Skill "${params.name}" not found. Available skills: ${skills.map((item) => item.name).join(", ") || "none"}`,
            )
          const dir = path.dirname(skill.location)
          const files = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir })))
            .filter((file) => file !== "SKILL.md")
            .sort()
            .slice(0, 10)
          return [
            `<skill_content name="${skill.name}">`,
            `# Skill: ${skill.name}`,
            "",
            skill.content.trim(),
            "",
            `Base directory for this skill: ${dir}`,
            "Relative paths in this skill (e.g., scripts/, reference/) are relative to this base directory.",
            "Note: file list is sampled.",
            "",
            "<skill_files>",
            ...files.map((file) => `<file>${path.join(dir, file)}</file>`),
            "</skill_files>",
            "</skill_content>",
          ].join("\n")
        }),
    }),
  ]
}

// <skill>/SKILL.md under the opencode, Claude and oclite skill dirs of each root, then the user dirs.
export async function listSkills(roots: readonly string[]) {
  const home = os.homedir()
  const dirs = [
    ...[...new Set(roots)].flatMap((root) =>
      [".opencode/skill", ".opencode/skills", ".claude/skills", ".oclite/skills"].map((dir) => path.join(root, dir)),
    ),
    path.join(home, ".config", "oclite", "skills"),
    path.join(home, ".claude", "skills"),
  ]
  const found = await Promise.all(
    dirs.map(async (dir) => {
      const files = await Array.fromAsync(new Bun.Glob("*/SKILL.md").scan({ cwd: dir })).catch(() => [])
      return Promise.all(
        files.sort().map(async (file) => {
          const location = path.join(dir, file)
          const md = ConfigMarkdown.parseOption(await Bun.file(location).text())
          const name = typeof md?.data.name === "string" ? md.data.name : path.basename(path.dirname(location))
          const description = typeof md?.data.description === "string" ? md.data.description : ""
          return { name, description, location, content: md?.content ?? "" }
        }),
      )
    }),
  )
  // First definition of a name wins, project dirs before user dirs.
  return [
    ...new Map(
      found
        .flat()
        .toReversed()
        .map((skill) => [skill.name, skill]),
    ).values(),
  ].toReversed()
}

async function webfetch(url: string, format: "text" | "markdown" | "html", signal: AbortSignal, allowed: Allowed) {
  const accept = format === "html" ? "text/html,*/*;q=0.8" : "text/markdown,text/plain,text/html;q=0.9,*/*;q=0.8"
  const response = await follow(url, { signal, headers: { Accept: accept }, redirect: "manual" }, allowed, 0)
  if (!response.ok) throw new Error(`Request failed with status code: ${response.status}`)
  const text = new TextDecoder().decode(await readCapped(response))
  const html = (response.headers.get("content-type") ?? "").includes("html")
  if (!html || format === "html") return text
  // No HTML→markdown converter in oclite's deps: drop scripts/styles and tags, keep the text.
  return text
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
}

type Allowed = (origin: string) => boolean

function origin(url: string) {
  return URL.canParse(url) ? new URL(url).origin : url
}

// Local and private addresses need an allow rule naming that exact origin; `webfetch: allow` alone isn't enough.
function allowedOrigin(ctx: RunToolContext): Allowed {
  return (origin) =>
    ctx.ruleset.some(
      (rule) =>
        rule.permission === "webfetch" &&
        rule.action === "allow" &&
        [origin, `${origin}/*`, `${origin}*`].includes(rule.pattern),
    )
}

// Redirects are followed by hand (max 5) so every hop gets the same address check.
async function follow(url: string, init: RequestInit, allowed: Allowed, hops: number): Promise<Response> {
  if (!/^https?:\/\//.test(url) || !URL.canParse(url)) throw new Error("URL must start with http:// or https://")
  const target = new URL(url)
  await assertPublic(target, allowed)
  const response = await fetch(target, init)
  const location = response.headers.get("location")
  if (response.status < 300 || response.status >= 400 || !location) return response
  await response.body?.cancel()
  if (hops >= 5) throw new Error("Too many redirects (max 5)")
  return follow(new URL(location, target).href, init, allowed, hops + 1)
}

// Checks the name and every address it resolves to. A DNS answer can change between this lookup and fetch's own.
async function assertPublic(url: URL, allowed: Allowed) {
  if (allowed(url.origin)) return
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const local = host === "localhost" || host.endsWith(".localhost")
  const addresses = local ? [] : (await dns.lookup(host, { all: true })).map((entry) => entry.address)
  if (addresses.length && !addresses.some(isPrivate)) return
  throw new Error(`${url.origin} is a local or private address; allow it with a webfetch rule for "${url.origin}/*"`)
}

export function isPrivate(ip: string) {
  const v4 = ip.replace(/^::ffff:/i, "")
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    const [a, b] = v4.split(".").map(Number)
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const v6 = ip.toLowerCase()
  return v6 === "::" || v6 === "::1" || /^fe[89ab]/.test(v6) || /^f[cd]/.test(v6)
}

// Streams the body and stops at 5 MB instead of buffering an unbounded response first.
async function readCapped(response: Response) {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_RESPONSE)
    throw new Error("Response too large (exceeds 5MB limit)")
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  const state = { size: 0 }
  const pump = async (): Promise<void> => {
    const next = await reader?.read()
    if (!next || next.done) return
    state.size += next.value.byteLength
    if (state.size > MAX_RESPONSE) {
      await reader?.cancel()
      throw new Error("Response too large (exceeds 5MB limit)")
    }
    chunks.push(next.value)
    return pump()
  }
  await pump()
  return Buffer.concat(chunks)
}
