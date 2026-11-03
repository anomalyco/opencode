export * as SandboxApproval from "./approval.js"

import fs from "node:fs/promises"
import path from "node:path"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { SessionID } from "@opencode/schema/session-id"
import { Context, Effect, Layer } from "effect"
import { ShellParse } from "../shell/parse.js"
import { ShellScan } from "../shell/scan.js"

export interface Command {
  readonly cwd: string
  readonly shell: string
  readonly tokens: readonly string[]
  readonly prefix: readonly string[]
}

// Session grants deliberately accept a smaller language than ordinary shell permissions.
// No expansions, quotes, redirects, operators, comments or environment assignments.
export function parse(command: string, shell: string) {
  const name = path.basename(shell)
  if (!["sh", "bash", "zsh", "dash", "ksh"].includes(name)) return
  const text = command.trim()
  if (!/^[A-Za-z0-9_./:@%+,=-]+(?:[ \t]+[A-Za-z0-9_./:@%+,=-]+)*$/.test(text)) return
  const result = ShellScan.scan(text, name === "bash" || name === "zsh" ? name : "posix")
  if (result.kind !== "scanned" || result.commands.length !== 1) return
  const item = result.commands[0]
  const tokens = text.split(/[ \t]+/)
  if (
    item.declaration ||
    item.resource !== text ||
    tokens[0].includes("=") ||
    item.rawWords.length !== tokens.length ||
    item.rawWords.some((word, index) => word !== tokens[index])
  )
    return
  const prefix = ShellParse.prefix(tokens)
  // Do not suggest grants for general-purpose evaluation/launcher commands.
  if (
    ["sh", "bash", "zsh", "dash", "ksh", "eval", "exec", "env", "source", ".", "command", "builtin"].includes(
      path.basename(tokens[0] ?? ""),
    ) ||
    /^(?:node|nodejs|deno|python[\d.]*|pypy[\d.]*|perl|ruby|php|julia|lua|osascript|Rscript|awk)$/.test(
      path.basename(tokens[0] ?? ""),
    ) ||
    (path.basename(tokens[0] ?? "") === "bun" &&
      (prefix.length === 1 ||
        ["-e", "--eval", "eval"].includes(tokens[1] ?? "") ||
        (tokens[1] === "run" &&
          (prefix.length < 3 ||
            (prefix[2] ?? "").includes("/") ||
            /^(?:[.-]|.*\.(?:js|jsx|ts|tsx|mjs|cjs))/.test(prefix[2] ?? "")))))
  )
    return
  return { tokens, prefix }
}

export const analyze = Effect.fnUntraced(function* (input: { command: string; cwd: string; shell: string }) {
  const parsed = parse(input.command, input.shell)
  if (!parsed || !path.isAbsolute(input.shell)) return
  const paths = yield* Effect.tryPromise(() => Promise.all([fs.realpath(input.cwd), fs.realpath(input.shell)])).pipe(
    Effect.orElseSucceed(() => undefined),
  )
  if (!paths) return
  return { ...parsed, cwd: paths[0], shell: paths[1] } satisfies Command
})

export class Service extends Context.Service<
  Service,
  {
    readonly allows: (sessionID: SessionID, command: Command) => Effect.Effect<boolean>
    readonly remember: (sessionID: SessionID, command: Command) => Effect.Effect<void>
  }
>()("@opencode/SandboxApproval") {}

const layer = Layer.sync(Service, () => {
  const grants = new Map<SessionID, Array<Pick<Command, "cwd" | "shell" | "prefix">>>()
  const matches = (grant: Pick<Command, "cwd" | "shell" | "prefix">, command: Command) =>
    grant.cwd === command.cwd &&
    grant.shell === command.shell &&
    grant.prefix.every((token, index) => command.tokens[index] === token)
  return Service.of({
    allows: (sessionID, command) =>
      Effect.sync(() => grants.get(sessionID)?.some((grant) => matches(grant, command)) ?? false),
    remember: (sessionID, command) =>
      Effect.sync(() => {
        const existing = grants.get(sessionID) ?? []
        if (existing.some((grant) => matches(grant, command))) return
        grants.set(sessionID, [...existing, { cwd: command.cwd, shell: command.shell, prefix: [...command.prefix] }])
      }),
  })
})

// Server-owned memory survives Location reloads, but is never saved as a project permission.
export const node = makeGlobalNode({ service: Service, layer, deps: [] })
