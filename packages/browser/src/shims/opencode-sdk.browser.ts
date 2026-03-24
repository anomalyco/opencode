// Stub for @opencode-ai/sdk
// The browser version uses the SDK client to talk to the in-browser Hono server

export function createOpencodeClient(opts: {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  directory?: string
  headers?: Record<string, string>
}) {
  const fetchFn = opts.fetch || globalThis.fetch.bind(globalThis)
  const baseUrl = opts.baseUrl.replace(/\/$/, "")

  async function request(method: string, path: string, body?: any) {
    const url = `${baseUrl}${path}`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...opts.headers,
    }
    if (opts.directory) {
      headers["x-opencode-directory"] = opts.directory
    }
    const response = await fetchFn(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`)
    }
    return response.json()
  }

  return {
    session: {
      list: () => request("GET", "/session"),
      create: (data: any) => request("POST", "/session", data),
      get: (id: string) => request("GET", `/session/${id}`),
      fork: (data: any) => request("POST", `/session/${data.sessionID}/fork`),
      prompt: (data: any) => request("POST", `/session/${data.sessionID}/message`, data),
      command: (data: any) => request("POST", `/session/${data.sessionID}/command`, data),
      share: (data: any) => request("POST", `/session/${data.sessionID}/share`),
      delete: (id: string) => request("DELETE", `/session/${id}`),
    },
    config: {
      get: () => request("GET", "/config"),
    },
    event: {
      subscribe: () => {
        // SSE-based event subscription
        const url = `${baseUrl}/event`
        const eventSource = new EventSource(url)
        const stream = (async function* () {
          const queue: any[] = []
          let resolve: (() => void) | null = null
          let done = false

          eventSource.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data)
              queue.push(data)
              if (resolve) {
                resolve()
                resolve = null
              }
            } catch {}
          }

          eventSource.onerror = () => {
            done = true
            if (resolve) {
              resolve()
              resolve = null
            }
          }

          while (!done) {
            if (queue.length > 0) {
              yield queue.shift()!
            } else {
              await new Promise<void>((r) => { resolve = r })
            }
          }
        })()

        return {
          stream,
          close: () => eventSource.close(),
        }
      },
    },
    permission: {
      reply: (data: any) => request("POST", "/permission/reply", data),
    },
    app: {
      agents: () => request("GET", "/agent"),
    },
  }
}

export type OpencodeClient = ReturnType<typeof createOpencodeClient>
export type Message = any
export type ToolPart = any

export default { createOpencodeClient }
