export * as FakeClaude from "./fake-claude"

import { EventEmitter } from "node:events"
import { createInterface } from "node:readline"
import { PassThrough } from "node:stream"
import type {
  AccountInfo,
  Options,
  SDKControlInitializeResponse,
  SessionMessage,
  SpawnedProcess,
} from "@anthropic-ai/claude-agent-sdk"
import { Recorder } from "./recorder"

// One step of a script. Each `claude` the SDK starts takes the next steps in order.
interface Gates {
  readonly hold?: Promise<void>
  readonly started: PromiseWithResolvers<void>
  readonly done: PromiseWithResolvers<void>
}

interface Startup extends Gates {
  readonly type: "startup"
  readonly reply: SDKControlInitializeResponse
  readonly exitCode?: number
}

interface Input extends Gates {
  readonly type: "user" | "interrupt"
  readonly replies: readonly any[]
  readonly beforeResult?: Promise<void>
}

interface Exchange extends Gates {
  readonly type: "exchange"
  readonly input: any
  readonly replies: any[]
  readonly beforeResult?: Promise<void>
}

export type Step = Startup | Input | Exchange

// Replay the protocol exchanges of a recorded tool turn, including Claude-initiated hook/MCP requests.
export function replay(recording: string): Step[] {
  const steps: Step[] = []
  let current: Exchange | undefined
  for (const line of Recorder.load(recording)) {
    if (line.from === "sdk") {
      if (line.message.request?.subtype === "initialize") {
        steps.push(expectStartup({ recording }))
        current = undefined
        continue
      }
      current = {
        type: "exchange",
        input: line.message,
        replies: [],
        started: Promise.withResolvers<void>(),
        done: Promise.withResolvers<void>(),
      }
      steps.push(current)
      continue
    }
    if (line.from === "claude" && current) current.replies.push(line.message)
  }
  return steps
}

// Like claude, report the SDK servers the plugin offered as connected when the recording was made without tools.
// Recordings that list servers keep their recorded status.
function connectServers(message: any, initialize: any) {
  if (message.type !== "system" || message.subtype !== "init" || message.mcp_servers.length) return message
  if (!initialize?.sdkMcpServers?.length) return message
  const servers = []
  for (const name of initialize.sdkMcpServers) servers.push({ name, status: "connected", source: "sdk" })
  return { ...message, mcp_servers: servers }
}

// Login checks are the only runs that don't stream partial messages
function isProbe(args: readonly string[]) {
  return !args.includes("--include-partial-messages")
}

// Answers the SDK's start-up request with the reply from a recording. With `hold`, the reply waits until it resolves.
export function expectStartup(input?: {
  readonly recording?: string
  readonly hold?: Promise<void>
  readonly exitCode?: number
  readonly account?: AccountInfo
}): Startup {
  const reply = Recorder.startupReply(Recorder.load(input?.recording ?? "startup"))
  return {
    type: "startup",
    reply: input?.account ? { ...reply, account: input.account } : reply,
    hold: input?.hold,
    exitCode: input?.exitCode,
    started: Promise.withResolvers<void>(),
    done: Promise.withResolvers<void>(),
  }
}

// Replay one recorded user turn or interrupt, ending at the next SDK input. The cancelled recording
// deliberately splits at the interrupt: its receipt arrives before the remaining assistant events/result.
function recordedInput(recording: string, type: Input["type"], index: number) {
  const replies: any[] = []
  let found = false
  let seen = 0
  for (const line of Recorder.load(recording)) {
    if (line.from === "sdk") {
      if (found) break
      const matches = type === "user" ? line.message.type === "user" : line.message.request?.subtype === "interrupt"
      if (matches && seen++ === index) found = true
      continue
    }
    if (found && line.from === "claude") replies.push(line.message)
  }
  if (!found) throw new Error(`No ${type} ${index} in ${recording}`)
  return replies
}

export function expectTurn(input?: {
  readonly recording?: string
  readonly index?: number
  readonly hold?: Promise<void>
}): Input {
  return {
    type: "user",
    replies: recordedInput(input?.recording ?? "text", "user", input?.index ?? 0),
    hold: input?.hold,
    started: Promise.withResolvers<void>(),
    done: Promise.withResolvers<void>(),
  }
}

export function expectInterrupt(input?: {
  readonly recording?: string
  readonly hold?: Promise<void>
  readonly beforeResult?: Promise<void>
}): Input {
  return {
    type: "interrupt",
    replies: recordedInput(input?.recording ?? "text", "interrupt", 0),
    hold: input?.hold,
    beforeResult: input?.beforeResult,
    started: Promise.withResolvers<void>(),
    done: Promise.withResolvers<void>(),
  }
}

function replies(step: Input, requestID?: string) {
  return step.replies.map((message) =>
    message.type === "control_response"
      ? { ...message, response: { ...message.response, request_id: requestID } }
      : message,
  )
}

// A start-up reply from a recording, answering the request with the given ID
function startupResponse(requestID: string, reply: SDKControlInitializeResponse) {
  return {
    type: "control_response",
    response: { subtype: "success", request_id: requestID, response: reply },
  }
}

// The login probe's recorded no-prompt controls by model, parsed on first use. Chat controls stay in the test's script.
let probeControls: Map<string, any> | undefined

function loadProbeControls() {
  const controls = new Map<string, any>()
  let model: string | undefined
  let control: string | undefined
  for (const line of Recorder.load("startup")) {
    if (line.from === "sdk") {
      control = line.message.request?.subtype
      if (control === "set_model") model = line.message.request.model
      continue
    }
    if (line.from === "claude" && line.message.type === "control_response" && model && control) {
      controls.set(`${model}/${control}`, line.message)
    }
  }
  return controls
}

function probeResponse(message: any, model: string | undefined) {
  probeControls ??= loadProbeControls()
  const reply = probeControls.get(`${model}/${message.request?.subtype}`)
  if (!reply) return
  return { ...reply, response: { ...reply.response, request_id: message.request_id } }
}

// One `claude` the SDK started: its flags, its environment and every message the SDK wrote to it
export interface Run {
  readonly args: readonly string[]
  readonly env: Record<string, string | undefined>
  readonly received: any[]
  readonly closed: Promise<void>
  readonly exit: (code: number) => Promise<void>
}

export type Fake = ReturnType<typeof make>

export function make(script: readonly Step[], options?: { readonly probes?: boolean }) {
  const runs: Run[] = []
  const errors: string[] = []
  const transcripts = new Map<string, SessionMessage[]>()
  const forks: Array<{ source: string; boundary: string; sessionID: string }> = []
  const removed: string[] = []
  let next = 0
  let completed = 0
  const probeReply = options?.probes ? Recorder.startupReply(Recorder.load("startup")) : undefined

  const spawn: NonNullable<Options["spawnClaudeCodeProcess"]> = (options) => {
    const process = new FakeProcess()
    const closed = Promise.withResolvers<void>()
    const requestIDs = new Map<string, string>()
    process.once("exit", () => closed.resolve())
    const run: Run = {
      args: options.args,
      env: options.env,
      received: [],
      closed: closed.promise,
      async exit(code) {
        process.exit(code, null)
        // Let the SDK consume stdout's end and the process exit before the next request.
        await new Promise<void>((resolve) => setImmediate(resolve))
      },
    }
    runs.push(run)
    createInterface({ input: process.stdin }).on("line", (line) => {
      const message = JSON.parse(line)
      run.received.push(message)
      void answer(message, process, closed.promise, run, requestIDs).catch((error) => errors.push(String(error)))
    })
    // The SDK closes stdin to stop `claude`
    process.stdin.on("end", () => process.exit(0, null))
    return process
  }

  async function answer(
    message: any,
    process: FakeProcess,
    closed: Promise<void>,
    run: Run,
    requestIDs: Map<string, string>,
  ) {
    const type =
      message.type === "user"
        ? "user"
        : message.request?.subtype === "initialize"
          ? "startup"
          : message.request?.subtype
    // Embedded OpenCode loads plugins for several locations. Its login probes are independent of chat ordering.
    if (probeReply && isProbe(run.args) && type === "startup") {
      process.stdout.write(JSON.stringify(startupResponse(message.request_id, probeReply)) + "\n")
      return
    }
    const step = script[next]
    const matches =
      step?.type === "exchange"
        ? message.type === step.input.type &&
          message.request?.subtype === step.input.request?.subtype &&
          message.response?.request_id === step.input.response?.request_id
        : type === step?.type
    if (!matches && isProbe(run.args)) {
      const model = run.received.findLast((message) => message.request?.subtype === "set_model")?.request.model
      const reply = probeResponse(message, model)
      if (reply) {
        process.stdout.write(JSON.stringify(reply) + "\n")
        return
      }
    }
    if (!step || !matches) {
      errors.push(`unexpected ${type ?? message.type}, the next step is ${step?.type ?? "the end of the script"}`)
      return
    }
    if (step.type === "exchange" && message.type === "control_request")
      requestIDs.set(step.input.request_id, message.request_id)
    next++
    if (message.type === "user") remember(run, message)
    step.started.resolve()
    await Promise.race([step.hold, closed])
    if (process.exitCode !== null || process.signalCode !== null) return
    if (step.type === "startup") {
      if (step.exitCode !== undefined) process.exit(step.exitCode, null)
      if (step.exitCode === undefined)
        process.stdout.write(JSON.stringify(startupResponse(message.request_id, step.reply)) + "\n")
    }
    if (step.type !== "startup") {
      const output = step.type === "exchange" ? step.replies : replies(step, message.request_id)
      for (const recorded of output) {
        if (recorded.type === "result" && "beforeResult" in step && step.beforeResult)
          await Promise.race([step.beforeResult, closed])
        if (process.exitCode !== null || process.signalCode !== null) return
        const initialize = run.received.find((message) => message.request?.subtype === "initialize")?.request
        const tools = connectServers(recorded, initialize)
        // An interrupt receipt may follow another exchange, such as an MCP cancellation notification.
        const response =
          tools.type === "control_response" && step.type === "exchange"
            ? {
                ...tools,
                response: {
                  ...tools.response,
                  request_id: requestIDs.get(tools.response.request_id) ?? tools.response.request_id,
                },
              }
            : tools
        const reply =
          response.type === "control_request" && response.request.subtype === "hook_callback"
            ? {
                ...response,
                request: {
                  ...response.request,
                  callback_id: initialize.hooks[response.request.input.hook_event_name][0].hookCallbackIds[0],
                },
              }
            : response
        const sessionID = run.args
          .find((arg) => arg.startsWith("--session-id=") || arg.startsWith("--resume="))
          ?.split("=")[1]
        remember(run, reply)
        process.stdout.write(
          JSON.stringify(sessionID && "session_id" in reply ? { ...reply, session_id: sessionID } : reply) + "\n",
        )
      }
    }
    completed++
    step.done.resolve()
  }

  function remember(run: Run, message: any) {
    if (
      run.args.includes("--no-session-persistence") ||
      !message.uuid ||
      (message.type !== "user" && message.type !== "assistant")
    )
      return
    const id = run.args.find((arg) => arg.startsWith("--session-id=") || arg.startsWith("--resume="))?.split("=")[1]
    if (!id) return
    const messages = transcripts.get(id) ?? []
    if (!messages.some((saved) => saved.uuid === message.uuid)) messages.push({ ...message, session_id: id })
    transcripts.set(id, messages)
  }

  return {
    spawn,
    runs,
    transcripts,
    forks,
    removed,
    async fork(source: string, boundary: string) {
      const history = transcripts.get(source) ?? []
      const end = history.findIndex((message) => message.uuid === boundary)
      if (end < 0) return
      const sessionID = crypto.randomUUID()
      const messages = new Map<string, string>()
      const copied = history.slice(0, end + 1).map((message) => {
        const uuid = crypto.randomUUID()
        messages.set(message.uuid, uuid)
        return { ...message, session_id: sessionID, uuid }
      })
      transcripts.set(sessionID, copied)
      forks.push({ source, boundary, sessionID })
      return { sessionID, messages }
    },
    async remove(sessionID: string) {
      transcripts.delete(sessionID)
      removed.push(sessionID)
    },
    // Resolves when the SDK has requested a step, before any hold is released
    started: (step: Step) => step.started.promise,
    // Resolves once the fake has finished the step
    reached: (step: Step) => step.done.promise,
    // Throws if a step never finished, or the SDK wrote something the script didn't expect
    check: () => {
      if (errors.length > 0) throw new Error(errors.join("\n"))
      if (completed < script.length) throw new Error(`${script.length - completed} script steps did not finish`)
    },
  }
}

class FakeProcess extends EventEmitter implements SpawnedProcess {
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  killed = false
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null

  kill(signal: NodeJS.Signals) {
    if (this.exited()) return false
    this.killed = true
    this.exit(null, signal)
    return true
  }

  exit(code: number | null, signal: NodeJS.Signals | null) {
    if (this.exited()) return
    this.exitCode = code
    this.signalCode = signal
    this.stdout.end()
    this.emit("exit", code, signal)
  }

  private exited() {
    return this.exitCode !== null || this.signalCode !== null
  }
}
