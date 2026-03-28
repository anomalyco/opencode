import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { Log } from "@/util/log"

export type TraceSource = "OC" | "OMO" | "LLM"
export type TraceStatus = "running" | "completed" | "error"

export interface CallTraceItem {
  id: string
  type: string
  source: TraceSource
  name: string
  component: string
  startTime: number
  endTime?: number
  duration?: number
  status: TraceStatus
  metadata?: Record<string, unknown>
  inputSummary?: string
  outputSummary?: string
  providerID?: string
  modelID?: string
  tokens?: { input: number; output: number }
  cost?: number
  toolName?: string
  input?: Record<string, unknown>
  output?: string
  agentName?: string
  description?: string
  sessionID?: string
}

type CallTraceState = {
  [messageID: string]: CallTraceItem[]
}

export const { use: useCallTrace, provider: CallTraceProvider } = createSimpleContext({
  name: "CallTrace",
  init: () => {
    const log = Log.create({ service: "call-trace-tui" })
    const sdk = useSDK()
    const [traces, setTraces] = createStore<CallTraceState>({})

    log.info("CallTraceProvider initialized")

    sdk.event.listen((e: any) => {
      const event = e?.details
      const eventType = event?.type
      const eventProperties = event?.properties

      if (eventType === "call-trace.start" && eventProperties) {
        log.info("call-trace.start received", { messageID: eventProperties.messageID })
        const { messageID, trace } = eventProperties
        setTraces(messageID, (prev) => {
          const items = prev ?? []
          const idx = items.findIndex((t) => t.id === trace.id)
          if (idx >= 0) {
            return [...items.slice(0, idx), trace, ...items.slice(idx + 1)]
          }
          return [...items, trace]
        })
      } else if (eventType === "call-trace.end" && eventProperties) {
        log.info("call-trace.end received", { messageID: eventProperties.messageID })
        const { messageID, traceID, endTime, duration, status, tokens, cost, output, outputSummary, metadata } =
          eventProperties
        setTraces(messageID, (prev) => {
          if (!prev) return prev
          return prev.map((t) => {
            if (t.id !== traceID) return t
            return {
              ...t,
              endTime,
              duration,
              status,
              ...(tokens && { tokens }),
              ...(cost !== undefined && { cost }),
              ...(output !== undefined && { output }),
              ...(outputSummary !== undefined && { outputSummary }),
              ...(metadata && { metadata: { ...t.metadata, ...metadata } }),
            }
          })
        })
      }
    })

    return {
      getTraces(messageID: string): CallTraceItem[] {
        return traces[messageID] ?? []
      },
    }
  },
})
