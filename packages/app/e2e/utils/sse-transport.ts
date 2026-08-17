import type { Page } from "@playwright/test"

export type SseConnectionRecord = {
  id: number
  url: string
  path: "/api/event"
  headers: Record<string, string>
  openedAt: number
  endedAt?: number
  endedBy?: "close" | "disconnect" | "error" | "abort"
  error?: string
}

export type SseDeliveryAcknowledgement = {
  deliveryID: number
  connectionID: number
  bytes: number
  chunkCount: number
  deliveredAt: number
  eventID?: string
}

export type SseEventOptions = {
  id?: string
  event?: string
  retry?: number
  marker?: string
}

export type SseTransport<T> = {
  server: string
  waitForConnection(options?: { after?: number; timeout?: number }): Promise<SseConnectionRecord>
  send(payload: T, options?: SseEventOptions): Promise<SseDeliveryAcknowledgement>
  burst(payloads: readonly T[], options?: readonly SseEventOptions[]): Promise<SseDeliveryAcknowledgement[]>
  split(payload: T, cuts: readonly number[], options?: SseEventOptions): Promise<SseDeliveryAcknowledgement>
  heartbeat(options?: SseEventOptions): Promise<SseDeliveryAcknowledgement>
  writeRaw(value: string | Uint8Array, cuts?: readonly number[], marker?: string): Promise<SseDeliveryAcknowledgement>
  close(): Promise<void>
  disconnect(message?: string): Promise<void>
  error(message?: string): Promise<void>
  connections(): Promise<SseConnectionRecord[]>
  acknowledgements(): Promise<SseDeliveryAcknowledgement[]>
}

type BrowserCommand<T> =
  | { type: "send"; deliveries: { payload: T; options?: SseEventOptions }[]; burst: boolean; cuts?: number[] }
  | { type: "raw"; bytes: number[]; cuts?: number[]; marker?: string }
  | { type: "end"; mode: "close" | "disconnect" | "error"; message?: string }
  | { type: "connections" }
  | { type: "acknowledgements" }

type BrowserTransport = Window & {
  __testSseTransport?: {
    command: (command: BrowserCommand<unknown>) => unknown
  }
}

export async function installSseTransport<T>(
  page: Page,
  options: { server: string; retry?: number; existingTools?: readonly string[] },
): Promise<SseTransport<T>> {
  const server = new URL(options.server).origin
  await page.addInitScript(
    ({ server, retry, existingTools }) => {
      type Connection = SseConnectionRecord & { controller: ReadableStreamDefaultController<Uint8Array> }
      type ProbeWindow = Window & {
        __visualStabilityProbe?: { startedAt: number; markers: { at: number; label: string }[] }
      }
      const originalFetch = window.fetch.bind(window)
      const connections: Connection[] = []
      const acknowledgements: SseDeliveryAcknowledgement[] = []
      const encoder = new TextEncoder()
      let nextConnectionID = 0
      let nextDeliveryID = 0
      const textOrdinals = new Map<string, number>()
      const reasoningOrdinals = new Map<string, number>()
      const startedTools = new Set(existingTools)

      const current = () => connections.findLast((connection) => connection.endedAt === undefined)
      const chunks = (bytes: Uint8Array, cuts?: readonly number[]) => {
        const boundaries = [...new Set(cuts ?? [])]
          .filter((cut) => Number.isInteger(cut) && cut > 0 && cut < bytes.byteLength)
          .sort((a, b) => a - b)
        return [0, ...boundaries].map((start, index) => bytes.slice(start, boundaries[index] ?? bytes.byteLength))
      }
      const marker = (label?: string) => {
        if (!label) return
        const probe = (window as ProbeWindow).__visualStabilityProbe
        if (!probe) return
        probe.markers.push({ at: performance.now() - probe.startedAt, label })
      }
      const frame = (payload: unknown, eventOptions: SseEventOptions = {}) =>
        [
          eventOptions.event === undefined ? "" : `event: ${eventOptions.event}\n`,
          eventOptions.id === undefined ? "" : `id: ${eventOptions.id}\n`,
          eventOptions.retry === undefined ? "" : `retry: ${eventOptions.retry}\n`,
          `data: ${JSON.stringify(payload)}\n\n`,
        ].join("")
      const currentEvents = (input: unknown) => {
        if (!input || typeof input !== "object" || !("payload" in input)) return [input]
        const envelope = input as { directory?: string; payload?: unknown }
        if (!envelope.payload || typeof envelope.payload !== "object") return [input]
        const payload = envelope.payload as { id?: string; type?: string; properties?: unknown }
        if (!payload.type) return [input]
        const properties = (payload.properties ?? {}) as Record<string, unknown>
        const base = {
          created: Date.now(),
          location: envelope.directory && envelope.directory !== "global" ? { directory: envelope.directory } : undefined,
        }
        const events = (items: { type: string; data: Record<string, unknown> }[]) =>
          items.map((item, index) => ({
            ...base,
            id: `${payload.id ?? `evt_mock_${Date.now()}`}${index ? `_${index}` : ""}`,
            ...item,
          }))
        if (payload.type === "session.status") {
          const status = properties.status as { type?: string; attempt?: number; message?: string; next?: number }
          if (status.type === "busy")
            return events([{ type: "session.execution.started", data: { sessionID: properties.sessionID } }])
          if (status.type === "retry")
            return events([
              {
                type: "session.retry.scheduled",
                data: {
                  sessionID: properties.sessionID,
                  assistantMessageID: "msg_1001_timeline_assistant",
                  attempt: status.attempt ?? 1,
                  at: status.next ?? Date.now(),
                  error: { type: "provider.error", message: status.message ?? "Retry scheduled" },
                },
              },
            ])
          return events([{ type: "session.execution.succeeded", data: { sessionID: properties.sessionID } }])
        }
        if (payload.type === "message.updated") {
          const info = properties.info as Record<string, unknown>
          const time = info.time as { completed?: number } | undefined
          if (info.role !== "assistant" || time?.completed === undefined) return []
          const error = info.error as { name?: string; data?: { message?: string } } | undefined
          if (error)
            return events([
              {
                type: "session.step.failed",
                data: {
                  sessionID: properties.sessionID,
                  assistantMessageID: info.id,
                  error: { type: error.name ?? "session.error", message: error.data?.message ?? "Session failed" },
                  cost: info.cost ?? 0,
                  tokens: info.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
                },
              },
            ])
          return events([
            {
              type: "session.step.ended",
              data: {
                sessionID: properties.sessionID,
                assistantMessageID: info.id,
                finish: "stop",
                cost: info.cost ?? 0,
                tokens: info.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              },
            },
          ])
        }
        if (payload.type === "message.part.updated") {
          const part = properties.part as Record<string, unknown>
          const sessionID = properties.sessionID
          const assistantMessageID = part.messageID
          if (part.type === "text") {
            const existing = document.querySelector(`[data-timeline-part-id="${String(part.id)}"]`)
            if (existing) {
              const parts = Array.from(
                document.querySelectorAll(`[data-message-id="${assistantMessageID}"] [data-component="text-part"]`),
              )
              return events([
                {
                  type: "session.text.ended",
                  data: { sessionID, assistantMessageID, ordinal: parts.indexOf(existing), text: part.text },
                },
              ])
            }
            const ordinal =
              textOrdinals.get(String(assistantMessageID)) ??
              document.querySelectorAll(`[data-message-id="${assistantMessageID}"] [data-component="text-part"]`).length
            textOrdinals.set(String(assistantMessageID), ordinal + 1)
            return events([
              { type: "session.text.started", data: { sessionID, assistantMessageID, ordinal } },
              { type: "session.text.ended", data: { sessionID, assistantMessageID, ordinal, text: part.text } },
            ])
          }
          if (part.type === "reasoning") {
            const ordinal =
              reasoningOrdinals.get(String(assistantMessageID)) ??
              document.querySelectorAll(`[data-message-id="${assistantMessageID}"] [data-component="reasoning-part"]`)
                .length
            reasoningOrdinals.set(String(assistantMessageID), ordinal + 1)
            return events([
              { type: "session.reasoning.started", data: { sessionID, assistantMessageID, ordinal } },
              { type: "session.reasoning.ended", data: { sessionID, assistantMessageID, ordinal, text: part.text } },
            ])
          }
          if (part.type === "tool") {
            const state = part.state as Record<string, unknown>
            const id = part.callID ?? part.id
            const toolID = String(id)
            const exists =
              startedTools.has(toolID) ||
              document.querySelector(`[data-timeline-part-id="${String(part.id)}"]`) !== null ||
              Array.from(document.querySelectorAll("[data-timeline-part-ids]")).some((element) =>
                element.getAttribute("data-timeline-part-ids")?.split(",").includes(String(part.id)),
              )
            startedTools.add(toolID)
            const started = exists
              ? []
              : [{ type: "session.tool.input.started", data: { sessionID, assistantMessageID, id, name: part.tool } }]
            if (state.status === "pending") return events(started)
            const called = {
              type: "session.tool.called",
              data: { sessionID, assistantMessageID, id, input: state.input ?? {}, executed: false },
            }
            if (state.status === "running")
              return events([
                ...started,
                called,
                { type: "session.tool.progress", data: { sessionID, assistantMessageID, id, metadata: state.metadata ?? {} } },
              ])
            if (state.status === "error")
              return events([
                ...started,
                called,
                {
                  type: "session.tool.failed",
                  data: {
                    sessionID,
                    assistantMessageID,
                    id,
                    error: { type: "tool.error", message: state.error ?? "Tool failed" },
                    metadata: state.metadata ?? {},
                    executed: false,
                  },
                },
              ])
            return events([
              ...started,
              called,
              {
                type: "session.tool.success",
                data: {
                  sessionID,
                  assistantMessageID,
                  id,
                  content: [{ type: "text", text: state.output ?? "" }],
                  metadata: state.metadata ?? {},
                  executed: false,
                },
              },
            ])
          }
        }
        return events([{ type: payload.type, data: properties }])
      }
      const acknowledge = (
        connection: Connection,
        bytes: number,
        chunkCount: number,
        eventID?: string,
      ): SseDeliveryAcknowledgement => {
        const acknowledgement = {
          deliveryID: ++nextDeliveryID,
          connectionID: connection.id,
          bytes,
          chunkCount,
          deliveredAt: performance.now(),
          ...(eventID === undefined ? {} : { eventID }),
        }
        acknowledgements.push(acknowledgement)
        return acknowledgement
      }
      const end = (mode: "close" | "disconnect" | "error", message?: string) => {
        const connection = current()
        if (!connection) throw new Error("SSE transport has no active connection")
        connection.endedAt = performance.now()
        connection.endedBy = mode
        if (message) connection.error = message
        if (mode === "close") {
          connection.controller.close()
          return
        }
        const error = new DOMException(
          message ?? "SSE connection disconnected",
          mode === "error" ? "Error" : "NetworkError",
        )
        connection.controller.error(error)
      }

      const command = (input: BrowserCommand<unknown>) => {
        if (input.type === "connections")
          return connections.map(({ controller: _controller, ...connection }) => connection)
        if (input.type === "acknowledgements") return acknowledgements
        if (input.type === "end") return end(input.mode, input.message)
        const connection = current()
        if (!connection) throw new Error("SSE transport has no active connection")
        if (input.type === "raw") {
          marker(input.marker)
          const output = chunks(new Uint8Array(input.bytes), input.cuts)
          output.forEach((chunk) => connection.controller.enqueue(chunk))
          return acknowledge(connection, input.bytes.length, output.length)
        }
        const encoded = input.deliveries.map((delivery) => {
          const payloads = connection.path === "/api/event" ? currentEvents(delivery.payload) : [delivery.payload]
          return {
            delivery,
            bytes: encoder.encode(payloads.map((payload) => frame(payload, delivery.options)).join("")),
          }
        })
        encoded.forEach((item) => marker(item.delivery.options?.marker))
        if (input.burst) {
          const bytes = encoder.encode(encoded.map((item) => new TextDecoder().decode(item.bytes)).join(""))
          connection.controller.enqueue(bytes)
          return encoded.map((item) => acknowledge(connection, item.bytes.byteLength, 1, item.delivery.options?.id))
        }
        const output = chunks(encoded[0]!.bytes, input.cuts)
        output.forEach((chunk) => connection.controller.enqueue(chunk))
        return acknowledge(connection, encoded[0]!.bytes.byteLength, output.length, encoded[0]!.delivery.options?.id)
      }

      ;(window as BrowserTransport).__testSseTransport = { command }
      const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        const url = new URL(request.url)
        if (url.origin !== server || url.pathname !== "/api/event") return originalFetch(request)

        const id = ++nextConnectionID
        const record = {
          id,
          url: url.href,
          path: url.pathname,
          headers: Object.fromEntries(request.headers.entries()),
          openedAt: performance.now(),
        } as Connection
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            record.controller = controller
            connections.push(record)
            if (retry !== undefined) controller.enqueue(encoder.encode(`retry: ${retry}\n\n`))
            controller.enqueue(
              encoder.encode(frame({ id: `evt_mock_connected_${id}`, type: "server.connected", data: {} })),
            )
            request.signal.addEventListener(
              "abort",
              () => {
                if (record.endedAt !== undefined) return
                record.endedAt = performance.now()
                record.endedBy = "abort"
                controller.error(request.signal.reason ?? new DOMException("The operation was aborted", "AbortError"))
              },
              { once: true },
            )
          },
          cancel() {
            if (record.endedAt !== undefined) return
            record.endedAt = performance.now()
            record.endedBy = "disconnect"
          },
        })
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: {
              "cache-control": "no-cache",
              "content-type": "text/event-stream",
            },
          }),
        )
      }
      Object.defineProperty(window, "fetch", { configurable: true, writable: true, value: fetch })
    },
    { server, retry: options.retry, existingTools: options.existingTools ?? [] },
  )

  const command = <Result>(input: BrowserCommand<T>) =>
    page.evaluate((input) => {
      const transport = (window as BrowserTransport).__testSseTransport
      if (!transport) throw new Error("SSE transport was not installed before page load")
      return transport.command(input as BrowserCommand<unknown>)
    }, input) as Promise<Result>

  return {
    server,
    async waitForConnection(input = {}) {
      const connection = await page.waitForFunction(
        (after) => {
          const transport = (window as BrowserTransport).__testSseTransport
          const connections = transport?.command({ type: "connections" }) as SseConnectionRecord[] | undefined
          return connections?.findLast((connection) => connection.id > after && connection.endedAt === undefined)
        },
        input.after ?? 0,
        { timeout: input.timeout },
      )
      let result: SseConnectionRecord | undefined
      try {
        result = await connection.jsonValue()
      } finally {
        await connection.dispose()
      }
      if (!result) throw new Error("SSE transport connection disappeared while waiting")
      return result
    },
    send(payload, eventOptions) {
      return command({ type: "send", deliveries: [{ payload, options: eventOptions }], burst: false })
    },
    burst(payloads, eventOptions = []) {
      return command({
        type: "send",
        deliveries: payloads.map((payload, index) => ({ payload, options: eventOptions[index] })),
        burst: true,
      })
    },
    split(payload, cuts, eventOptions) {
      return command({ type: "send", deliveries: [{ payload, options: eventOptions }], burst: false, cuts: [...cuts] })
    },
    heartbeat(eventOptions) {
      return command({
        type: "send",
        deliveries: [
          {
            payload: { directory: "global", payload: { type: "server.heartbeat", properties: {} } } as T,
            options: eventOptions,
          },
        ],
        burst: false,
      })
    },
    writeRaw(value, cuts, marker) {
      return command({
        type: "raw",
        bytes: Array.from(typeof value === "string" ? new TextEncoder().encode(value) : value),
        cuts: cuts ? [...cuts] : undefined,
        marker,
      })
    },
    close() {
      return command({ type: "end", mode: "close" })
    },
    disconnect(message) {
      return command({ type: "end", mode: "disconnect", message })
    },
    error(message) {
      return command({ type: "end", mode: "error", message })
    },
    connections() {
      return command({ type: "connections" })
    },
    acknowledgements() {
      return command({ type: "acknowledgements" })
    },
  }
}
