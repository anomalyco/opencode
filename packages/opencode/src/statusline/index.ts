import { TuiConfig } from "../config/tui"
import { Plugin } from "../plugin"
import { Vcs } from "../project/vcs"
import { Instance } from "../project/instance"
import { Session } from "../session"
import { SessionID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { SessionStatus } from "../session/status"
import { Provider } from "../provider/provider"
import { Log } from "../util/log"
import path from "path"

const log = Log.create({ service: "statusline" })

export namespace StatusLine {
  const TOKEN_RE = /\{([^}]+)\}/g

  export async function builtins(sessionID?: string) {
    const vars: Record<string, string> = {}

    vars.directory = Instance.directory
    vars.worktree = Instance.worktree
    vars.cwd = Instance.directory
    vars.cwd_basename = path.basename(Instance.directory)
    vars.project_name = Instance.project.name ?? path.basename(Instance.directory)

    const branch = await Vcs.branch()
    if (branch) vars.git_branch = branch

    vars.timestamp = String(Date.now())

    if (!sessionID) return vars

    const sid = SessionID.make(sessionID)
    const session = await Session.get(sid).catch(() => undefined)
    if (!session) return vars

    vars.session_id = session.id
    vars.session_title = session.title
    vars.session_slug = session.slug

    const status = await SessionStatus.get(sid)
    vars.session_status = status.type

    vars.session_created = String(session.time.created)
    vars.session_updated = String(session.time.updated)
    vars.session_duration = String(Date.now() - session.time.created)

    const msgs = await Session.messages({ sessionID: sid }).catch(() => [] as never[])
    if (msgs.length === 0) return vars

    vars.message_count = String(msgs.length)

    const assistants = msgs
      .flatMap((m) => (m.info.role === "assistant" ? [m.info] : []))
      .reverse()

    const cost = assistants.reduce((sum, m) => sum + (m.cost ?? 0), 0)
    const total = assistants.reduce(
      (sum, m) =>
        sum + m.tokens.input + m.tokens.output + m.tokens.reasoning + m.tokens.cache.read + m.tokens.cache.write,
      0,
    )

    const last = assistants[0]
    if (last) {
      vars.model_id = last.modelID
      vars.provider_id = last.providerID
      vars.agent = last.agent ?? ""
      vars.tokens_input = String(last.tokens.input)
      vars.tokens_output = String(last.tokens.output)
      vars.tokens_reasoning = String(last.tokens.reasoning)
      vars.tokens_cache_read = String(last.tokens.cache.read)
      vars.tokens_cache_write = String(last.tokens.cache.write)
    }

    vars.total_cost = String(cost)
    vars.total_tokens = String(total)

    if (last) {
      const model = await Provider.getModel(last.providerID, last.modelID).catch(() => undefined)
      if (model) {
        vars.model_name = model.name
        vars.model_family = model.family ?? ""
        vars.model_context_limit = String(model.limit.context)
        if (total > 0) {
          vars.context_used_pct = String(Math.round((total / model.limit.context) * 100))
        }
      }
    }

    return vars
  }

  export async function commands(cmds: Record<string, string>, cwd: string, timeout = 5000) {
    const entries = Object.entries(cmds)
    if (entries.length === 0) return {}

    const results = await Promise.allSettled(
      entries.map(async ([name, cmd]) => {
        const proc = Bun.spawn(["sh", "-c", cmd], {
          cwd,
          stdout: "pipe",
          stderr: "ignore",
          env: process.env,
        })
        const timer = setTimeout(() => proc.kill(), timeout)
        const reader = proc.stdout.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        const maxBytes = 1024
        while (bytes < maxBytes) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          bytes += value.length
        }
        reader.cancel()
        clearTimeout(timer)
        const output = new TextDecoder().decode(Buffer.concat(chunks)).slice(0, maxBytes)
        return { name, output: output.trimEnd() }
      }),
    )

    const fulfilled = results.filter(
      (r): r is PromiseFulfilledResult<{ name: string; output: string }> => r.status === "fulfilled",
    )
    const rejected = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    )

    for (const r of rejected) {
      log.debug("shell command failed", {
        error: r.reason?.message ?? String(r.reason),
      })
    }

    return Object.fromEntries(fulfilled.map((r) => [`shell:${r.value.name}`, r.value.output]))
  }

  export function resolve(template: string, vars: Record<string, string>) {
    return template.replace(TOKEN_RE, (_match, token: string) => {
      if (token in vars) return vars[token]

      const colon = token.indexOf(":")
      if (colon === -1) {
        log.debug("unresolved variable", { name: token, template })
        return ""
      }

      const name = token.slice(0, colon)
      const spec = token.slice(colon + 1)

      const value = vars[name]
      if (value === undefined) {
        log.debug("unresolved variable", { name, template })
        return ""
      }
      return format(value, spec)
    })
  }

  export function format(value: string, spec: string): string {
    if (spec === "basename") return path.basename(value)

    const barMatch = spec.match(/^bar(\d+)?$/)
    if (barMatch) {
      const width = barMatch[1] ? parseInt(barMatch[1]) : 10
      const pct = Number(value)
      if (isNaN(pct)) return value
      const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width)
      return "\u2588".repeat(filled) + "\u2591".repeat(width - filled)
    }

    if (spec === "k") {
      const n = Number(value)
      if (isNaN(n)) return value
      return Math.round(n / 1000) + "k"
    }

    if (spec.startsWith("%")) return formatTime(value, spec)

    log.debug("unknown format spec", { spec, value })
    return value
  }

  function formatTime(value: string, spec: string): string {
    const ms = Number(value)
    if (isNaN(ms)) return value

    const isDuration =
      !spec.includes("%Y") &&
      !spec.includes("%d") &&
      !spec.includes("%b") &&
      (spec.includes("%H") || spec.includes("%M") || spec.includes("%S"))

    if (isDuration && ms < 365 * 24 * 60 * 60 * 1000) {
      const secs = Math.floor(ms / 1000)
      const hours = Math.floor(secs / 3600)
      const minutes = Math.floor((secs % 3600) / 60)
      const seconds = secs % 60
      return spec
        .replace("%H", String(hours))
        .replace("%M", String(minutes).padStart(2, "0"))
        .replace("%S", String(seconds).padStart(2, "0"))
    }

    const date = new Date(ms)
    return spec
      .replace("%Y", String(date.getFullYear()))
      .replace("%m", String(date.getMonth() + 1).padStart(2, "0"))
      .replace("%d", String(date.getDate()).padStart(2, "0"))
      .replace("%H", String(date.getHours()).padStart(2, "0"))
      .replace("%M", String(date.getMinutes()).padStart(2, "0"))
      .replace("%S", String(date.getSeconds()).padStart(2, "0"))
  }

  export async function get(sessionID?: string) {
    const config = await TuiConfig.get()
    const sl = config.status_line
    if (!sl?.templates || Object.keys(sl.templates).length === 0) return undefined

    const [builtin, shell, plugin] = await Promise.all([
      builtins(sessionID),
      commands(sl.commands ?? {}, Instance.worktree),
      Plugin.trigger("tui.statusLine.variables", { sessionID }, { variables: {} as Record<string, string> })
        .then((r) => r.variables)
        .catch((e) => {
          log.debug("plugin variables failed", { error: e?.message ?? String(e) })
          return {} as Record<string, string>
        }),
    ])

    const vars = { ...builtin, ...shell, ...plugin }

    const templates = Object.fromEntries(
      Object.entries(sl.templates).map(([target, template]) => [target, resolve(template, vars)]),
    )

    return {
      templates,
      interval: sl.interval ?? 10,
    }
  }
}
