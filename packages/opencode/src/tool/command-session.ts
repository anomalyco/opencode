import { Context, Effect, Schema } from "effect"
import * as Tool from "./tool"
import { CommandSession, Service as CommandSessionService } from "@opencode-ai/core/command-session"
import type { ID } from "@opencode-ai/schema/command-event"
import type { Interface as CommandSessionInterface } from "@opencode-ai/core/command-session"
import { InstanceState } from "@/effect/instance-state"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"

const defaultMaxRuntimeMs = 2 * 60 * 1000
const defaultInactivityTimeoutMs = 5 * 60 * 1000

const start = Effect.fn("CommandSessionTool.start")(function* (
  input: {
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    maxRuntimeMs?: number
    inactivityTimeoutMs?: number
  },
  ctx: Tool.Context,
) {
  const instanceCtx = yield* InstanceState.context
  const cwd = input.cwd ?? instanceCtx.directory

  const result = yield* CommandSession.Service.start({
    command: input.command,
    args: input.args ?? [],
    cwd,
    env: input.env,
    maxRuntimeMs: input.maxRuntimeMs ?? defaultMaxRuntimeMs,
    inactivityTimeoutMs: input.inactivityTimeoutMs ?? defaultInactivityTimeoutMs,
  })

  return {
    title: `Started: ${input.command}`,
    metadata: {
      sessionId: result.id,
      status: result.info.status,
      pid: result.info.pid,
      startedAt: result.info.startedAt,
      maxRuntimeMs: input.maxRuntimeMs,
      inactivityTimeoutMs: input.inactivityTimeoutMs,
    },
    output: `Command "${input.command}" started with PID ${result.info.pid}`,
  }
})

const poll = Effect.fn("CommandSessionTool.poll")(function* (
  params: { sessionId: string; stdoutCursor?: number; stderrCursor?: number },
  ctx: Tool.Context,
) {
  const result = yield* CommandSession.Service.poll(params.sessionId, {
    stdout: params.stdoutCursor ?? 0,
    stderr: params.stderrCursor ?? 0,
  })

  return {
    title: `Poll: ${result.info.status}`,
    metadata: {
      sessionId: result.info.id,
      status: result.info.status,
      hasMore: result.hasMore,
    },
    output: `Output: ${result.stdoutDelta || result.stderrDelta || "No new output"}`,
  }
})

const write = Effect.fn("CommandSessionTool.write")(function* (
  params: { sessionId: string; data: string; stream?: "stdout" | "stderr" },
  ctx: Tool.Context,
) {
  yield* CommandSession.Service.write(params.sessionId, params.data, params.stream ?? "stdin")

  return {
    title: `Wrote to ${params.stream ?? "stdin"}`,
    metadata: { sessionId: params.sessionId, bytes: params.data.length },
    output: `Wrote ${params.data.length} bytes to ${params.stream ?? "stdin"}`,
  }
})

const interrupt = Effect.fn("CommandSessionTool.interrupt")(function* (
  params: { sessionId: string },
  ctx: Tool.Context,
) {
  yield* CommandSession.Service.interrupt(params.sessionId)

  return {
    title: "Interrupted",
    metadata: { sessionId: params.sessionId },
    output: `Sent interrupt to session ${params.sessionId}`,
  }
})

const terminate = Effect.fn("CommandSessionTool.terminate")(function* (
  params: { sessionId: string },
  ctx: Tool.Context,
) {
  yield* CommandSession.Service.terminate(params.sessionId)

  return {
    title: "Terminated",
    metadata: { sessionId: params.sessionId },
    output: `Terminated session ${params.sessionId}`,
  }
})

const list = Effect.fn("CommandSessionTool.list")(function* (
  _params: {},
  ctx: Tool.Context,
) {
  const sessions = yield* CommandSession.Service.list()

  const output = sessions.length === 0
    ? "No active command sessions"
    : sessions.map((s) => `${s.id} - ${s.command} ${s.args.join(" ")} [${s.status}]`).join("\n")

  return {
    title: "Active Sessions",
    metadata: { count: sessions.length },
    output,
  }
})

export const CommandSessionTool = Tool.define(
  "command_session",
  Effect.gen(function* () {
    const config = yield* Config.Service
    const flags = yield* RuntimeFlags.Service
    const commandSession: CommandSessionInterface = yield* Effect.service(CommandSessionService)

    const start = Effect.fn("CommandSessionTool.start")(function* (
      input: {
        command: string
        args?: string[]
        cwd?: string
        env?: Record<string, string>
        maxRuntimeMs?: number
        inactivityTimeoutMs?: number
      },
      ctx: Tool.Context,
    ) {
      const instanceCtx = yield* InstanceState.context
      const cwd = input.cwd ?? instanceCtx.directory

      const result = yield* commandSession.start({
        command: input.command,
        args: input.args ?? [],
        cwd,
        env: input.env,
        maxRuntimeMs: input.maxRuntimeMs ?? defaultMaxRuntimeMs,
        inactivityTimeoutMs: input.inactivityTimeoutMs ?? defaultInactivityTimeoutMs,
      })

      return {
        title: `Started: ${input.command}`,
        metadata: {
          sessionId: result.id,
          status: result.info.status,
          pid: result.info.pid,
          startedAt: result.info.startedAt,
          maxRuntimeMs: input.maxRuntimeMs,
          inactivityTimeoutMs: input.inactivityTimeoutMs,
        },
        output: `Command "${input.command}" started with PID ${result.info.pid}`,
      }
    })

    const poll = Effect.fn("CommandSessionTool.poll")(function* (
      params: { sessionId: string; stdoutCursor?: number; stderrCursor?: number },
      ctx: Tool.Context,
    ) {
      const result = yield* commandSession.poll(params.sessionId, {
        stdout: params.stdoutCursor ?? 0,
        stderr: params.stderrCursor ?? 0,
      })

      return {
        title: `Poll: ${result.info.status}`,
        metadata: {
          sessionId: result.info.id,
          status: result.info.status,
          hasMore: result.hasMore,
        },
        output: `Output: ${result.stdoutDelta || result.stderrDelta || "No new output"}`,
      }
    })

    const write = Effect.fn("CommandSessionTool.write")(function* (
      params: { sessionId: string; data: string; stream?: "stdout" | "stderr" },
      ctx: Tool.Context,
    ) {
      yield* commandSession.write(params.sessionId, params.data, params.stream ?? "stdin")

      return {
        title: `Wrote to ${params.stream ?? "stdin"}`,
        metadata: { sessionId: params.sessionId, bytes: params.data.length },
        output: `Wrote ${params.data.length} bytes to ${params.stream ?? "stdin"}`,
      }
    })

    const interrupt = Effect.fn("CommandSessionTool.interrupt")(function* (
      params: { sessionId: string },
      ctx: Tool.Context,
    ) {
      yield* commandSession.interrupt(params.sessionId)

      return {
        title: "Interrupted",
        metadata: { sessionId: params.sessionId },
        output: `Sent interrupt to session ${params.sessionId}`,
      }
    })

    const terminate = Effect.fn("CommandSessionTool.terminate")(function* (
      params: { sessionId: string },
      ctx: Tool.Context,
    ) {
      yield* commandSession.terminate(params.sessionId)

      return {
        title: "Terminated",
        metadata: { sessionId: params.sessionId },
        output: `Terminated session ${params.sessionId}`,
      }
    })

    const list = Effect.fn("CommandSessionTool.list")(function* (
      _params: {},
      ctx: Tool.Context,
    ) {
      const sessions = yield* commandSession.list()

      const output = sessions.length === 0
        ? "No active command sessions"
        : sessions.map((s: any) => `${s.id} - ${s.command} ${s.args.join(" ")} [${s.status}]`).join("\n")

      return {
        title: "Active Sessions",
        metadata: { count: sessions.length },
        output,
      }
    })

    return {
      description:
        "Manage long-running command sessions. Start commands that run in the background, poll them for output, send input, and terminate them. Use this for interactive commands, build processes, dev servers, or any command that needs to run while the agent continues working.",
      parameters: {
        operation: { type: "string", enum: ["start", "poll", "write", "interrupt", "terminate", "list"] },
        command: { type: "string" },
        args: { type: "array", items: { type: "string" } },
        cwd: { type: "string" },
        env: { type: "object", additionalProperties: { type: "string" } },
        maxRuntimeMs: { type: "number" },
        inactivityTimeoutMs: { type: "number" },
        sessionId: { type: "string" },
        stdoutCursor: { type: "number" },
        stderrCursor: { type: "number" },
        data: { type: "string" },
        stream: { type: "string", enum: ["stdout", "stderr"] },
      } as any,
      execute: (params: any, ctx: Tool.Context) => {
        const operation = params.operation
        switch (operation) {
          case "start":
            return start(params, ctx) as any
          case "poll":
            return poll(params, ctx) as any
          case "write":
            return write(params, ctx) as any
          case "interrupt":
            return interrupt(params, ctx) as any
          case "terminate":
            return terminate(params, ctx) as any
          case "list":
            return list(params, ctx) as any
          default:
            return Effect.die(new Error(`Unknown operation: ${operation}`)) as any
        }
      },
    }
  }),
)
