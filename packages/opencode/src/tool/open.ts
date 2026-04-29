import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import DESCRIPTION from "./open.txt"
import * as Tool from "./tool"

const ALLOWED_SCHEMES = new Set(["http", "https", "file"])

export const Parameters = Schema.Struct({
  target: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)).annotate({
    description:
      "Local file path, folder path, or http(s)/file URL to open in the OS default handler. Relative paths resolve from the project directory.",
  }),
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(400))).annotate({
    description: "Short reason shown to the user explaining why this is being opened.",
  }),
  reveal_in_folder: Schema.optional(Schema.Boolean).annotate({
    description:
      "If true and target is an existing local file, open the parent folder with the file selected (Windows explorer /select, macOS open -R, Linux opens parent folder).",
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

type TargetKind = "url" | "file" | "directory"

type Metadata = {
  platform: NodeJS.Platform
  backend: string
  kind?: TargetKind
  resolved?: string
  url?: string
  delivered: boolean
  reveal_in_folder?: boolean
  exit_code?: number
  error?: string
  reason?: string
}

const done = (result: Tool.ExecuteResult<Metadata>) => result

function classifyTarget(input: string): { kind: "url"; url: URL } | { kind: "path"; raw: string } {
  const trimmed = input.trim()
  // Detect explicit URL schemes (http://, https://, file://). We deliberately
  // do not treat Windows drive letters (C:\foo) as URLs even though `new URL`
  // can sometimes coerce them.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase()
    // Single-letter schemes are almost always Windows drive letters, not URLs.
    if (scheme.length > 1) {
      try {
        return { kind: "url", url: new URL(trimmed) }
      } catch {
        // Fall through and treat as a path so a useful error gets returned later.
      }
    }
  }
  return { kind: "path", raw: trimmed }
}

function runProcess(
  cmd: string,
  args: string[],
  signal: AbortSignal,
  timeoutMs = 8000,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, detached: false })
    const timer = setTimeout(() => {
      if (!settled) {
        try {
          child.kill()
        } catch {}
        settled = true
        resolve({ code: null, stderr: "timeout" })
      }
    }, timeoutMs)
    const onAbort = () => {
      try {
        child.kill()
      } catch {}
    }
    signal.addEventListener("abort", onAbort, { once: true })
    let stderr = ""
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString()
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      resolve({ code: null, stderr: err.message })
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      resolve({ code, stderr })
    })
  })
}

function platformLauncher(target: string, reveal: boolean, kind: TargetKind, platform: NodeJS.Platform) {
  if (platform === "win32") {
    if (reveal && kind === "file") return { cmd: "explorer.exe", args: [`/select,${target}`] }
    if (kind === "directory") return { cmd: "explorer.exe", args: [target] }
    return { cmd: "rundll32.exe", args: ["url.dll,FileProtocolHandler", target] }
  }
  if (platform === "darwin") {
    if (reveal && kind === "file") return { cmd: "open", args: ["-R", target] }
    return { cmd: "open", args: [target] }
  }
  // linux + freebsd + others: best-effort xdg-open
  if (reveal && kind === "file") return { cmd: "xdg-open", args: [path.dirname(target)] }
  return { cmd: "xdg-open", args: [target] }
}

export const OpenTool = Tool.define(
  "open",
  Effect.gen(function* () {
    const fsSvc = yield* AppFileSystem.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Params, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const platform = process.platform
          const reveal = params.reveal_in_folder === true
          const classified = classifyTarget(params.target)

          let kind: TargetKind
          let resolved: string
          let urlString: string | undefined

          if (classified.kind === "url") {
            const url = classified.url
            const scheme = url.protocol.replace(/:$/, "").toLowerCase()
            if (!ALLOWED_SCHEMES.has(scheme)) {
              throw new Error(
                `open: refusing to open URL with scheme '${scheme}'. Allowed schemes: ${[...ALLOWED_SCHEMES].join(", ")}.`,
              )
            }
            if (scheme === "file") {
              try {
                resolved = fileURLToPath(url)
              } catch (err: unknown) {
                throw new Error(`open: invalid file URL '${url.toString()}': ${(err as Error).message}`)
              }
              const stat = yield* fsSvc.stat(resolved).pipe(Effect.catch(() => Effect.succeed(undefined)))
              if (!stat) throw new Error(`open: file URL points to missing path: ${resolved}`)
              kind = stat.type === "Directory" ? "directory" : "file"
            } else {
              urlString = url.toString()
              resolved = urlString
              kind = "url"
            }
          } else {
            resolved = path.isAbsolute(classified.raw) ? classified.raw : path.resolve(ins.directory, classified.raw)
            const stat = yield* fsSvc.stat(resolved).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!stat) throw new Error(`open: target does not exist: ${resolved}`)
            kind = stat.type === "Directory" ? "directory" : "file"
          }

          const permissionTarget = kind === "url" ? (urlString ?? resolved) : resolved
          yield* ctx.ask({
            permission: "open",
            patterns: [permissionTarget],
            always: ["*"],
            metadata: {
              target: permissionTarget,
              kind,
              reveal_in_folder: reveal,
              reason: params.reason,
            },
          })

          const launcher = platformLauncher(resolved, reveal && kind === "file", kind, platform)
          yield* ctx.metadata({
            title: `open: ${kind === "url" ? urlString : path.basename(resolved)}`,
            metadata: {
              platform,
              backend: launcher.cmd,
              kind,
              resolved: kind === "url" ? undefined : resolved,
              url: urlString,
              delivered: false,
              reveal_in_folder: reveal,
              reason: params.reason,
            },
          })

          const result = yield* Effect.promise(async () => {
            try {
              return await runProcess(launcher.cmd, launcher.args, ctx.abort)
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err)
              return { code: null as number | null, stderr: msg }
            }
          })

          // explorer.exe can exit non-zero even when it successfully hands work
          // to an existing Explorer process.
          const delivered =
            result.code === 0 || (platform === "win32" && launcher.cmd === "explorer.exe" && result.code !== null)

          const errMsg = !delivered ? (result.stderr.trim() || `exit=${result.code}`) : undefined

          return done({
            title: delivered
              ? `opened ${kind === "url" ? urlString : path.basename(resolved)}`
              : `open failed: ${kind === "url" ? urlString : path.basename(resolved)}`,
            metadata: {
              platform,
              backend: launcher.cmd,
              kind,
              resolved: kind === "url" ? undefined : resolved,
              url: urlString,
              delivered,
              reveal_in_folder: reveal,
              exit_code: result.code ?? undefined,
              error: errMsg,
              reason: params.reason,
            },
            output: delivered
              ? `Opened ${kind === "url" ? urlString : resolved}${reveal && kind === "file" ? " (revealed in folder)" : ""} via ${launcher.cmd}.${params.reason ? ` Reason: ${params.reason}` : ""}`
              : `Failed to open ${kind === "url" ? urlString : resolved} via ${launcher.cmd} (${platform}). ${errMsg ?? ""} Continue without retrying.`,
          })
        }),
    }
  }),
)

export const __testing = { classifyTarget, platformLauncher }
