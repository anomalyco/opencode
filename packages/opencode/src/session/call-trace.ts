import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import z from "zod"

export namespace CallTrace {
  const log = Log.create({ service: "call-trace" })

  export type TraceType = "llm" | "tool" | "omo"
  export type TraceSource = "OC" | "OMO" | "LLM"
  export type TraceStatus = "running" | "completed" | "error"

  export interface BaseTrace {
    id: string
    type: TraceType
    source: TraceSource
    name: string
    component: string
    messageID: string
    startTime: number
    endTime?: number
    duration?: number
    status: TraceStatus
    metadata?: Record<string, unknown>
    inputSummary?: string
    outputSummary?: string
  }

  export interface LLMTrace extends BaseTrace {
    type: "llm"
    providerID: string
    modelID: string
    tokens?: {
      input: number
      output: number
    }
    cost?: number
  }

  export interface ToolTrace extends BaseTrace {
    type: "tool"
    toolName: string
    input?: Record<string, unknown>
    output?: string
  }

  export interface OMOTrace extends BaseTrace {
    type: "omo"
    agentName: string
    description?: string
    sessionID?: string
  }

  export type Trace = LLMTrace | ToolTrace | OMOTrace

  export const Event = {
    Start: BusEvent.define(
      "call-trace.start",
      z.object({
        messageID: z.string(),
        trace: z.object({
          id: z.string(),
          type: z.enum(["llm", "tool", "omo"]),
          source: z.enum(["OC", "OMO", "LLM"]),
          name: z.string(),
          component: z.string(),
          startTime: z.number(),
          status: z.literal("running"),
          metadata: z.record(z.string(), z.unknown()).optional(),
          inputSummary: z.string().optional(),
          providerID: z.string().optional(),
          modelID: z.string().optional(),
          toolName: z.string().optional(),
          input: z.record(z.string(), z.unknown()).optional(),
          agentName: z.string().optional(),
          description: z.string().optional(),
          sessionID: z.string().optional(),
        }),
      }),
    ),
    End: BusEvent.define(
      "call-trace.end",
      z.object({
        messageID: z.string(),
        traceID: z.string(),
        endTime: z.number(),
        duration: z.number(),
        status: z.enum(["completed", "error"]),
        metadata: z.record(z.string(), z.unknown()).optional(),
        tokens: z
          .object({
            input: z.number(),
            output: z.number(),
          })
          .optional(),
        cost: z.number().optional(),
        output: z.string().optional(),
        outputSummary: z.string().optional(),
      }),
    ),
  }

  const activeTraces = new Map<string, { messageID: string; trace: BaseTrace }>()
  let traceCounter = 0

  function generateID(): string {
    return `trace_${Date.now()}_${++traceCounter}`
  }

  export async function start(input: {
    type: TraceType
    source?: TraceSource
    name: string
    component: string
    messageID: string
    metadata?: Record<string, unknown>
    inputSummary?: string
    providerID?: string
    modelID?: string
    toolName?: string
    input?: Record<string, unknown>
    agentName?: string
    description?: string
    sessionID?: string
  }): Promise<string> {
    const id = generateID()
    const startTime = Date.now()
    const source = input.source ?? (input.type === "llm" ? "LLM" : input.type === "omo" ? "OMO" : "OC")

    const trace: BaseTrace = {
      id,
      type: input.type,
      source,
      name: input.name,
      component: input.component,
      messageID: input.messageID,
      startTime,
      status: "running",
      metadata: input.metadata,
      inputSummary: input.inputSummary,
    }

    activeTraces.set(id, { messageID: input.messageID, trace })

    log.info("trace started", { id, type: input.type, source, name: input.name, messageID: input.messageID })

    await Bus.publish(Event.Start, {
      messageID: input.messageID,
      trace: {
        id,
        type: input.type,
        source,
        name: input.name,
        component: input.component,
        startTime,
        status: "running",
        metadata: input.metadata,
        inputSummary: input.inputSummary,
        providerID: input.providerID,
        modelID: input.modelID,
        toolName: input.toolName,
        input: input.input,
        agentName: input.agentName,
        description: input.description,
        sessionID: input.sessionID,
      },
    })

    return id
  }

  export async function end(
    id: string,
    input: {
      status?: "completed" | "error"
      metadata?: Record<string, unknown>
      tokens?: { input: number; output: number }
      cost?: number
      output?: string
      outputSummary?: string
    } = {},
  ): Promise<void> {
    const entry = activeTraces.get(id)
    if (!entry) {
      log.warn("trace not found", { id })
      return
    }

    activeTraces.delete(id)
    const endTime = Date.now()
    const duration = endTime - entry.trace.startTime
    const status = input.status ?? "completed"

    log.info("trace ended", { id, duration, status })

    await Bus.publish(Event.End, {
      messageID: entry.messageID,
      traceID: id,
      endTime,
      duration,
      status,
      metadata: input.metadata,
      tokens: input.tokens,
      cost: input.cost,
      output: input.output,
      outputSummary: input.outputSummary,
    })
  }

  export function getActive(): Map<string, { messageID: string; trace: BaseTrace }> {
    return activeTraces
  }

  export function findByMessageID(messageID: string, type?: TraceType): { id: string; trace: BaseTrace } | undefined {
    for (const [id, entry] of activeTraces) {
      if (entry.messageID === messageID && (!type || entry.trace.type === type)) {
        return { id, trace: entry.trace }
      }
    }
    return undefined
  }

  export function clear(messageID: string): void {
    for (const [id, entry] of activeTraces) {
      if (entry.messageID === messageID) {
        activeTraces.delete(id)
      }
    }
  }

  export function clearAll(): void {
    activeTraces.clear()
  }
}
