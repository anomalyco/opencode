import type { Page } from "@playwright/test"

export type SseConnectionRecord = {
  id: number
  url: string
  path: "/global/event" | "/event"
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
  options: { server: string; retry?: number },
): Promise<SseTransport<T>> {
  const server = new URL(options.server).origin
  await page.addInitScript(
    ({ server, retry }) => {
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
        const encoded = input.deliveries.map((delivery) => ({
          delivery,
          bytes: encoder.encode(frame(delivery.payload, delivery.options)),
        }))
        encoded.forEach((item) => marker(item.delivery.options?.marker))
        if (input.burst) {
          const bytes = encoder.encode(
            encoded.map((item) => frame(item.delivery.payload, item.delivery.options)).join(""),
          )
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
        if (url.origin !== server || (url.pathname !== "/global/event" && url.pathname !== "/event"))
          return originalFetch(input, init)

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
    { server, retry: options.retry },
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
      await page.waitForFunction(
        (after) => {
          const transport = (window as BrowserTransport).__testSseTransport
          const connections = transport?.command({ type: "connections" }) as SseConnectionRecord[] | undefined
          return connections?.some((connection) => connection.id > after)
        },
        input.after ?? 0,
        { timeout: input.timeout },
      )
      return (await command<SseConnectionRecord[]>({ type: "connections" })).findLast(
        (connection) => connection.id > (input.after ?? 0),
      )!
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
