export * as Recorder from "./recorder"

import { spawn } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { PassThrough } from "node:stream"
import { createInterface } from "node:readline"
import type { Options, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk"

// Like core's recorded tests: RECORD=true refreshes recordings, and never under CI.
export const enabled = process.env.RECORD === "true" && !process.env.CI

const DIRECTORY = path.join(import.meta.dir, "../fixtures/recordings")

export type Line =
  | { readonly from: "spawn"; readonly process?: number; readonly args: readonly string[] }
  | { readonly from: "sdk"; readonly process?: number; readonly message: any }
  | { readonly from: "claude"; readonly process?: number; readonly message: any }

// With RECORD=true, starts the real `claude` and captures traffic without thinking, saved by `save()` to
// test/fixtures/recordings/<name>.jsonl. Without it, `spawn` is undefined and the SDK starts `claude` itself.
export function make(name: string, capture = false) {
  const lines: Line[] = []
  const sessionIDs = new Set<string>()
  let nextProcess = 0

  const spawnClaude: NonNullable<Options["spawnClaudeCodeProcess"]> = (options) => {
    const process = nextProcess++
    lines.push({ from: "spawn", process, args: options.args })
    for (const arg of options.args)
      if (arg.startsWith("--session-id=") || arg.startsWith("--resume=")) sessionIDs.add(arg.split("=")[1]!)
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      signal: options.signal,
      stdio: ["pipe", "pipe", "inherit"],
    })
    function record(from: "sdk" | "claude", line: string) {
      const message = parse(line)
      if (message !== undefined) lines.push({ from, process, message })
    }
    // Forward the original streams; only the captured copy is filtered.
    const stdin = new PassThrough()
    stdin.pipe(child.stdin)
    createInterface({ input: stdin }).on("line", (line) => record("sdk", line))
    const stdout = new PassThrough()
    child.stdout.pipe(stdout)
    createInterface({ input: child.stdout }).on("line", (line) => record("claude", line))
    return Object.assign(child, { stdin, stdout })
  }

  function save() {
    if (!enabled || lines.length === 0) return
    const startup = startupReply(lines)
    const header = {
      claudeCode: startup?.claude_code_version,
      sdk: sdkVersion(),
      date: new Date().toISOString().slice(0, 10),
    }
    const text = [header, ...withoutLoginChecks(lines)].map((line) => JSON.stringify(line) + "\n").join("")
    // Personal details stay out of the repository
    const home = text.replaceAll(homedir(), "/home/user")
    const email = startup?.account?.email ? home.replaceAll(startup.account.email, "user@example.com") : home
    const organization = startup?.account?.organization
      ? email.replaceAll(startup.account.organization, "Example Org")
      : email
    writeFileSync(path.join(DIRECTORY, `${name}.jsonl`), organization)
  }

  return { spawn: enabled || capture ? spawnClaude : undefined, save, sessionIDs, lines: lines as readonly Line[] }
}

// A chat recording leaves out opencode's login checks, which the fake never replays. A recording of only
// login checks keeps them. Login checks are the only runs that don't stream partial messages.
function withoutLoginChecks(lines: readonly Line[]) {
  const checks = new Set<number | undefined>()
  let chats = 0
  for (const line of lines) {
    if (line.from !== "spawn") continue
    if (line.args.includes("--include-partial-messages")) chats++
    else checks.add(line.process)
  }
  if (chats === 0) return lines
  const kept: Line[] = []
  for (const line of lines) {
    if (!checks.has(line.process)) kept.push(line)
  }
  return kept
}

// Never retain thinking, including signed or redacted blocks and echoed input history.
export function parse(line: string) {
  return JSON.parse(line, (_key, value) => {
    if (!value || typeof value !== "object") return value
    if (Array.isArray(value)) return value.filter((item) => item !== undefined)
    if (
      value.type === "thinking" ||
      value.type === "thinking_delta" ||
      value.type === "redacted_thinking" ||
      value.type === "signature_delta"
    )
      return undefined
    if (
      value.type === "reasoning" ||
      value.type === "reasoning-start" ||
      value.type === "reasoning-delta" ||
      value.type === "reasoning-end"
    )
      return undefined
    if (value.type === "content_block_start" && value.content_block === undefined) return undefined
    if (value.type === "content_block_delta" && value.delta === undefined) return undefined
    if (value.type === "stream_event" && value.event === undefined) return undefined
    return value
  })
}

// What `claude` answered to the SDK's first start-up request
export function startupReply(lines: readonly Line[]) {
  const line = lines.find((line) => line.from === "claude" && line.message.type === "control_response")
  return line?.from === "claude" ? line.message.response.response : undefined
}

export function load(name: string): Line[] {
  const text = readFileSync(path.join(DIRECTORY, `${name}.jsonl`), "utf8")
  // The first line is the header
  return text
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => JSON.parse(line))
}

// An independent usage oracle for tests: the CLI's result, rather than our stream converter.
export function result(name: string, index = 0): SDKResultMessage {
  const line = load(name).filter((line) => line.from === "claude" && line.message.type === "result")[index]
  if (line?.from === "claude") return line.message
  throw new Error(`No result ${index} in ${name}`)
}

function sdkVersion(): string {
  const file = path.join(import.meta.dir, "../../../node_modules/@anthropic-ai/claude-agent-sdk/package.json")
  return JSON.parse(readFileSync(file, "utf8")).version
}
