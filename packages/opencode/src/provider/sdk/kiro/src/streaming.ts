export type KiroEventType =
  | "content"
  | "tool_start"
  | "tool_input"
  | "tool_stop"
  | "thinking_start"
  | "thinking"
  | "thinking_stop"
  | "usage"
  | "done"
  | "error"

export interface KiroContentEvent {
  type: "content"
  content: string
}

export interface KiroToolStartEvent {
  type: "tool_start"
  name: string
  toolUseId: string
}

export interface KiroToolInputEvent {
  type: "tool_input"
  toolUseId: string
  input: string
}

export interface KiroToolStopEvent {
  type: "tool_stop"
  toolUseId: string
  input: unknown
}

export interface KiroThinkingStartEvent {
  type: "thinking_start"
}

export interface KiroThinkingEvent {
  type: "thinking"
  thinking: string
}

export interface KiroThinkingStopEvent {
  type: "thinking_stop"
}

export interface KiroUsageEvent {
  type: "usage"
  inputTokens: number
  outputTokens: number
}

export interface KiroDoneEvent {
  type: "done"
}

export interface KiroErrorEvent {
  type: "error"
  error: string
}

export type KiroEvent =
  | KiroContentEvent
  | KiroToolStartEvent
  | KiroToolInputEvent
  | KiroToolStopEvent
  | KiroThinkingStartEvent
  | KiroThinkingEvent
  | KiroThinkingStopEvent
  | KiroUsageEvent
  | KiroDoneEvent
  | KiroErrorEvent

// AWS Event Stream message header types
interface AwsEventStreamHeader {
  name: string
  type: number
  value: string | number | ArrayBuffer
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false) // big-endian
}

function decodeAwsEventStreamMessage(buffer: ArrayBuffer): {
  headers: Record<string, string | number | ArrayBuffer>
  payload: Uint8Array
} | null {
  if (buffer.byteLength < 16) return null

  const view = new DataView(buffer)

  // Read prelude
  const totalLength = readUint32(view, 0)
  const headersLength = readUint32(view, 4)
  // const preludeCrc = readUint32(view, 8)

  if (buffer.byteLength < totalLength) return null

  // Read headers
  const headers: Record<string, string | number | ArrayBuffer> = {}
  let offset = 12
  const headersEnd = 12 + headersLength

  while (offset < headersEnd) {
    const nameLength = view.getUint8(offset)
    offset += 1
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset, nameLength))
    offset += nameLength
    const headerType = view.getUint8(offset)
    offset += 1

    let value: string | number | ArrayBuffer
    switch (headerType) {
      case 0: // bool true
        value = 1
        break
      case 1: // bool false
        value = 0
        break
      case 2: // byte
        value = view.getInt8(offset)
        offset += 1
        break
      case 3: // short
        value = view.getInt16(offset, false)
        offset += 2
        break
      case 4: // int
        value = view.getInt32(offset, false)
        offset += 4
        break
      case 5: // long
        // JavaScript doesn't handle 64-bit ints well, read as two 32-bit values
        const high = view.getInt32(offset, false)
        const low = view.getUint32(offset + 4, false)
        value = high * 0x100000000 + low
        offset += 8
        break
      case 6: // bytes
        const bytesLength = view.getUint16(offset, false)
        offset += 2
        value = buffer.slice(offset, offset + bytesLength)
        offset += bytesLength
        break
      case 7: // string
        const stringLength = view.getUint16(offset, false)
        offset += 2
        value = new TextDecoder().decode(new Uint8Array(buffer, offset, stringLength))
        offset += stringLength
        break
      case 8: // timestamp
        const timestampHigh = view.getInt32(offset, false)
        const timestampLow = view.getUint32(offset + 4, false)
        value = timestampHigh * 0x100000000 + timestampLow
        offset += 8
        break
      case 9: // uuid
        value = buffer.slice(offset, offset + 16)
        offset += 16
        break
      default:
        throw new Error(`Unknown header type: ${headerType}`)
    }

    headers[name] = value
  }

  // Read payload
  const payloadLength = totalLength - headersLength - 16 // 12 bytes prelude + 4 bytes message CRC
  const payload = new Uint8Array(buffer, headersEnd, payloadLength)

  return { headers, payload }
}

// Simple format: {"content": "..."} or {"name": "...", "toolUseId": "...", "input": "..."} etc.
interface KiroSimpleEvent {
  content?: string
  name?: string
  toolUseId?: string
  input?: string | Record<string, unknown>
  stop?: boolean
  usage?: number
  thinking?: string
  stopReason?: string
}

// Nested format: {"assistantResponseEvent": {...}}
interface KiroNestedEvent {
  assistantResponseEvent?: {
    contentBlockDeltaEvent?: {
      delta?: {
        reasoningContentBlockDelta?: {
          thinking?: string
        }
        text?: string
        toolUse?: {
          input: string
        }
      }
    }
    contentBlockStartEvent?: {
      start?: {
        reasoningContent?: unknown
        text?: string
        toolUse?: {
          name: string
          toolUseId: string
        }
      }
    }
    contentBlockStopEvent?: {
      contentBlockIndex: number
    }
    messageStartEvent?: unknown
    messageStopEvent?: {
      stopReason?: string
    }
    usageMetricsEvent?: {
      inputTokens?: number
      outputTokens?: number
      latencyMs?: number
    }
  }
  supplementaryWebLinksEvent?: unknown
}

type KiroRawEvent = KiroSimpleEvent | KiroNestedEvent

export function parseAwsEventStream(stream: ReadableStream<Uint8Array>): ReadableStream<KiroEvent> {
  let buffer = new Uint8Array(0)
  let currentToolCall: { toolUseId: string; input: string } | null = null
  let inThinking = false
  // For Fake Reasoning: track if we're inside <thinking> tags in content
  let inFakeThinking = false
  let contentBuffer = ""

  // Helper to process content with <thinking> tags (Fake Reasoning)
  const processContentWithThinkingTags = (
    content: string,
    controller: TransformStreamDefaultController<KiroEvent>,
  ) => {
    contentBuffer += content

    while (true) {
      if (!inFakeThinking) {
        // Look for <thinking> tag
        const thinkingStart = contentBuffer.indexOf("<thinking>")
        if (thinkingStart === -1) {
          // No thinking tag found, output all content except last 10 chars (in case tag is split)
          if (contentBuffer.length > 10) {
            const safeContent = contentBuffer.slice(0, -10)
            contentBuffer = contentBuffer.slice(-10)
            if (safeContent) {
              controller.enqueue({ type: "content", content: safeContent })
            }
          }
          break
        }

        // Output content before <thinking>
        if (thinkingStart > 0) {
          controller.enqueue({ type: "content", content: contentBuffer.slice(0, thinkingStart) })
        }

        // Enter thinking mode
        inFakeThinking = true
        controller.enqueue({ type: "thinking_start" })
        contentBuffer = contentBuffer.slice(thinkingStart + "<thinking>".length)
      } else {
        // Look for </thinking> tag
        const thinkingEnd = contentBuffer.indexOf("</thinking>")
        if (thinkingEnd === -1) {
          // No end tag found, output thinking content except last 11 chars
          if (contentBuffer.length > 11) {
            const safeThinking = contentBuffer.slice(0, -11)
            contentBuffer = contentBuffer.slice(-11)
            if (safeThinking) {
              controller.enqueue({ type: "thinking", thinking: safeThinking })
            }
          }
          break
        }

        // Output thinking content before </thinking>
        if (thinkingEnd > 0) {
          controller.enqueue({ type: "thinking", thinking: contentBuffer.slice(0, thinkingEnd) })
        }

        // Exit thinking mode
        inFakeThinking = false
        controller.enqueue({ type: "thinking_stop" })
        contentBuffer = contentBuffer.slice(thinkingEnd + "</thinking>".length)
      }
    }
  }

  // Flush remaining content buffer
  const flushContentBuffer = (controller: TransformStreamDefaultController<KiroEvent>) => {
    if (contentBuffer.length > 0) {
      if (inFakeThinking) {
        controller.enqueue({ type: "thinking", thinking: contentBuffer })
        controller.enqueue({ type: "thinking_stop" })
        inFakeThinking = false
      } else {
        controller.enqueue({ type: "content", content: contentBuffer })
      }
      contentBuffer = ""
    }
  }

  return stream.pipeThrough(
    new TransformStream<Uint8Array, KiroEvent>({
      async transform(chunk, controller) {
        // Append chunk to buffer
        const newBuffer = new Uint8Array(buffer.length + chunk.length)
        newBuffer.set(buffer)
        newBuffer.set(chunk, buffer.length)
        buffer = newBuffer

        // Try to parse complete messages
        while (buffer.length >= 12) {
          const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
          const totalLength = readUint32(view, 0)

          if (buffer.length < totalLength) break

          const messageBuffer = buffer.slice(0, totalLength).buffer
          buffer = buffer.slice(totalLength)

          const message = decodeAwsEventStreamMessage(messageBuffer)
          if (!message) {
            continue
          }

          // Check for exception
          const exceptionType = message.headers[":exception-type"]
          if (exceptionType) {
            const payload = new TextDecoder().decode(message.payload)
            try {
              const errorJson = JSON.parse(payload)
              controller.enqueue({
                type: "error",
                error: errorJson.message || errorJson.Message || payload,
              })
            } catch {
              controller.enqueue({
                type: "error",
                error: payload,
              })
            }
            continue
          }

          // Parse JSON payload
          if (message.payload.length === 0) continue

          try {
            const payloadText = new TextDecoder().decode(message.payload)
            const data = JSON.parse(payloadText) as KiroRawEvent

            // Handle simple format: {"content": "..."}, {"name": "...", "toolUseId": "..."}, etc.
            const simple = data as KiroSimpleEvent
            if (simple.content !== undefined) {
              // Process content with Fake Reasoning <thinking> tags
              processContentWithThinkingTags(simple.content, controller)
              continue
            }

            if (simple.thinking !== undefined) {
              if (!inThinking) {
                inThinking = true
                controller.enqueue({ type: "thinking_start" })
              }
              controller.enqueue({
                type: "thinking",
                thinking: simple.thinking,
              })
              continue
            }

            if (simple.name !== undefined && simple.toolUseId !== undefined) {
              // Check if this is a new tool call or continuation of existing one
              const isNewToolCall =
                !currentToolCall || currentToolCall.toolUseId !== simple.toolUseId

              if (isNewToolCall && simple.input === undefined && simple.stop !== true) {
                // New tool call start (no input yet)
                currentToolCall = {
                  toolUseId: simple.toolUseId,
                  input: "",
                }
                controller.enqueue({
                  type: "tool_start",
                  name: simple.name,
                  toolUseId: simple.toolUseId,
                })
                continue
              }

              // Ensure currentToolCall exists for input/stop processing
              if (!currentToolCall || currentToolCall.toolUseId !== simple.toolUseId) {
                currentToolCall = {
                  toolUseId: simple.toolUseId,
                  input: "",
                }
                controller.enqueue({
                  type: "tool_start",
                  name: simple.name,
                  toolUseId: simple.toolUseId,
                })
              }

              // Handle input if present
              if (simple.input !== undefined) {
                const inputDelta =
                  typeof simple.input === "object"
                    ? JSON.stringify(simple.input)
                    : String(simple.input)
                currentToolCall.input += inputDelta
                controller.enqueue({
                  type: "tool_input",
                  toolUseId: currentToolCall.toolUseId,
                  input: inputDelta,
                })
              }

              // Handle stop if present
              if (simple.stop === true) {
                let parsedInput: unknown = currentToolCall.input
                try {
                  parsedInput = JSON.parse(currentToolCall.input)
                } catch {
                  // Keep as string
                }
                controller.enqueue({
                  type: "tool_stop",
                  toolUseId: currentToolCall.toolUseId,
                  input: parsedInput,
                })
                currentToolCall = null
              }
              continue
            }

            if (simple.input !== undefined && currentToolCall) {
              // Tool input delta (without name/toolUseId) - input can be string or object
              const inputDelta =
                typeof simple.input === "object"
                  ? JSON.stringify(simple.input)
                  : String(simple.input)
              currentToolCall.input += inputDelta
              controller.enqueue({
                type: "tool_input",
                toolUseId: currentToolCall.toolUseId,
                input: inputDelta,
              })
              continue
            }

            if (simple.stop === true && currentToolCall) {
              // Tool stop (without name/toolUseId)
              let parsedInput: unknown = currentToolCall.input
              try {
                parsedInput = JSON.parse(currentToolCall.input)
              } catch {
                // Keep as string
              }
              controller.enqueue({
                type: "tool_stop",
                toolUseId: currentToolCall.toolUseId,
                input: parsedInput,
              })
              currentToolCall = null
              continue
            }

            if (simple.usage !== undefined) {
              controller.enqueue({
                type: "usage",
                inputTokens: 0,
                outputTokens: simple.usage,
              })
              continue
            }

            if (simple.stopReason !== undefined) {
              if (inThinking) {
                inThinking = false
                controller.enqueue({ type: "thinking_stop" })
              }
              controller.enqueue({ type: "done" })
              continue
            }

            // Handle nested format: {"assistantResponseEvent": {...}}
            const nested = data as KiroNestedEvent
            if (nested.assistantResponseEvent) {
              const event = nested.assistantResponseEvent

              // Content block start
              if (event.contentBlockStartEvent?.start) {
                const start = event.contentBlockStartEvent.start

                if (start.reasoningContent !== undefined) {
                  inThinking = true
                  controller.enqueue({ type: "thinking_start" })
                } else if (start.toolUse) {
                  currentToolCall = {
                    toolUseId: start.toolUse.toolUseId,
                    input: "",
                  }
                  controller.enqueue({
                    type: "tool_start",
                    name: start.toolUse.name,
                    toolUseId: start.toolUse.toolUseId,
                  })
                }
              }

              // Content block delta
              if (event.contentBlockDeltaEvent?.delta) {
                const delta = event.contentBlockDeltaEvent.delta

                if (delta.reasoningContentBlockDelta?.thinking) {
                  controller.enqueue({
                    type: "thinking",
                    thinking: delta.reasoningContentBlockDelta.thinking,
                  })
                } else if (delta.text !== undefined) {
                  controller.enqueue({
                    type: "content",
                    content: delta.text,
                  })
                } else if (delta.toolUse?.input !== undefined) {
                  if (currentToolCall) {
                    currentToolCall.input += delta.toolUse.input
                    controller.enqueue({
                      type: "tool_input",
                      toolUseId: currentToolCall.toolUseId,
                      input: delta.toolUse.input,
                    })
                  }
                }
              }

              // Content block stop
              if (event.contentBlockStopEvent !== undefined) {
                if (inThinking) {
                  inThinking = false
                  controller.enqueue({ type: "thinking_stop" })
                } else if (currentToolCall) {
                  let parsedInput: unknown = currentToolCall.input
                  try {
                    parsedInput = JSON.parse(currentToolCall.input)
                  } catch {
                    // Keep as string if not valid JSON
                  }
                  controller.enqueue({
                    type: "tool_stop",
                    toolUseId: currentToolCall.toolUseId,
                    input: parsedInput,
                  })
                  currentToolCall = null
                }
              }

              // Usage metrics
              if (event.usageMetricsEvent) {
                controller.enqueue({
                  type: "usage",
                  inputTokens: event.usageMetricsEvent.inputTokens ?? 0,
                  outputTokens: event.usageMetricsEvent.outputTokens ?? 0,
                })
              }

              // Message stop
              if (event.messageStopEvent) {
                controller.enqueue({ type: "done" })
              }
            }
          } catch (e) {
            // Skip unparseable payloads
          }
        }
      },

      flush(controller) {
        // Flush any remaining content buffer (Fake Reasoning)
        flushContentBuffer(controller)

        // Handle any remaining incomplete state
        if (inThinking) {
          controller.enqueue({ type: "thinking_stop" })
        }
        if (currentToolCall) {
          let parsedInput: unknown = currentToolCall.input
          try {
            parsedInput = JSON.parse(currentToolCall.input)
          } catch {
            // Keep as string
          }
          controller.enqueue({
            type: "tool_stop",
            toolUseId: currentToolCall.toolUseId,
            input: parsedInput,
          })
        }
      },
    }),
  )
}
