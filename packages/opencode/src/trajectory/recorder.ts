import fs from "fs/promises"
import path from "path"
import type { Trajectory } from "./types"
import { TrajectoryConfig } from "./config"

type Recorder = {
  id: string
  path: string
  buffer: Trajectory.Event[]
  stream: boolean
  options: TrajectoryConfig.Options
  disabled: boolean
}

export namespace TrajectoryRecorder {
  const recorders = new Map<string, Recorder>()

  export function start(
    sessionID: string,
    options: {
      agent: string
      model: { provider: string; id: string }
      filePath?: string
    },
  ): void {
    if (recorders.has(sessionID)) return
    const cfg = TrajectoryConfig.get()
    const target = options.filePath ?? resolvePath(sessionID, options.agent, options.model, cfg)
    const disabled = cfg.enabled === false
    const rec: Recorder = {
      id: sessionID,
      path: target,
      buffer: [],
      stream: false,
      options: cfg,
      disabled,
    }
    recorders.set(sessionID, rec)
  }

  export async function record(sessionID: string, event: Trajectory.Event): Promise<void> {
    const rec = recorders.get(sessionID)
    if (!rec) throw new Error(`Trajectory recorder not started for session ${sessionID}`)
    if (rec.disabled) return
    rec.buffer.push(event)
    if (shouldFlush(rec)) await flush(rec)
  }

  export async function stop(sessionID: string): Promise<void> {
    const rec = recorders.get(sessionID)
    if (!rec) return
    if (!rec.disabled) await flush(rec)
    recorders.delete(sessionID)
  }

  export function isRecording(sessionID: string): boolean {
    return recorders.has(sessionID)
  }

  export function markStreamStart(sessionID: string): void {
    const rec = recorders.get(sessionID)
    if (!rec) throw new Error(`Trajectory recorder not started for session ${sessionID}`)
    rec.stream = true
  }

  export async function markStreamEnd(sessionID: string): Promise<void> {
    const rec = recorders.get(sessionID)
    if (!rec) throw new Error(`Trajectory recorder not started for session ${sessionID}`)
    rec.stream = false
    if (rec.disabled) return
    if (rec.options.flushStrategy === "end_of_stream" || rec.buffer.length >= rec.options.bufferSize) {
      await flush(rec)
    }
  }

  export async function captureInteraction(
    sessionID: string,
    data: {
      messageID: string
      step: number
      input: {
        systemPrompts: string[]
        messages: unknown[]
        tools: Record<string, unknown>
        parameters: {
          temperature?: number
          topP?: number
          maxOutputTokens?: number
        }
      }
      response: {
        finishReason?: string
        tokens: {
          input: number
          output: number
          reasoning: number
          cache: { read: number; write: number }
        }
        parts: Array<{ type: string; text?: string }>
      }
      timing: {
        startTime: number
        endTime: number
      }
    },
  ) {
    if (!isRecording(sessionID)) return

    const { input, response, timing } = data
    const toolNames = Object.keys(input.tools)

    const event: Trajectory.LLMInteractionEvent = {
      type: "llm_interaction",
      timestamp: Date.now(),
      sessionID,
      messageID: data.messageID,
      step: data.step,
      interactionType: "stream",
      purpose: "agent_step",
      input: {
        systemPrompts: input.systemPrompts,
        messages: input.messages,
        toolCount: toolNames.length,
        toolNames: toolNames,
        parameters: input.parameters,
      },
      response: {
        finishReason: response.finishReason ?? "unknown",
        usage: {
          inputTokens: response.tokens.input,
          outputTokens: response.tokens.output,
          reasoningTokens: response.tokens.reasoning,
          cacheReadTokens: response.tokens.cache.read,
          cacheWriteTokens: response.tokens.cache.write,
          totalInputTokens: response.tokens.input + response.tokens.cache.read,
          totalOutputTokens: response.tokens.output + response.tokens.cache.write,
          totalCacheTokens: response.tokens.cache.read + response.tokens.cache.write,
        },
        textLength: response.parts
          .filter((p) => p.type === "text")
          .reduce((sum, p) => sum + (p.text?.length ?? 0), 0),
        reasoningLength: response.parts
          .filter((p) => p.type === "reasoning")
          .reduce((sum, p) => sum + (p.text?.length ?? 0), 0),
        hasHiddenReasoning:
          response.tokens.reasoning > 0 && response.parts.filter((p) => p.type === "reasoning").length === 0,
        toolCallCount: response.parts.filter((p) => p.type === "tool").length,
      },
      startTime: timing.startTime,
      endTime: timing.endTime,
      duration: timing.endTime - timing.startTime,
    }

    await record(sessionID, event)
    await markStreamEnd(sessionID)
  }

  function resolvePath(
    sessionID: string,
    agent: string,
    model: { provider: string; id: string },
    cfg: TrajectoryConfig.Options,
  ) {
    const base = path.isAbsolute(cfg.outputPath) ? cfg.outputPath : path.join(process.cwd(), cfg.outputPath)
    const filename = TrajectoryConfig.resolveFilename(sessionID, {
      agent,
      model: model.id,
      timestamp: Date.now(),
    })
    return path.join(base, filename)
  }

  function shouldFlush(rec: Recorder) {
    if (rec.options.flushStrategy === "immediate") return true
    if (!rec.stream && rec.options.flushStrategy === "end_of_stream") return true
    return rec.buffer.length >= rec.options.bufferSize
  }

  async function flush(rec: Recorder) {
    if (rec.buffer.length === 0) return
    const lines = rec.buffer.map((item) => JSON.stringify(item))
    const chunk = lines.join("\n") + "\n"
    
    try {
      await fs.mkdir(path.dirname(rec.path), { recursive: true })
      await fs.appendFile(rec.path, chunk)
      // Only clear buffer after successful write
      rec.buffer = []
    } catch (error) {
      // Keep buffer intact on failure to retry later
      console.error("Failed to flush trajectory buffer", error)
    }
  }
}
